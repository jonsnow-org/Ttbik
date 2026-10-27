"""Real text-to-video on CPU (cpu_video.py): the Sham and Nova copies stay identical, no slideshow / Wan / GPU path is left, the profile fits the CPU,
the weights lookup and the media_ready wiring work. A real generation runs only when CPU_VIDEO_TEST_DIR points to the weights (see the PR for the run)."""
from __future__ import annotations

import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cpu_video
import media_fixtures as fx
import sham_media_ready

HERE = Path(__file__).resolve().parent
AI = HERE.parent.parent


def _block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return text[text.index("# --- cpu_video BEGIN"):text.index("# --- cpu_video END ---")]


class CopiesAndHonesty(unittest.TestCase):
    def test_nova_copy_is_identical(self):
        self.assertEqual(_block(AI / "modelscope-media" / "app.py"), _block(HERE / "cpu_video.py"))

    def test_no_slideshow_wan_or_gpu_left(self):
        for path in (HERE / "cpu_video.py", HERE / "sham_media_ready.py", HERE / "sham_studio_media.py", AI / "modelscope-media" / "app.py"):
            text = path.read_text(encoding="utf-8")
            for bad in ("WanPipeline", "Wan-AI", "export_to_video", "def _mp4(", "def _video_result", 'cuda"', ".cuda(", "device_map"):
                self.assertFalse(bad in text, f"{bad!r} found in {path.name}")

    def test_internal_video_is_a_notice_never_a_clip(self):
        try:
            import sham_studio_media as m
        except ModuleNotFoundError as e:                       # CPU CI without torch: the module needs it to import
            self.skipTest(f"needs torch ({e})")
        self.assertEqual(m.NO_VIDEO["type"], "notice")
        self.assertFalse(hasattr(m, "_mp4"))


class Profile(unittest.TestCase):
    def test_cpu_profile(self):
        with patch.dict(os.environ, {}, clear=False):
            for k in ("CPU_VIDEO_SIDE", "CPU_VIDEO_FRAMES"):
                os.environ.pop(k, None)
            big, small = cpu_video.cv_profile(8), cpu_video.cv_profile(2)
        self.assertEqual((big["side"], big["max_frames"]), (512, 16))
        self.assertEqual((small["side"], small["max_frames"]), (384, 8))
        self.assertTrue(all(p["side"] % 8 == 0 and 8 <= p["max_frames"] <= 16 for p in (big, small)))

    def test_overrides_are_clamped(self):
        with patch.dict(os.environ, {"CPU_VIDEO_SIDE": "9000", "CPU_VIDEO_FRAMES": "1"}):
            p = cpu_video.cv_profile(2)
        self.assertEqual((p["side"], p["max_frames"]), (512, 8))


class Weights(unittest.TestCase):
    def _make(self, root: Path):
        base = root / "video_animatediff" / "base"
        (base / "unet").mkdir(parents=True)
        (base / "model_index.json").write_text("{}")
        (base / "unet" / "diffusion_pytorch_model.safetensors").write_bytes(b"x")
        ad = root / "video_animatediff" / "adapter"
        ad.mkdir()
        (ad / cpu_video.CV_ADAPTER_FILE).write_bytes(b"x")

    def test_find_weights(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(cpu_video.cv_find_weights(d))
            self._make(Path(d))
            base, ad = cpu_video.cv_find_weights(d)
            self.assertTrue(base.name == "base" and ad.name == cpu_video.CV_ADAPTER_FILE)

    def test_not_enough_disk_is_a_clear_error_not_a_crash(self):
        with tempfile.TemporaryDirectory() as d, patch("shutil.disk_usage", return_value=__import__("collections").namedtuple("U", "total used free")(1, 1, 10)):
            with self.assertRaises(RuntimeError) as c:
                cpu_video.cv_fetch_weights(d)
        self.assertIn("native-video-unavailable", str(c.exception))

    def test_empty_prompt(self):
        with self.assertRaises(ValueError):
            cpu_video.cv_generate("/nonexistent", "  ")


class Wiring(unittest.TestCase):
    def test_make_video_goes_through_cpu_video_and_the_gate(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate", return_value=fx.mp4_shell()) as g, patch.object(sham_media_ready, "check_mp4", return_value={}):
            r = sham_media_ready.make(root, "video", "a lighthouse")
        self.assertEqual(r["type"], "video")
        self.assertEqual(base64.b64decode(r["b64"])[4:8], b"ftyp")
        self.assertEqual(g.call_args[0][1], "a lighthouse")

    def test_blank_clip_is_an_error(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate", return_value=b"not a video"):
            r = sham_media_ready.make(root, "video", "x")
        self.assertEqual(r["type"], "error")

    def test_missing_weights_is_a_typed_error(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate", side_effect=RuntimeError("native-video-unavailable: could not fetch")):
            r = sham_media_ready.make(root, "video", "x")
        self.assertEqual(r["type"], "error")
        self.assertIn("reason", r)


@unittest.skipUnless(os.environ.get("CPU_VIDEO_TEST_DIR"), "set CPU_VIDEO_TEST_DIR to a folder with video_animatediff/{base,adapter} to run a real generation")
class RealGeneration(unittest.TestCase):
    def test_real_clip_decodes_and_moves(self):
        import media_quality as mq
        with patch.dict(os.environ, {"CPU_VIDEO_SIDE": "384", "CPU_VIDEO_FRAMES": "8"}):
            data = cpu_video.cv_generate(os.environ["CPU_VIDEO_TEST_DIR"], "a red car driving on a coastal road", 1.0, 0)
        info = mq.check_mp4(data)               # structure + ffmpeg decode + not blank + real motion
        self.assertTrue(info["decoded"])
        self.assertGreaterEqual(info["frames"], 8)


if __name__ == "__main__":
    unittest.main()
