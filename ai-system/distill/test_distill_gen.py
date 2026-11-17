import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distill_gen as D  # noqa: E402

OPEN = {"id": "t1", "class": "open", "enabled": True, "endpoint": "http://x", "model": "m", "license": "Apache-2.0"}
OPEN2 = {**OPEN, "id": "t2"}
COM = {"id": "c1", "class": "restricted", "enabled": True, "owner_approved": False, "endpoint": "http://y", "model": "m"}


class Rules(unittest.TestCase):
    def test_restricted_is_refused_without_owner_approval_and_env(self):
        self.assertFalse(D.teacher_allowed(COM, {})[0])
        self.assertFalse(D.teacher_allowed({**COM, "owner_approved": True}, {})[0])
        self.assertFalse(D.teacher_allowed(COM, {"SHAM_DISTILL_ALLOW_RESTRICTED": "c1"})[0])
        self.assertTrue(D.teacher_allowed({**COM, "owner_approved": True}, {"SHAM_DISTILL_ALLOW_RESTRICTED": "c1"})[0])

    def test_the_shipped_registry_has_no_restricted_source_switched_on(self):
        for t in D.load_registry().values():
            if t["class"] == "restricted":
                self.assertFalse(t.get("owner_approved"))

    def test_an_answer_that_names_its_teacher_never_passes(self):
        recs, st = D.run([{"prompt": "من أنت؟", "task": "natural_sft", "accept": "first"}], [OPEN], ask_fn=lambda t, p: "أنا Qwen من Alibaba")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "failed")

    def test_think_blocks_are_removed(self):
        self.assertEqual(D.clean_answer("<think>x</think>102"), "102")

    def test_verified_arithmetic_passes_and_a_wrong_answer_fails(self):
        rows = [{"prompt": "احسب 17 × 6.", "task": "reasoning", "verifier": "numeric_match", "verification": {"expected": 102}}]
        recs, st = D.run(rows, [OPEN], ask_fn=lambda t, p: "102")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "passed")
        recs, st = D.run(rows, [OPEN], ask_fn=lambda t, p: "103")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "failed")
        self.assertFalse(recs[0]["metadata"]["reviewed"])

    def test_unverifiable_knowledge_needs_two_teachers_to_agree(self):
        rows = [{"prompt": "عاصمة فرنسا؟", "task": "natural_sft"}]
        recs, st = D.run(rows, [OPEN, OPEN2], ask_fn=lambda t, p: "عاصمة فرنسا هي باريس")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "passed")
        answers = {"t1": "باريس", "t2": "مدينة ليون الكبرى جنوب البلاد"}
        recs, st = D.run(rows, [OPEN, OPEN2], ask_fn=lambda t, p: answers[t["id"]])
        self.assertEqual(recs[0]["metadata"]["verification_status"], "pending")
        recs, st = D.run(rows, [OPEN], ask_fn=lambda t, p: "باريس")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "pending")

    def test_a_refused_or_failing_teacher_never_crashes(self):
        def boom(t, p): raise OSError("down")
        recs, st = D.run([{"prompt": "x"}], [OPEN, COM], ask_fn=boom)
        self.assertEqual(recs, []); self.assertIn("c1", st["refused"])

    def test_style_prompts_take_one_open_teachers_answer_and_expansion_adds_new_questions(self):
        recs, st = D.run([{"prompt": "اشرح الجاذبية", "task": "natural_sft", "accept": "first"}], [OPEN], ask_fn=lambda t, p: "الجاذبية قوة تجذب الأجسام")
        self.assertEqual(recs[0]["metadata"]["verification_status"], "passed")
        self.assertEqual(recs[0]["metadata"]["accept_mode"], "single_teacher")
        rows = [{"prompt": "ما عاصمة مصر؟", "task": "natural_sft", "topic": "facts", "accept": "agree"}]
        out = D.expand(rows, OPEN, 3, ask_fn=lambda t, p: "- ما عاصمة اليابان؟\n2. ما عاصمة إسبانيا؟\nما عاصمة مصر؟\nx")
        self.assertEqual([r["prompt"] for r in out], ["ما عاصمة مصر؟", "ما عاصمة اليابان؟", "ما عاصمة إسبانيا؟"])
        self.assertEqual(out[1]["accept"], "agree")


if __name__ == "__main__":
    unittest.main()
