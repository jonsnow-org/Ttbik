import sys
import types
import unittest

sys.modules.setdefault("datasets", types.SimpleNamespace(load_dataset=lambda *a, **k: None))      # the CI image has no `datasets`: the plan is only listed, never opened
import sham_extra_sources as X


class ExtraSources(unittest.TestCase):
    def test_selftest(self):
        X._selftest()

    def test_the_chat_plan_has_the_source_after_the_yardstick_and_can_be_switched_off(self):
        import os
        import sham_chat
        names = [p[0] for p in sham_chat._chat_plan()]
        assert set(X.SOURCES) <= set(names) and names[:4] == ["cidar", "aya_ar", "alpaca_gpt4_ar", "openhermes_ar"]
        assert not set(X.SOURCES) & {p[0] for p in sham_chat._chat_plan(extra=False)}          # the merge gate's yardstick never moves
        os.environ["SHAM_FINEWEB_AR"] = "0"
        try:
            assert not set(X.SOURCES) & {p[0] for p in sham_chat._chat_plan()}
        finally:
            os.environ.pop("SHAM_FINEWEB_AR")


if __name__ == "__main__":
    unittest.main()
