"""web_search_text falls back to Bing's page when DuckDuckGo is blocked (the ModelScope Studio's network, measured 2026-11-16)."""
import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "colab", "sham_small"))


class SearchFallback(unittest.TestCase):
    def setUp(self):
        import sham_decoding
        self.m = sham_decoding

    def _ddgs(self, hits=None, boom=False):
        class D:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def text(self, *a, **k):
                if boom:
                    raise RuntimeError("blocked")
                return hits or []
        return types.SimpleNamespace(DDGS=D)

    def test_blocked_duckduckgo_uses_bing(self):
        web = types.SimpleNamespace(bing_search=lambda q, n=5: [{"body": "باريس هي عاصمة فرنسا"}])
        with mock.patch.dict(sys.modules, {"ddgs": self._ddgs(boom=True), "web_access": web}):
            self.assertIn("باريس", self.m.web_search_text("عاصمة فرنسا"))

    def test_empty_duckduckgo_uses_bing(self):
        web = types.SimpleNamespace(bing_search=lambda q, n=5: [{"body": "نتيجة بينغ"}])
        with mock.patch.dict(sys.modules, {"ddgs": self._ddgs(hits=[]), "web_access": web}):
            self.assertEqual(self.m.web_search_text("x"), "نتيجة بينغ")

    def test_duckduckgo_answer_is_kept_when_present(self):
        web = types.SimpleNamespace(bing_search=lambda q, n=5: [{"body": "لا يجب أن يُستعمل"}])
        with mock.patch.dict(sys.modules, {"ddgs": self._ddgs(hits=[{"body": "من دكدك"}]), "web_access": web}):
            self.assertEqual(self.m.web_search_text("x"), "من دكدك")

    def test_both_failing_returns_empty(self):
        def boom(q, n=5): raise RuntimeError("x")
        with mock.patch.dict(sys.modules, {"ddgs": self._ddgs(boom=True), "web_access": types.SimpleNamespace(bing_search=boom)}):
            self.assertEqual(self.m.web_search_text("x"), "")


if __name__ == "__main__":
    unittest.main()
