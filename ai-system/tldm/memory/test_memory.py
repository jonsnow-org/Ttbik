"""Long-term file memory of the hidden terminal (memory/store.py + serve_adapter.TLDMChat). Stdlib + the sandbox terminal only (no torch, no model):
the writer is a scripted double, so these tests check the memory, not a model. Run: python -m unittest discover -s ai-system/tldm/memory -p 'test_*.py' -v"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, HERE, os.path.join(ROOT, "data"), os.path.join(ROOT, "..", "terminal")):
    sys.path.insert(0, p)
import serve_adapter  # noqa: E402
import terminal_tasks as T  # noqa: E402
from store import MemoryStore  # noqa: E402

TASK = "how many lines does the log have"


def count_writer(calls):
    def w(task, hist):
        calls.append(list(hist))
        return "$ wc -l app.log" if not hist else f"Result: {hist[-1][1]}."
    return w


class MemoryTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="tldm_mem_")
        self.terms = []

    def tearDown(self):
        for t in self.terms:
            t.close()

    def chat(self, writer, model_id="sham_v2", factory=None):
        def backend(_session):
            t = factory() if factory else T.fresh()
            self.terms.append(t)
            return t
        return serve_adapter.TLDMChat(writer, backend, confirm=lambda c: True, memory_factory=lambda s: serve_adapter.memory_for(self.root, model_id, s))

    def test_recall_replays_a_finished_task_with_no_model_call_and_the_same_final_state(self):
        c1 = self.chat(count_writer([]))
        reply1, _ = c1.respond("s1", TASK)
        self.assertEqual((c1.last_info["mode"], c1.last_info["writer_calls"]), ("model", 2))
        self.assertTrue(reply1.startswith("Result: "))

        def refuse(task, hist):
            raise AssertionError("the model must not be called for a remembered task")
        c2 = self.chat(refuse)
        reply2, events = c2.respond("s1", TASK)
        self.assertEqual(reply2, reply1)
        self.assertEqual(c2.last_info, {"mode": "recall", "writer_calls": 0, "replayed": 1, "lessons": 0})
        self.assertEqual([e.command for e in events], ["wc -l app.log"], "recall really runs the remembered commands: the result is checked, not assumed")
        self.assertEqual(T.snapshot(self.terms[0]), T.snapshot(self.terms[1]))

    def test_recall_stops_at_the_first_different_result_and_the_model_continues_from_the_real_history(self):
        reply1, _ = self.chat(count_writer([])).respond("s1", TASK)

        def changed():
            t = T.fresh()
            with open(os.path.join(t.dir, "app.log"), "a", encoding="utf-8") as f:
                f.write("INFO one more line\n")
            return t
        calls = []
        c2 = self.chat(count_writer(calls), factory=changed)
        reply2, _ = c2.respond("s1", TASK)
        self.assertEqual((c2.last_info["mode"], c2.last_info["replayed"]), ("recall+model", 1))
        self.assertNotEqual(reply2, reply1)
        self.assertEqual(calls[0][-1][0], "wc -l app.log", "the model continues after the replayed command")
        self.assertEqual(reply2, "Result: " + calls[0][-1][1] + ".", "the model sees the PRESENT result, not the remembered one")

    def test_lessons_a_command_that_failed_for_the_task_is_not_run_again(self):
        def w(task, hist):
            if not hist:
                return "$ cat missing.txt"
            return "$ ls" if hist[-1][1] == serve_adapter.LESSON else "Done."
        self.chat(w).respond("s1", "show the notes")
        store = serve_adapter.memory_for(self.root, "sham_v2", "s1")
        self.assertIsNone(store.recall("show the notes"), "a failed command makes the episode a lesson, not a success")
        self.assertEqual(store.failed_commands("show the notes"), {"cat missing.txt"})
        c2 = self.chat(w)
        reply, events = c2.respond("s1", "show the notes")
        self.assertEqual([e.command for e in events], ["ls"])
        self.assertEqual((c2.last_info["lessons"], reply), (1, "Done."))
        self.assertIsNotNone(store.recall("show the notes"), "the corrected episode is remembered as a success")
        self.assertEqual(store.failed_commands("show the notes"), {"cat missing.txt"}, "only the command that failed is a lesson")

    def test_memory_is_per_model_and_per_session(self):
        self.chat(count_writer([]), model_id="sham").respond("s1", TASK)
        self.assertIsNotNone(serve_adapter.memory_for(self.root, "sham", "s1").recall(TASK))
        self.assertIsNone(serve_adapter.memory_for(self.root, "sham_v2", "s1").recall(TASK), "no memory crosses from one model to another")
        self.assertIsNone(serve_adapter.memory_for(self.root, "sham", "s2").recall(TASK), "no memory crosses from one user to another unless shared")
        calls = []
        c2 = self.chat(count_writer(calls), model_id="sham_v2")
        c2.respond("s1", TASK)
        self.assertEqual((c2.last_info["mode"], len(calls)), ("model", 2))

    def test_a_damaged_memory_file_is_forgotten_not_a_crash(self):
        self.chat(count_writer([])).respond("s1", TASK)
        store = serve_adapter.memory_for(self.root, "sham_v2", "s1")
        path = store._path(TASK, True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("{broken")
        calls = []
        c2 = self.chat(count_writer(calls))
        c2.respond("s1", TASK)
        self.assertEqual((c2.last_info["mode"], len(calls)), ("model", 2))

    def test_off_by_default_and_the_serving_path_imports_no_torch(self):
        code = ("import sys; sys.path.insert(0, %r); import serve_adapter; "
                "assert 'torch' not in sys.modules, 'serve_adapter must not import torch'; "
                "c = serve_adapter.TLDMChat(lambda t, h: 'hi', lambda s: None); assert c.memory_factory is None; "
                "assert serve_adapter.enabled() is False; print('ok')") % ROOT
        env = {k: v for k, v in os.environ.items() if k != "SHAM_TLDM"}
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "ok"), r.stderr[-500:])

    def test_old_records_keep_their_meaning_for_training_evolve(self):
        st = MemoryStore(self.root)
        st.save("t", [("ls", "a"), ("cat x", "")], "r", False)
        self.assertEqual(st.failed_commands("t"), {"ls", "cat x"}, "a record without the ok flag: every command of the failed episode (what evolve.py expects)")
        st.save("t", [("pwd", "/w", True), ("cat y", "no", False)], "r", False)
        self.assertEqual(st.failed_commands("t"), {"ls", "cat x", "cat y"})
        st.save("u", [("ls", "a", True)], "ok", True)
        self.assertTrue(st.recall("U "))
        self.assertTrue(st.forget("u"))
        self.assertIsNone(st.recall("u"))


if __name__ == "__main__":
    unittest.main()
