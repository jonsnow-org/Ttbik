"""Sham's live search must still find sources when DuckDuckGo is blocked (the ModelScope Studio's network): Bing's page is the fallback."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

BING_HTML = """<html><body><ol>
<li class="b_algo"><h2><a href="https://example.org/a">عنوان أول</a></h2><div class="b_caption"><p>مقتطف أول عن الموضوع</p></div></li>
<li class="b_algo"><h2><a href="/relative">ليس رابطا</a></h2></li>
<li class="b_algo"><h2><a href="https://example.org/b">Second</a></h2><p>second snippet</p></li>
</ol></body></html>"""


class BingFallback(unittest.TestCase):
    def test_bing_search_parses_results_and_skips_relative_links(self):
        from web_access import bing_search
        resp = MagicMock(status_code=200, text=BING_HTML)
        with patch("requests.get", return_value=resp):
            out = bing_search("عنوان مقتطف second", 5)
        self.assertEqual([o["href"] for o in out], ["https://example.org/a", "https://example.org/b"])
        self.assertEqual(out[0]["body"], "مقتطف أول عن الموضوع")

    def test_unrelated_results_are_dropped_and_redirects_unwrapped(self):
        import base64
        from web_access import bing_search
        real = "https://example.org/real"
        wrapped = "https://www.bing.com/ck/a?!&&p=x&u=a1" + base64.urlsafe_b64encode(real.encode()).decode().rstrip("=") + "&ntb=1"
        html = f'<ol><li class="b_algo"><h2><a href="{wrapped}">Paris capital</a></h2><p>France</p></li><li class="b_algo"><h2><a href="https://ads.example/x">Payment providers</a></h2><p>cards</p></li></ol>'
        with patch("requests.get", return_value=MagicMock(status_code=200, text=html)):
            out = bing_search("capital of France", 5)
        self.assertEqual([o["href"] for o in out], [real])          # the ad shares no word with the question; the link is the real page

    def test_bing_search_never_raises(self):
        from web_access import bing_search
        with patch("requests.get", side_effect=OSError("network down")):
            self.assertEqual(bing_search("x"), [])
        with patch("requests.get", return_value=MagicMock(status_code=403, text="")):
            self.assertEqual(bing_search("x"), [])

    def test_search_hits_falls_back_to_bing_when_ddgs_is_blocked(self):
        import self_learn
        fake = [{"title": "T", "body": "B", "href": "https://example.org/z"}]
        with patch.dict(sys.modules, {"ddgs": MagicMock(DDGS=MagicMock(side_effect=RuntimeError("blocked")))}), \
             patch("web_access.bing_search", return_value=fake):
            hits = self_learn.search_hits("سؤال")
        self.assertEqual([h.href for h in hits], ["https://example.org/z"])


if __name__ == "__main__":
    unittest.main()
