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

    def test_external_hf_label_is_neutralized_to_internal_route(self):
        result = json.loads(
            sham_app.generate_media_from_panel("image", "a tree", "المسار الخارجي (Hugging Face)")
        )
        self.assertEqual(result["backend"], "internal")
        self.make_media.assert_called_once()

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
