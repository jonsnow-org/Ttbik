import unittest

from sham_v2_switch import decide

SERVED = {"bpb_after": {"ar": 0.92, "en": 0.99}, "tools_after": {"right": 80, "cases": 100}, "gate": {"ok": True}}


def cand(**over):
    c = {"bpb_after": {"ar": 0.60, "en": 0.78}, "tools_after": {"right": 80, "cases": 100}, "gate": {"ok": True}, "resident_gb": 6.4}
    c.update(over)
    return c


class SwitchDecision(unittest.TestCase):
    def test_better_candidate_switches(self):
        self.assertTrue(decide(SERVED, cand(), resident_gb=6.4, resident_limit_gb=8)["switch"])

    def test_each_refusal_reason(self):
        self.assertFalse(decide(SERVED, cand(gate={"ok": False}))["switch"])
        self.assertFalse(decide(SERVED, cand(bpb_after={"ar": 0.90, "en": 0.78}))["switch"])        # not better by 5 % in Arabic
        self.assertFalse(decide(SERVED, cand(bpb_after={"ar": 0.60, "en": 1.10}))["switch"])        # English lost
        self.assertFalse(decide(SERVED, cand(tools_after={"right": 40, "cases": 100}))["switch"])   # tools fell
        self.assertFalse(decide(SERVED, cand(), resident_gb=11.0, resident_limit_gb=8)["switch"])    # does not fit the Studio
        self.assertFalse(decide(SERVED, {"gate": {"ok": True}})["switch"])                          # unmeasured is not better


if __name__ == "__main__":
    unittest.main()
