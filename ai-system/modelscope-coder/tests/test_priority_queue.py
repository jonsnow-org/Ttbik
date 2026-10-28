"""Pro / owner jobs go ahead in the Studio's one-at-a-time queue (bounded: PRIORITY_BOOST_S, so free jobs never starve).
Run: python -m unittest ai-system/modelscope-coder/tests/test_priority_queue.py"""
import importlib.util
import json
import os
import time
import unittest

os.environ["CODER_MODEL_PATH"] = "/nonexistent"
spec = importlib.util.spec_from_file_location("coder_app", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def drain():
    out = []
    while not app.QUEUE.empty():
        out.append(app.QUEUE.get()[-1])
    return out


def add(jid, priority, created, status="queued"):
    job = {"messages": [{"role": "user", "content": "x"}], "status": status, "text": "", "reasoning": "", "created": created, "seen": time.time(),
           "priority": 1 if priority else 0}
    app.JOBS[jid] = job
    if status == "queued":
        app.enqueue(jid)
    return job


class PriorityQueue(unittest.TestCase):
    def setUp(self):
        app.JOBS.clear()
        drain()
        self.t = time.time()

    def test_pro_job_goes_ahead_of_free_jobs_that_arrived_shortly_before(self):
        add("free1", 0, self.t - 30)
        add("free2", 0, self.t - 20)
        add("pro", 1, self.t - 1)
        self.assertEqual(drain(), ["pro", "free1", "free2"])

    def test_equal_priority_stays_first_come_first_served(self):
        add("a", 1, self.t - 3)
        add("b", 1, self.t - 2)
        add("c", 0, self.t - 1)
        add("d", 0, self.t)
        self.assertEqual(drain(), ["a", "b", "c", "d"])

    def test_free_job_that_waited_long_is_not_starved_by_a_late_pro_job(self):
        add("old_free", 0, self.t - (app.PRIORITY_BOOST_S + 60))
        add("pro", 1, self.t)
        self.assertEqual(drain(), ["old_free", "pro"])

    def test_queue_position_follows_the_same_order_and_running_job_stays_first(self):
        add("running", 0, self.t - 100, status="running")
        add("free", 0, self.t - 50)
        add("pro", 1, self.t - 1)
        self.assertEqual(app._queue_pos("running"), 0)
        self.assertEqual(app._queue_pos("pro"), 1)
        self.assertEqual(app._queue_pos("free"), 2)

    def test_chat_reads_priority_and_ignores_garbage(self):
        for given, want in ((1, 1), ("1", 1), (0, 0), (None, 0), ("abc", 0), (-5, 0)):
            drain(), app.JOBS.clear()
            r = json.loads(app.chat(json.dumps([{"role": "user", "content": "hi"}]), "", 0, "", 0.6, 0, given))
            self.assertEqual(app.JOBS[r["job"]]["priority"], want, given)

    def test_chat_without_priority_still_works_for_old_clients(self):
        r = json.loads(app.chat(json.dumps([{"role": "user", "content": "hi"}]), "", 0, "", 0.6, 0))
        self.assertEqual(app.JOBS[r["job"]]["priority"], 0)


if __name__ == "__main__":
    unittest.main()
