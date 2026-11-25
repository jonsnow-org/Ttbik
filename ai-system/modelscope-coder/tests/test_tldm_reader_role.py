"""Owner decision 2026-11-25 (T-5 option 2): Nova's T-LDM reader runs on its OWN Studio. A reader Studio answers generate_tldm only: chat there is an honest error
(never a second chat Studio, never another model), no chat queue runs, and the head counts as on. Run: python -m unittest ai-system/modelscope-coder/tests/test_tldm_reader_role.py"""
import importlib.util
import json
import os
import sys
import unittest
from unittest import mock

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
os.environ["CODER_MODEL_PATH"] = "/nonexistent"
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("coder_app_rr", os.path.join(HERE, "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
import nova_tldm_serve as nt  # noqa: E402


class ReaderRole(unittest.TestCase):
    def test_chat_studio_by_default(self):
        with mock.patch.dict(os.environ, {"NOVA_TLDM_READER": ""}):
            self.assertFalse(app._reader_only())

    def test_reader_refuses_chat_honestly(self):
        with mock.patch.dict(os.environ, {"NOVA_TLDM_READER": "1"}):
            self.assertTrue(app._reader_only())
            out = json.loads(app.chat(json.dumps([{"role": "user", "content": "hi"}])))
            self.assertEqual(out["type"], "error")
            self.assertIn("T-LDM reader only", out["error"])
            self.assertIn("No other model", out["error"])

    def test_reader_starts_no_chat_queue(self):
        started = []
        with mock.patch.dict(os.environ, {"NOVA_TLDM_READER": "1"}), mock.patch.object(app.threading, "Thread", side_effect=lambda target, daemon: started.append(target) or mock.Mock()):
            app.start_background()
        self.assertEqual(started, [app._supervisor])

    def test_reader_marker_turns_head_on(self):
        marker = nt.HERE / "tldm_reader.on"
        self.assertFalse(marker.exists())
        try:
            marker.write_text("on")
            self.assertTrue(nt.enabled())
        finally:
            marker.unlink()


if __name__ == "__main__":
    unittest.main()
