"""job_result's type follows the job's status only (2026-11-18: every pending/done answer came back as type "error" after the timing fields were added).
Run: python -m unittest ai-system/modelscope-coder/tests/test_view_type.py"""
import importlib.util
import os
import time
import unittest

os.environ["CODER_MODEL_PATH"] = "/nonexistent"
spec = importlib.util.spec_from_file_location("coder_app_view", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class ViewType(unittest.TestCase):
    def put(self, status, **kw):
        jid = "j-" + status + str(len(app.JOBS))
        now = time.time()
        app.JOBS[jid] = {"status": status, "text": "pong", "reasoning": "", "created": now - 3, **kw}
        return jid

    def test_done_is_done_with_timings(self):
        v = app._view(self.put("done", started=time.time() - 2, first_at=time.time() - 1, timings={"predicted_n": 4}))
        self.assertEqual(v["type"], "done")
        self.assertEqual(v["timings"], {"predicted_n": 4})
        self.assertIn("ttft_s", v)
        self.assertIn("wait_s", v)

    def test_done_with_restored_slot_is_done(self):
        self.assertEqual(app._view(self.put("done", started=time.time(), slot_restored="start"))["type"], "done")

    def test_running_is_pending(self):
        v = app._view(self.put("running", started=time.time(), seen=time.time()))
        self.assertEqual(v["type"], "pending")
        self.assertNotIn("error", v)

    def test_queued_is_pending(self):
        self.assertEqual(app._view(self.put("queued", seen=time.time()))["type"], "pending")

    def test_cancelled_and_error(self):
        self.assertEqual(app._view(self.put("cancelled"))["type"], "cancelled")
        v = app._view(self.put("error", error="boom"))
        self.assertEqual((v["type"], v["error"]), ("error", "boom"))


if __name__ == "__main__":
    unittest.main()
