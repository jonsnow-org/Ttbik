"""Regression tests for the Sham media path selector (no model weights or network required)."""
from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as sham_app  # noqa: E402


class MediaBackendSelectionTests(unittest.TestCase):
    def setUp(self):
        self.old_state = dict(sham_app.STATE)
        sham_app.STATE.update(phase="ready", media_root="")
        self.fake_serve = types.ModuleType("serve")
        self.fake_serve._state = {
            "model": object(),
            "text_tokenizer": object(),
            "image_tokenizer": object(),
            "audio_tokenizer": object(),
        }
        self.make_media = Mock(return_value={"type": "image", "b64": "local-test"})
        self.modules_patch = patch.object(
            sham_app, "_studio_modules",
            return_value=(None, types.SimpleNamespace(make_media=self.make_media)),
        )
        self.modules_patch.start()
        self.serve_patch = patch.dict(sys.modules, {"serve": self.fake_serve})
        self.serve_patch.start()

    def tearDown(self):
        self.modules_patch.stop()
        self.serve_patch.stop()
        sham_app.STATE.clear()
        sham_app.STATE.update(self.old_state)

    def test_public_media_api_defaults_to_internal_sham(self):
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("SHAM_MEDIA_BACKEND", None)
            result = json.loads(sham_app.generate_media("image", "a tree"))
        self.assertEqual(result["backend"], "internal")
        self.make_media.assert_called_once()

    def test_hf_route_works_without_sham_model_ready_and_does_not_fallback(self):
        import base64
        import os
        with tempfile.NamedTemporaryFile(suffix=".png") as image_file:
            image_file.write(b"fake-png")
            image_file.flush()
            fake_client_module = types.ModuleType("gradio_client")
            fake_client_module.Client = Mock(return_value=types.SimpleNamespace(predict=Mock(return_value=image_file.name)))
            with patch.dict(sys.modules, {"gradio_client": fake_client_module}), patch.dict(os.environ, {"HF_TOKEN1": "test-token", "HF_IMAGE_SPACE_ID": "Novasy/nova-image-space"}):
                sham_app.STATE["phase"] = "waiting"
                result = json.loads(sham_app.generate_media_from_panel("image", "a rabbit", "المسار الخارجي (Hugging Face)"))
        self.assertEqual(result["type"], "image")
        self.assertEqual(result["backend"], "hf")
        self.assertEqual(base64.b64decode(result["b64"]), b"fake-png")
        self.make_media.assert_not_called()

    def test_hf_audio_returns_explicit_unsupported_error(self):
        result = json.loads(sham_app.generate_media_from_panel("audio", "مرحبا", "المسار الخارجي (Hugging Face)"))
        self.assertEqual(result["type"], "error")
        self.assertIn("يدعم الصور والفيديو", result["text"])
        self.make_media.assert_not_called()

    def test_panel_can_select_internal_sham(self):
        result = json.loads(
            sham_app.generate_media_from_panel("image", "a tree", "شام الداخلي (الأساسي)")
        )
        self.assertEqual(result["backend"], "internal")
        self.make_media.assert_called_once()

    def test_alternative_requires_local_weights_and_never_silently_falls_back(self):
        result = json.loads(
            sham_app.generate_media_from_panel("image", "a tree", "المسار البديل (أوزان محلية جاهزة)")
        )
        self.assertEqual(result["type"], "error")
        self.assertIn("المسار البديل غير جاهز", result["text"])
        self.make_media.assert_not_called()

    def test_ready_backend_receives_video_scenes_and_narration(self):
        sham_app.STATE["media_root"] = "/tmp/sham-v2-media"
        ready = types.ModuleType("sham_media_ready")
        ready.make = Mock(return_value={"type": "video", "b64": "local-test"})
        scenes = ["wide shot of a rabbit", "close-up of the rabbit"]
        with patch.dict(sys.modules, {"sham_media_ready": ready}):
            result = json.loads(
                sham_app.generate_media_from_panel(
                    "video",
                    "a rabbit in a garden",
                    "المسار البديل (أوزان محلية جاهزة)",
                    json.dumps(scenes),
                    "الأرنب يقفز في الحديقة",
                )
            )
        self.assertEqual(result["type"], "video")
        self.assertEqual(result["backend"], "ready")
        args, kwargs = ready.make.call_args
        self.assertEqual(args[0], Path("/tmp/sham-v2-media"))
        self.assertEqual(args[1:3], ("video", "a rabbit in a garden"))
        self.assertEqual(kwargs["scenes"], scenes)
        self.assertEqual(kwargs["narration"], "الأرنب يقفز في الحديقة")
        self.make_media.assert_not_called()

    def test_invalid_scenes_json_returns_explicit_error(self):
        sham_app.STATE["media_root"] = "/tmp/sham-v2-media"
        result = json.loads(
            sham_app.generate_media_from_panel(
                "video", "a rabbit", "المسار البديل (أوزان محلية جاهزة)", "not-json", ""
            )
        )
        self.assertEqual(result["type"], "error")
        self.assertIn("JSON", result["text"])
        self.make_media.assert_not_called()


if __name__ == "__main__":
    unittest.main()
