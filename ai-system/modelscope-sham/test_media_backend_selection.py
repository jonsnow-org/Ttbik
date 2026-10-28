"""Regression tests for the Sham media path selector (no model weights or network required)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as sham_app  # noqa: E402
import base64  # noqa: E402

import media_fixtures as fx  # noqa: E402  (ai-system/colab/sham_small, on PYTHONPATH)

GOOD_PNG = base64.b64encode(fx.png()).decode()
GOOD_MP4 = base64.b64encode(fx.mp4_shell()).decode()


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
        self.make_media = Mock(return_value={"type": "image", "b64": GOOD_PNG})
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

    def test_unknown_or_removed_labels_are_an_explicit_error_not_a_silent_internal(self):
        for label in ("المسار الخارجي (Hugging Face)", "", "whatever"):
            result = json.loads(sham_app.generate_media_from_panel("image", "a tree", label))
            self.assertEqual((result["type"], result["reason"]), ("error", "unknown_route"))
        self.make_media.assert_not_called()

    def test_client_labels_match_the_studio_enum(self):
        """src/lib/shamStudio.ts SHAM_BACKEND_LABELS must be exactly the labels this Studio validates."""
        ts = (Path(__file__).resolve().parents[2] / "src" / "lib" / "shamStudio.ts").read_text(encoding="utf-8")
        for label in sham_app.PANEL_BACKENDS:
            self.assertIn(label, ts)

    def test_generate_media_endpoint_is_registered_in_the_ui(self):
        """The Studio answered HTTP 500 for `generate_media` because it was not registered; the UI must expose every api the clients call."""
        import inspect
        src = inspect.getsource(sham_app.build_ui)
        for api in ("generate_media_from_panel", "generate_media", "generate_any", "chat_auto", "status"):
            self.assertIn(f'api_name="{api}"', src)

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

    def test_ready_weights_generate_even_when_text_checkpoint_is_not_ready(self):
        sham_app.STATE.update(phase="waiting", media_root="/tmp/sham-v2-media")
        ready = types.ModuleType("sham_media_ready")
        ready.make = Mock(return_value={"type": "image", "b64": GOOD_PNG})
        with patch.dict(sys.modules, {"sham_media_ready": ready}):
            result = json.loads(
                sham_app.generate_media_from_panel(
                    "image", "a tree", "المسار البديل (أوزان محلية جاهزة)"
                )
            )
        self.assertEqual(result["type"], "image")
        self.assertEqual(result["backend"], "ready")
        ready.make.assert_called_once_with(Path("/tmp/sham-v2-media"), "image", "a tree", scenes=[], narration="")
        self.make_media.assert_not_called()

    @patch.dict(os.environ, {"SHAM_LOCAL_VIDEO": "1"})
    @patch("media_quality.check_mp4", lambda data, **k: {"decoded": False})      # the fixture is a container shell; real decoding is covered in test_sham_media_quality
    def test_ready_backend_receives_video_scenes_and_narration(self):
        sham_app.STATE["media_root"] = "/tmp/sham-v2-media"
        ready = types.ModuleType("sham_media_ready")
        ready.make = Mock(return_value={"type": "video", "b64": GOOD_MP4})
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

    def test_blank_picture_from_either_path_never_leaves_the_studio(self):
        blank = base64.b64encode(fx.png("black", 512)).decode()
        self.make_media.return_value = {"type": "image", "b64": blank}
        internal = json.loads(sham_app.generate_media_from_panel("image", "a tree", "شام الداخلي (الأساسي)"))
        self.assertEqual((internal["type"], internal["reason"], internal["backend"]), ("error", "blank_image", "internal"))
        self.assertNotIn("b64", internal)
        sham_app.STATE["media_root"] = "/tmp/sham-v2-media"
        ready = types.ModuleType("sham_media_ready")
        ready.make = Mock(return_value={"type": "image", "b64": blank})
        with patch.dict(sys.modules, {"sham_media_ready": ready}):
            out = json.loads(sham_app.generate_media_from_panel("image", "a tree", "المسار البديل (أوزان محلية جاهزة)"))
        self.assertEqual((out["type"], out["reason"], out["backend"]), ("error", "blank_image", "ready"))

    def test_generate_any_is_vetted_too(self):
        blank = base64.b64encode(fx.png("black", 512)).decode()
        serve = self.fake_serve
        serve._state["model"] = object()
        media = types.SimpleNamespace(generate_any=Mock(return_value={"type": "image", "b64": blank}))
        with patch.object(sham_app, "_studio_modules", return_value=(None, media)):
            out = json.loads(sham_app.generate_any("ارسم قطة"))
        self.assertEqual((out["type"], out["reason"]), ("error", "blank_image"))

    def test_chat_studio_refuses_video_without_loading_anything(self):
        """Sham v2's chat Studio died (502) when it loaded the video pipeline next to the text model: video is the video Studio's job."""
        sham_app.STATE["media_root"] = "/tmp/sham-v2-media"
        ready = types.ModuleType("sham_media_ready")
        ready.make = Mock()
        with patch.dict(sys.modules, {"sham_media_ready": ready}), patch.dict(os.environ, {"SHAM_LOCAL_VIDEO": ""}):
            result = json.loads(sham_app.generate_media_from_panel("video", "a rabbit", "المسار البديل (أوزان محلية جاهزة)", "[]", ""))
        self.assertEqual((result["type"], result["reason"]), ("error", "video_elsewhere"))
        ready.make.assert_not_called()

    @patch.dict(os.environ, {"SHAM_LOCAL_VIDEO": "1"})
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
