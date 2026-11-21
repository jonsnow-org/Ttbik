import unittest

import sham_extra_sources as X


class ExtraSources(unittest.TestCase):
    def test_selftest(self):
        X._selftest()

    def test_the_chat_plan_has_the_source_after_the_yardstick_and_can_be_switched_off(self):
        import os
        import sham_chat
        names = [p[0] for p in sham_chat._chat_plan()]
        assert "fineweb2_ar" in names and names[:4] == ["cidar", "aya_ar", "alpaca_gpt4_ar", "openhermes_ar"]
        assert "fineweb2_ar" not in [p[0] for p in sham_chat._chat_plan(extra=False)]          # the merge gate's yardstick never moves
        os.environ["SHAM_FINEWEB_AR"] = "0"
        try:
            assert "fineweb2_ar" not in [p[0] for p in sham_chat._chat_plan()]
        finally:
            os.environ.pop("SHAM_FINEWEB_AR")


if __name__ == "__main__":
    unittest.main()
