"""CPU-only tests for local media readiness; no weights, GPU, or network required."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sham_media_ready
from sham_media_ready import inspect_ready_assets, make, ready_root, _scene_prompts


class LocalMediaReadinessTests(unittest.TestCase):
    def test_empty_or_incomplete_folders_are_not_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertIsNone(ready_root(root))
            (root / "media" / "sdxs").mkdir(parents=True)
            (root / "media" / "piper").mkdir()
            self.assertIsNone(ready_root(root))
            (root / "media" / "sdxs" / "model_index.json").write_text("{}")
            (root / "media" / "sdxs" / "weights.safetensors").write_bytes(b"tensor")
            voice = root / "media" / "piper" / "voice.onnx"
            voice.write_bytes(b"onnx")
            self.assertIsNone(ready_root(root), "Piper ONNX must have its config JSON")

    def test_valid_local_bundle_is_reported_with_sizes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            media = root / "media"
            (media / "sdxs").mkdir(parents=True)
            (media / "piper").mkdir()
            (media / "sdxs" / "model_index.json").write_text("{}")
            (media / "sdxs" / "weights.safetensors").write_bytes(b"weights")
            voice = media / "piper" / "voice.onnx"
            voice.write_bytes(b"voice")
            Path(str(voice) + ".json").write_text("{}")
            self.assertEqual(ready_root(root), media)
            info = inspect_ready_assets(root)
            self.assertTrue(info["ready"])
            self.assertEqual(info["image_bytes"], 7)
            self.assertEqual(info["audio_bytes"], 7)

    def test_video_storyboard_has_four_distinct_shots(self):
        shots = _scene_prompts("a red car on a mountain road")
        self.assertEqual(len(shots), 4)
        self.assertEqual(len(set(shots)), 4)
        self.assertTrue(all("a red car on a mountain road" in shot for shot in shots))

    def test_image_audio_and_video_requests_use_local_generation_functions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(sham_media_ready, "_image", return_value=object()) as image_fn, patch.object(
                sham_media_ready, "_png", return_value=b"png-bytes"
            ):
                image = make(root, "image", "a fox")
            self.assertEqual(image["type"], "image")
            self.assertTrue(image_fn.called)

            with patch.object(sham_media_ready, "_speech_wav", return_value=b"wav-bytes") as speech_fn:
                audio = make(root, "audio", "مرحبا")
            self.assertEqual(audio["type"], "audio")
            speech_fn.assert_called_once_with(root, "مرحبا")

            with patch.object(sham_media_ready, "_video", return_value=b"mp4-bytes") as video_fn:
                video = make(root, "video", "a fox in the forest")
            self.assertEqual(video["type"], "video")
            self.assertEqual(video["frames"], 4)
            self.assertEqual(video["mime"], "video/mp4")
            self.assertEqual(video_fn.call_args.args[1], _scene_prompts("a fox in the forest"))
            self.assertEqual(video_fn.call_args.args[2], "a fox in the forest")
            self.assertEqual(video_fn.call_args.kwargs["seconds"], 1.5)

    def test_invalid_requests_fail_without_loading_models(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(make(root, "image", "")["type"], "error")
            self.assertEqual(make(root, "unknown", "hello")["type"], "error")


if __name__ == "__main__":
    unittest.main()
