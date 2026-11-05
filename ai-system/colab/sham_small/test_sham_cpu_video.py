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
        self.assertEqual((big["side"], big["max_frames"]), (512, 32))
        self.assertEqual((small["side"], small["max_frames"]), (512, 32))
        self.assertTrue(all(p["side"] == 512 and 16 <= p["max_frames"] <= 32 for p in (big, small)))

    def test_overrides_are_clamped(self):
        with patch.dict(os.environ, {"CPU_VIDEO_SIDE": "9000", "CPU_VIDEO_FRAMES": "1"}):
            p = cpu_video.cv_profile(2)
        self.assertEqual((p["side"], p["max_frames"]), (512, 16))


class RequestedDuration(unittest.TestCase):
    def test_temporal_segments_map_to_real_frame_counts(self):
        profile = {"fps": 8, "max_frames": 32}
        self.assertEqual(cpu_video.cv_requested_frames(2, profile), 16)
        self.assertEqual(cpu_video.cv_requested_frames(3, profile), 24)
        self.assertEqual(cpu_video.cv_requested_frames(4, profile), 32)

    def test_all_user_requested_durations_have_exact_segment_plans(self):
        expected = {
            2: [2], 4: [4], 6: [4, 2], 10: [4, 4, 2], 15: [4, 4, 4, 3],
            30: [4, 4, 4, 4, 4, 4, 4, 2],
            60: [4] * 15, 120: [4] * 30,
        }
        for seconds, chunks in expected.items():
            with self.subTest(seconds=seconds):
                self.assertEqual(cpu_video.cv_chunk_plan(seconds), chunks)
                self.assertEqual(sum(chunks), seconds)
                self.assertTrue(all(2 <= part <= 4 for part in chunks))

    def test_unsupported_or_fractional_durations_are_rejected_without_truncation(self):
        for requested in (1, 3, 5, 7, 8, 12, 20, 45, 90, 121, 2.5, "four"):      # 6 s is supported since 2026-11-04 (owner: 6 s, 10 s, 15 s, 30 s, 1 min, 2 min)
            with self.assertRaises(ValueError) as caught:
                cpu_video.cv_chunk_plan(requested)
            self.assertIn("native-video-duration-limit", str(caught.exception))

    def test_low_memory_pass_cap_uses_two_second_passes_and_keeps_the_exact_duration(self):
        # An 8 GB Studio died mid-sampling on a 4 s/32-frame pass (LFM2.5/Nova video 2026-11-05); the cap forces 2 s/16-frame passes.
        expected = {2: [2], 4: [2, 2], 6: [2, 2, 2], 10: [2, 2, 2, 2, 2], 15: [2, 2, 2, 2, 2, 2, 3], 30: [2] * 15, 60: [2] * 30, 120: [2] * 60}
        with patch.dict(os.environ, {"CPU_VIDEO_MAX_PASS_S": "2"}):
            for seconds, chunks in expected.items():
                with self.subTest(seconds=seconds):
                    self.assertEqual(cpu_video.cv_chunk_plan(seconds), chunks)
                    self.assertEqual(sum(chunks), seconds)
                    self.assertTrue(all(2 <= part <= 3 for part in chunks))

    def test_profile_smaller_than_one_segment_is_refused(self):
        with self.assertRaises(ValueError):
            cpu_video.cv_requested_frames(4, {"fps": 8, "max_frames": 16})


