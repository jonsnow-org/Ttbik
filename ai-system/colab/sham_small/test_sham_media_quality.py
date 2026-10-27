"""Media quality gate: blank / constant / noise pictures, silent audio and empty videos must never be returned. numpy + Pillow only (no GPU, no weights, no network)."""
from __future__ import annotations

import base64
import re
import unittest
from pathlib import Path
from unittest.mock import patch

import media_fixtures as fx
import media_quality as mq
import sham_media_ready


def _block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return text[text.index("# --- media_quality BEGIN"):text.index("# --- media_quality END ---")]


class ImageGate(unittest.TestCase):
    def test_black_512_png_is_rejected(self):          # what the old smoke test (size > 128 bytes) let through
        data = fx.png("black", 512)
        self.assertGreater(len(data), 128)
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_image(data)
        self.assertEqual(c.exception.reason, "blank_image")

    def test_constant_and_noise_are_rejected_real_content_passes(self):
        for kind, reason in (("gray", "blank_image"), ("noise", "noise_image")):
            with self.assertRaises(mq.MediaQualityError) as c:
                mq.check_image(fx.png(kind))
            self.assertEqual(c.exception.reason, reason)
        self.assertEqual(mq.check_image(fx.png("gradient"))["std"] > 8, True)

    def test_garbage_and_nan(self):
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_image(b"not an image")
        self.assertEqual(c.exception.reason, "invalid_image")
        import numpy as np
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_image(np.full((16, 16, 3), np.nan))
        self.assertEqual(c.exception.reason, "invalid_image")


class AudioVideoGate(unittest.TestCase):
    def test_audio(self):
        self.assertGreater(mq.check_wav(fx.wav("tone"))["peak"], 0.1)
        for data in (fx.wav("silence"), b"", fx.wav("tone", seconds=0.05)):
            with self.assertRaises(mq.MediaQualityError) as c:
                mq.check_wav(data)
            self.assertEqual(c.exception.reason, "silent_audio")
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_wav(b"RIFF" + b"x" * 200)
        self.assertEqual(c.exception.reason, "invalid_audio")

    def test_video_structure(self):
        self.assertEqual(mq.check_mp4(fx.mp4_shell(), decode=False)["decoded"], False)
        for data in (b"", b"x" * 5000, fx.mp4_shell(0)[:200]):
            with self.assertRaises(mq.MediaQualityError) as c:
                mq.check_mp4(data, decode=False)
            self.assertEqual(c.exception.reason, "empty_video")


def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        import shutil
        return shutil.which("ffmpeg")


@unittest.skipUnless(_ffmpeg(), "ffmpeg not installed: frame-level video checks are skipped (the Studio has imageio-ffmpeg)")
class RealVideoDecode(unittest.TestCase):
    def clip(self, source: str) -> bytes:
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "c.mp4"
            subprocess.run([_ffmpeg(), "-v", "error", "-y", "-f", "lavfi", "-i", source, "-t", "1", "-pix_fmt", "yuv420p", "-c:v", "libx264", str(out)], check=True, timeout=60)
            return out.read_bytes()

    def test_moving_clip_passes_black_and_frozen_clips_fail(self):
        info = mq.check_mp4(self.clip("testsrc=size=128x128:rate=8"))
        self.assertTrue(info["decoded"])
        self.assertGreaterEqual(info["frames"], 2)
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_mp4(self.clip("color=c=black:size=128x128:rate=8"))
        self.assertEqual(c.exception.reason, "static_video")
        with self.assertRaises(mq.MediaQualityError) as c:       # a still picture held for a second: no motion
            mq.check_mp4(self.clip("color=c=red:size=128x128:rate=8,drawbox=x=20:y=20:w=60:h=60:color=white:t=fill"))
        self.assertEqual(c.exception.reason, "static_video")

    def test_garbage_that_looks_like_mp4_is_rejected_by_the_decoder(self):
        with self.assertRaises(mq.MediaQualityError) as c:
            mq.check_mp4(fx.mp4_shell())
        self.assertEqual(c.exception.reason, "empty_video")


class GateReply(unittest.TestCase):
    def reply(self, kind, raw, **extra):
        return {"type": kind, "b64": base64.b64encode(raw).decode(), **extra}

    def test_passes_good_and_replaces_bad_with_a_typed_error(self):
        good = self.reply("image", fx.png())
        self.assertIs(mq.gate_reply(good), good)
        bad = mq.gate_reply(self.reply("image", fx.png("black", 512), backend="ready"))
        self.assertEqual((bad["type"], bad["reason"], bad["backend"]), ("error", "blank_image", "ready"))
        self.assertNotIn("b64", bad)
        self.assertEqual(mq.gate_reply(self.reply("audio", fx.wav("silence")))["reason"], "silent_audio")
        self.assertEqual(mq.gate_reply(self.reply("video", b"x" * 10))["reason"], "empty_video")
        for passthrough in ({"type": "text", "text": "hi"}, {"type": "busy"}, {"type": "error", "text": "x"}, "str", None):
            self.assertEqual(mq.gate_reply(passthrough), passthrough)

    def test_exception_codes(self):
        self.assertEqual(mq.classify_exception(RuntimeError("native-video-unavailable: 3.2 GiB free disk")), "disk")
        self.assertEqual(mq.classify_exception(TimeoutError("x")), "timeout")
        self.assertEqual(mq.classify_exception(ValueError("boom")), "failed")


class MakeUsesTheGate(unittest.TestCase):
    """sham_media_ready.make(): a black picture from the image model is an error reply, not a PNG."""
    def test_black_image_from_pipeline_is_an_error(self):
        from PIL import Image
        with patch.object(sham_media_ready, "_pipe") as pipe:
            pipe.return_value.return_value.images = [Image.new("RGB", (512, 512))]
            out = sham_media_ready.make(Path("."), "image", "a red apple")
        self.assertEqual((out["type"], out["reason"]), ("error", "blank_image"))
        self.assertNotIn("b64", out)

    def test_real_picture_passes(self):
        from PIL import Image
        good = Image.open(__import__("io").BytesIO(fx.png()))
        with patch.object(sham_media_ready, "_pipe") as pipe:
            pipe.return_value.return_value.images = [good]
            out = sham_media_ready.make(Path("."), "image", "a red apple")
        self.assertEqual(out["type"], "image")

    def test_silent_speech_is_an_error(self):
        with patch.object(sham_media_ready, "_voice") as voice:
            voice.return_value.synthesize_wav.side_effect = lambda text, w: (w.setnchannels(1), w.setsampwidth(2), w.setframerate(16000), w.writeframes(b"\0\0" * 16000))
            out = sham_media_ready.make(Path("."), "audio", "مرحبا")
        self.assertEqual((out["type"], out["reason"]), ("error", "silent_audio"))


class CopiesStayInSync(unittest.TestCase):
    def test_nova_copies_match_the_sham_module(self):
        here = Path(__file__).resolve().parent
        ai = here.parent.parent
        ref = _block(here / "media_quality.py")
        self.assertEqual(_block(ai / "app" / "media_quality.py"), ref)
        self.assertEqual(_block(ai / "modelscope-media" / "app.py"), ref)
        self.assertEqual((ai / "app" / "media_fixtures.py").read_text().split("\n", 1)[1], (here / "media_fixtures.py").read_text().split("\n", 1)[1])


if __name__ == "__main__":
    unittest.main()
