"""Saved conversation / shared-start states come back whenever the live slot holds another start, not only after a restart (measured 2026-11-18, nova-speed.yml).
Run: python -m unittest ai-system/modelscope-coder/tests/test_slot_restore.py"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

os.environ["CODER_MODEL_PATH"] = "/nonexistent"
spec = importlib.util.spec_from_file_location("coder_app_slots", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class SlotRestore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.SLOT_DIR = Path(self.tmp.name)
        app._LAST.update(conv="", start="")
        self.calls = []

        def fake(action, filename):
            self.calls.append((action, filename))
            if action == "save":
                (app.SLOT_DIR / filename).write_bytes(b"x" * 10)
            return action == "save" or (app.SLOT_DIR / filename).is_file()
        app._slot_call = fake

    def tearDown(self):
        self.tmp.cleanup()

    def job(self, conv, start, total=9000):
        return {"conv": conv, "start": start, "prefill": {"total": total}, "status": "done"}

    def test_full_start_is_restored_after_a_greeting_took_the_slot(self):
        app._slot_after(self.job("c1", "FULL"))                     # a full request: its start is kept
        self.assertTrue(app._start_file("FULL").is_file())
        app._slot_after(self.job("lite", "LITE", total=300))        # a greeting on the short text takes the slot
        self.calls.clear()
        j = self.job("c2", "FULL")
        app._slot_before(j)
        self.assertEqual(j.get("slot_restored"), "start")
        self.assertIn(("restore", app._start_file("FULL").name), self.calls)

    def test_same_start_in_the_live_slot_restores_nothing(self):
        app._slot_after(self.job("c1", "FULL"))
        self.calls.clear()
        j = self.job("c2", "FULL")
        app._slot_before(j)
        self.assertIsNone(j.get("slot_restored"))
        self.assertEqual([c for c in self.calls if c[0] == "restore"], [])

    def test_a_conversation_gets_its_own_state_back_after_another_one_ran(self):
        app._slot_after(self.job("a", "FULL"))
        app._slot_after(self.job("b", "FULL"))
        j = self.job("a", "FULL")
        app._slot_before(j)
        self.assertIs(j.get("slot_restored"), True)

    def test_a_conversation_saved_under_another_tool_list_is_not_restored(self):
        app._slot_after(self.job("a", "OLD"))
        app._slot_after(self.job("b", "NEW"))
        j = self.job("a", "NEW")
        app._slot_before(j)
        self.assertNotEqual(j.get("slot_restored"), True)

    def test_the_short_greeting_start_is_kept(self):
        app._slot_after(self.job("lite", "LITE", total=300))
        self.assertTrue(app._start_file("LITE").is_file())
        self.assertFalse((app.SLOT_DIR / "lite-LITE.bin").is_file())   # the short conversation itself is not kept, only its start
        app._slot_after(self.job("c1", "FULL"))
        j = self.job("lite2", "LITE", total=320)
        app._slot_before(j)
        self.assertEqual(j.get("slot_restored"), "start")


class WarmUp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.SLOT_DIR = Path(self.tmp.name)
        app._LAST.update(conv="", start="")
        app.JOBS.clear()
        while not app.QUEUE.empty():
            app.QUEUE.get()
        self.msgs = [{"role": "system", "content": "the bot's system text"}, {"role": "user", "content": "."}]
        self.tools = [{"type": "function", "function": {"name": "computer_run"}}]

    def tearDown(self):
        self.tmp.cleanup()

    def test_warm_queues_one_background_job_at_the_back_and_says_ready_once_saved(self):
        import json
        r = json.loads(app.warm(json.dumps(self.msgs), json.dumps(self.tools)))
        self.assertEqual(r["type"], "warming")
        again = json.loads(app.warm(json.dumps(self.msgs), json.dumps(self.tools)))
        self.assertEqual(again["job"], r["job"], "never two warm-ups of the same start")
        job = app.JOBS[r["job"]]
        self.assertTrue(job["warm"])
        self.assertFalse(app._stale(job), "nobody polls a warm-up: it is not stale for lack of polling")
        app.chat(json.dumps([{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}]), "", 10, "", 0.3, 0)
        order = []
        while not app.QUEUE.empty():
            order.append(app.QUEUE.get()[-1])
        self.assertEqual(order[-1], r["job"], "the warm-up is behind the person's request")
        self.assertTrue(job.get("cancel"), "a request with ANOTHER start cancels the warm-up")
        app._start_file(r["start"]).write_bytes(b"x")
        self.assertEqual(json.loads(app.warm(json.dumps(self.msgs), json.dumps(self.tools)))["type"], "ready")

    def test_a_request_with_the_same_start_keeps_the_warm_up(self):
        import json
        r = json.loads(app.warm(json.dumps(self.msgs), json.dumps(self.tools)))
        app.chat(json.dumps([self.msgs[0], {"role": "user", "content": "build me a site"}]), json.dumps(self.tools), 10, "", 0.3, 0)
        self.assertFalse(app.JOBS[r["job"]].get("cancel"))
        st = json.loads(app.status())
        self.assertEqual(st["queue"], 1, "a warm-up is not counted as someone waiting")


if __name__ == "__main__":
    unittest.main()
