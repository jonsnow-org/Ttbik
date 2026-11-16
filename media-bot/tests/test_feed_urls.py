import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import feed


class FeedUrlTests(unittest.TestCase):
    def test_gate_is_always_a_fallback(self):
        os.environ["FEED_API_URL"] = "http://internal:3000/api/media-feed"
        urls = feed._feed_urls()
        self.assertEqual(urls[0], "http://internal:3000/api/media-feed")
        self.assertEqual(urls[-1], f"{feed.DEFAULT_SITE}/api/media-feed")
        self.assertEqual(feed._site_bases()[-1], feed.DEFAULT_SITE)

    def test_no_duplicate_when_already_the_gate(self):
        os.environ["FEED_API_URL"] = f"{feed.DEFAULT_SITE}/api/media-feed"
        self.assertEqual(len(feed._feed_urls()), 1)
        self.assertEqual(len(feed._site_bases()), 1)


if __name__ == "__main__":
    unittest.main()