class LongGenerationPlan(unittest.TestCase):
    def test_ten_seconds_uses_three_real_temporal_passes_and_one_join(self):
        import media_quality
        original_keep = os.environ.get("CPU_VIDEO_KEEP")
        with (
            patch("cpu_video.cv_generate", side_effect=[b"part-a", b"part-b", b"part-c"]) as generate,
            patch("cpu_video.cv_concat_mp4", return_value=b"joined") as join,
            patch.object(media_quality, "check_mp4", return_value={}),
            patch.dict(os.environ, {"CPU_VIDEO_KEEP": "1"}),
        ):
            result = cpu_video.cv_generate_long("/weights", "a moving car", 10, 42)
        self.assertEqual(result, b"joined")
        self.assertEqual([call.args[2] for call in generate.call_args_list], [4.0, 4.0, 2.0])
        self.assertEqual(join.call_args.args, ([b"part-a", b"part-b", b"part-c"], 10))
        self.assertEqual(os.environ.get("CPU_VIDEO_KEEP"), original_keep)

    def test_two_seconds_is_one_real_pass_without_a_join(self):
        import media_quality
        with (
            patch("cpu_video.cv_generate", return_value=b"clip") as generate,
            patch("cpu_video.cv_concat_mp4") as join,
            patch.object(media_quality, "check_mp4", return_value={}),
        ):
            result = cpu_video.cv_generate_long("/weights", "a moving car", 2, 7)
        self.assertEqual(result, b"clip")
        self.assertEqual(generate.call_count, 1)
        join.assert_not_called()


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
    def test_make_video_passes_requested_duration_through_local_segmented_engine_and_gate(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate_long", return_value=fx.mp4_shell()) as g, patch.object(sham_media_ready, "check_mp4", return_value={}):
            r = sham_media_ready.make(root, "video", "a lighthouse", seconds=15)
        self.assertEqual(r["type"], "video")
        self.assertEqual(base64.b64decode(r["b64"])[4:8], b"ftyp")
        self.assertEqual(g.call_args.args[1:3], ("a lighthouse", 15))

    def test_blank_clip_is_an_error(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate_long", side_effect=RuntimeError("not a video")):
            r = sham_media_ready.make(root, "video", "x", seconds=10)
        self.assertEqual(r["type"], "error")

    def test_missing_weights_is_a_typed_error(self):
        root = Path(tempfile.mkdtemp())
        with patch("cpu_video.cv_generate_long", side_effect=RuntimeError("native-video-unavailable: could not fetch")):
            r = sham_media_ready.make(root, "video", "x", seconds=10)
        self.assertEqual(r["type"], "error")
        self.assertIn("reason", r)


@unittest.skipUnless(os.environ.get("CPU_VIDEO_TEST_DIR"), "set CPU_VIDEO_TEST_DIR to a folder with video_animatediff/{base,adapter} to run a real generation")
class RealGeneration(unittest.TestCase):
    def test_real_clip_decodes_and_moves(self):
        import media_quality as mq
        with patch.dict(os.environ, {"CPU_VIDEO_SIDE": "512", "CPU_VIDEO_FRAMES": "32"}):
            data = cpu_video.cv_generate(os.environ["CPU_VIDEO_TEST_DIR"], "a red car driving on a coastal road", 4.0, 0)
        info = mq.check_mp4(data, expected_seconds=4, min_width=480, min_height=270)
        self.assertTrue(info["decoded"])
        self.assertEqual(info["duration_seconds"], 4.0)
        self.assertGreaterEqual(info["frames"], 32)


class SmallDiskFetch(unittest.TestCase):
    """Each Studio downloads its own persistent video-weight copy from ModelScope only; no Hugging Face runtime fallback is allowed."""

    def _run(self, free_gib):
        import shutil
        import sys
        import types
        calls = []
        hub = types.ModuleType("modelscope_hub")
        compat = types.ModuleType("modelscope_hub.compat")
        def snapshot(repo, local_dir, allow_patterns, token=None):
            calls.append((repo, tuple(allow_patterns), token))
        compat.snapshot_download = snapshot
        usage = shutil._ntuple_diskusage(10 * 1024 ** 3, 0, int(free_gib * 1024 ** 3))
        with tempfile.TemporaryDirectory() as d:
            with patch.dict(sys.modules, {"modelscope_hub": hub, "modelscope_hub.compat": compat, "huggingface_hub": None}), patch.dict(os.environ, {"MODELSCOPE_API_TOKEN": "test-token"}), patch("shutil.disk_usage", return_value=usage), patch.object(cpu_video, "cv_find_weights", side_effect=[None, ("base", "adapter")]):
                found = cpu_video.cv_fetch_weights(d)
        return found, calls

    def test_small_disk_uses_only_its_modelscope_base_and_adapter(self):
        found, calls = self._run(3.2)
        self.assertEqual(found, ("base", "adapter"))
        self.assertEqual([item[0] for item in calls], [cpu_video.CV_MS_BASE, cpu_video.CV_MS_ADAPTER])
        self.assertTrue(all(item[1] for item in calls))
        self.assertTrue(all(item[2] == "test-token" for item in calls))

    def test_big_disk_still_uses_the_same_private_modelscope_sources(self):
        found, calls = self._run(20)
        self.assertEqual(found, ("base", "adapter"))
        self.assertEqual([item[0] for item in calls], [cpu_video.CV_MS_BASE, cpu_video.CV_MS_ADAPTER])

    def test_too_little_disk_is_refused_before_any_download(self):
        with self.assertRaises(RuntimeError) as cm:
            self._run(2.0)
        self.assertIn("native-video-unavailable", str(cm.exception))
        self.assertIn("2.0 GiB", str(cm.exception))

    def test_video_runtime_has_no_huggingface_fallback(self):
        source = (HERE / "cpu_video.py").read_text(encoding="utf-8")
        self.assertNotIn("huggingface_hub", source)
        self.assertNotIn("CV_HF_", source)
        self.assertIn("modelscope_hub.compat", source)



if __name__ == "__main__":
    unittest.main()
