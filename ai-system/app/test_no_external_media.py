"""Nova's backend generates media only on its own Studio: no external media service is referenced or called."""
import pathlib
import re
import unittest
from unittest import mock

APP = pathlib.Path(__file__).resolve().parent
BANNED = re.compile(r"api\.cloudflare\.com|cloudflare_ai|CLOUDFLARE_|import edge_tts|from edge_tts|from gtts|import gtts|edge-tts==|gTTS==|replicate\.com|import replicate|heygen|hyperframes", re.I)


class NoExternalMedia(unittest.TestCase):
    def test_removed_modules_are_gone(self):
        self.assertFalse((APP / "cloudflare_ai.py").exists())
        self.assertFalse((APP / "media_finish.py").exists())

    def test_no_banned_service_in_backend_code_or_requirements(self):
        hits = []
        for f in list(APP.glob("*.py")) + [APP.parent / "requirements.txt"]:
            if f.name == pathlib.Path(__file__).name:
                continue
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if BANNED.search(line):
                    hits.append(f"{f.name}:{n}: {line.strip()[:100]}")
        self.assertEqual(hits, [], "\n".join(hits))


class LocalVoice(unittest.TestCase):
    def setUp(self):
        from app import tts
        self.tts = tts

    def test_arabic_goes_to_nova_studio_and_is_returned(self):
        wav = b"RIFF" + b"\0" * 200
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=wav) as g, mock.patch.object(self.tts, "_to_ogg_opus", return_value=b"OGG"):
            self.assertEqual(self.tts.synthesize("مرحبا بك"), (b"OGG", "ogg"))
            self.assertEqual(g.call_args[0][0], "audio")

    def test_wav_when_no_transcoder(self):
        wav = b"RIFF" + b"\0" * 200
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=wav), mock.patch.object(self.tts, "_to_ogg_opus", return_value=None):
            self.assertEqual(self.tts.synthesize("مرحبا"), (wav, "wav"))

    def test_studio_failure_is_text_only_never_raises(self):
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", side_effect=RuntimeError("down")):
            self.assertIsNone(self.tts.synthesize("مرحبا"))
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=None):
            self.assertIsNone(self.tts.synthesize("مرحبا"))

    def test_non_arabic_is_not_sent_to_the_arabic_voice(self):
        with mock.patch.object(self.tts.nova_media_studio, "generate_media") as g:
            self.assertIsNone(self.tts.synthesize("hello there"))
            g.assert_not_called()


class NoImagesAssembledAsVideo(unittest.TestCase):
    """The owner's standing rule (2026-11-06): "لا أوافق على وجود مولد وسائط صور مجمعة على شكل فيديو
    سواء كان في شام القديم او غيره". A video must come from real temporal generation — animating
    still images (Ken Burns pan/zoom, crossfade between AI keyframes, or diffusers' own
    `export_to_video` over a list of stills) is banned anywhere in the tree."""

    ROOT = APP.parent.parent          # repo root
    AI = APP.parent                   # ai-system/
    # The two real temporal engines are allowed to mention frame lists; nothing else is.
    ALLOWED = {
        "ai-system/colab/sham_small/cpu_video.py",
        "ai-system/modelscope-media/app.py",
    }
    BANNED = re.compile(r"_ken_burns_frames|_crossfade_frames|_build_slideshow_frames|_SLIDESHOW_KEYFRAME_SUFFIXES")

    def test_no_slideshow_frame_builder_survives_anywhere(self):
        hits = []
        for f in self.ROOT.rglob("*.py"):
            rel = f.relative_to(self.ROOT).as_posix()
            if "__pycache__" in rel or rel in self.ALLOWED or f.name.startswith("test_"):
                continue
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if self.BANNED.search(line):
                    hits.append(f"{rel}:{n}: {line.strip()[:100]}")
        self.assertEqual(hits, [], "\n".join(hits))

    def test_the_dead_slideshow_video_endpoint_is_gone(self):
        council = (APP / "council.py").read_text(encoding="utf-8")
        self.assertNotIn("_seconds_to_cogvideox_frames", council)
        self.assertNotIn("_generate_video_blocking", council)
        studio = (self.AI / "modelscope-studio" / "app.py").read_text(encoding="utf-8")
        self.assertNotIn("_build_slideshow_frames", studio)
        # The Studio's video tab is not mounted: only text + image remain.
        self.assertNotIn('["نص ورؤية", "توليد صور", "توليد فيديو"]', studio)


if __name__ == "__main__":
    unittest.main()
