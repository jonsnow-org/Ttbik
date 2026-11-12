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
