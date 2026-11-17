import os
import sys
import unittest
from pathlib import Path

import sham_sil_bridge as B

HERE = Path(__file__).resolve().parent


class Bridge(unittest.TestCase):
    def setUp(self):
        for k in ("SHAM_SIL", "SHAM_SIL_TASKS", "SHAM_SIL_ARITH", "SHAM_SIL_ALLOW_TEACHER"):
            os.environ.pop(k, None)

    def test_pairs_are_verified_deterministic_and_never_the_frozen_set(self):
        frozen = {B._key(r["prompt"]) for r in B.heldout_rows(100)}
        a = B.train_pairs(300, 11)
        self.assertTrue(a)
        self.assertEqual(a, B.train_pairs(300, 11))
        self.assertFalse(any(B._key(q) in frozen for q, _ in a))

    def test_plain_arithmetic_and_uncertainty_are_not_trained_by_default(self):
        tasks = {B._key(q): None for q, _ in B.train_pairs(2000, 3)}
        self.assertFalse(any(q.startswith("احسب الناتج بدقة") for q in tasks))
        os.environ["SHAM_SIL_ARITH"] = "1"
        self.assertTrue(any(q.startswith("احسب الناتج بدقة") for q, _ in B.train_pairs(2000, 3)))

    def test_teacher_records_never_pass_by_default(self):
        class _Ex:
            task, source_kind, verifier, metadata = "reasoning", "teacher", "none", {"reviewed": True, "verification_status": "passed"}
        self.assertFalse(B._allowed(_Ex, {"reasoning"}))
        os.environ["SHAM_SIL_ALLOW_TEACHER"] = "1"
        self.assertTrue(B._allowed(_Ex, {"reasoning"}))
        _Ex.metadata = {"reviewed": False}
        self.assertFalse(B._allowed(_Ex, {"reasoning"}))

    def test_switch_off(self):
        os.environ["SHAM_SIL"] = "0"
        self.assertEqual(B.train_pairs(50, 1), [])

    def test_chat_plan_has_the_source_but_the_gate_yardstick_does_not(self):
        try:
            import datasets  # noqa: F401  (the CPU CI job has no `datasets`; the plan imports it)
        except ImportError:
            self.skipTest("datasets is not installed here")
        import sham_chat as C
        self.assertIn("sil", [p[0] for p in C._chat_plan()])
        self.assertNotIn("sil", [p[0] for p in C._chat_plan(extra=False)])

    def test_the_labs_own_tests_pass(self):
        sys.path.insert(0, str(B.LAB_SRC))
        suite = unittest.defaultTestLoader.discover(str(HERE / "intelligence_lab" / "tests"), top_level_dir=str(HERE / "intelligence_lab" / "tests"))
        result = unittest.TextTestRunner(stream=open(os.devnull, "w")).run(suite)
        self.assertTrue(result.wasSuccessful(), [str(f[0]) for f in result.failures + result.errors])


if __name__ == "__main__":
    unittest.main()


class TeacherPoolTests(unittest.TestCase):
    def setUp(self):
        import json
        import tempfile
        self.json = json
        self.d = tempfile.mkdtemp()
        rows = [
            {"prompt": "ما عاصمة مصر؟", "target": "القاهرة", "metadata": {"reviewed": True, "verification_status": "owner_accepted"}},
            {"prompt": "سؤال لم يُقبل", "target": "جواب", "metadata": {"reviewed": False, "verification_status": "pending"}},
            {"prompt": "سؤال بحالة أخرى", "target": "جواب", "metadata": {"reviewed": True, "verification_status": "failed"}},
            {"prompt": "ما عاصمة مصر؟", "target": "مكرر", "metadata": {"reviewed": True, "verification_status": "passed"}},
        ]
        self.f = os.path.join(self.d, "r.jsonl")
        open(self.f, "w", encoding="utf-8").write("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\nnot json\n")
        os.environ["SHAM_TEACHER_JSONL"] = self.f
        B._TEACHER_CACHE.clear()

    def tearDown(self):
        os.environ.pop("SHAM_TEACHER_JSONL", None)
        B._TEACHER_CACHE.clear()

    def test_only_accepted_records_enter_and_duplicates_are_dropped(self):
        self.assertEqual(B.teacher_pairs(10, 1), [("ما عاصمة مصر؟", "القاهرة")])

    def test_a_held_out_prompt_never_enters(self):
        self.assertEqual(B.teacher_pairs(10, 1, {B._key("ما عاصمة مصر؟")}), [])

    def test_train_pairs_mixes_the_pool_in_and_respects_the_off_switch(self):
        pairs = B.train_pairs(20, 3)
        self.assertIn(("ما عاصمة مصر؟", "القاهرة"), pairs)
        os.environ["SHAM_TEACHER_JSONL"] = os.path.join(self.d, "missing.jsonl")
        B._TEACHER_CACHE.clear()
        self.assertEqual(B.teacher_pairs(5, 1), [])
