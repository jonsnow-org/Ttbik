"""Owner order 2026-11-28: no trace of the deleted 4B model. A cn Studio outside the Nova pool (e.g. the orphaned primary coder-inference-server) must
not keep answering as the old model, and must not retry a doomed multi-GB download forever either (its 8 GB/9.8 GB disk cannot fit the one remaining
35B model, 13.8 GB peak). retired.flag makes it load nothing and never try to. Run: python -m unittest ai-system/modelscope-coder/tests/test_retired_studio.py"""
import importlib.util
import os
import sys
import unittest
from unittest import mock

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
os.environ["CODER_MODEL_PATH"] = "/nonexistent"
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("coder_app_retired", os.path.join(HERE, "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class RetiredStudio(unittest.TestCase):
    def setUp(self):
        self.marker = app.HERE / "retired.flag"
        self.assertFalse(self.marker.exists())  # never leave a real one lying around from a failed test

    def tearDown(self):
        self.marker.unlink(missing_ok=True)

    def test_not_retired_by_default(self):
        self.assertFalse(app._retired())

    def test_marker_turns_it_on(self):
        self.marker.write_text("1", encoding="utf-8")
        self.assertTrue(app._retired())

    def test_supervisor_reports_retired_and_never_downloads(self):
        self.marker.write_text("1", encoding="utf-8")
        with mock.patch.object(app, "_download_model", side_effect=AssertionError("must never try to download on a retired Studio")):
            app._supervisor()
        self.assertEqual(app.STATE["phase"], "retired")

    def test_start_background_skips_the_chat_runner_too(self):
        self.marker.write_text("1", encoding="utf-8")
        started = []
        with mock.patch.object(app.threading, "Thread", side_effect=lambda target, daemon: started.append(target) or mock.Mock()):
            app.start_background()
        self.assertEqual(started, [app._supervisor])

    def test_status_shows_retired_honestly(self):
        self.marker.write_text("1", encoding="utf-8")
        app._supervisor()
        import json
        out = json.loads(app.status())
        self.assertEqual(out["phase"], "retired")


if __name__ == "__main__":
    unittest.main()
