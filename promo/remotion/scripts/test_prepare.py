import json
import unittest
from pathlib import Path

from prepare import is_ready, no_episode_reason, select_episode


class EpisodeQueueTests(unittest.TestCase):
    def setUp(self):
        self.episodes = [
            {"id": 1, "title": "public tool"},
            {"id": 2, "needs": "znbt"},
            {"id": 3, "needs": "platform"},
        ]

    def test_selects_next_unrendered_unrestricted_episode(self):
        self.assertEqual(select_episode(self.episodes, set())["id"], 1)

    def test_waits_for_znbt_launch_and_platform_open_state(self):
        self.assertFalse(is_ready(self.episodes[1], launched=False, opened=False))
        self.assertTrue(is_ready(self.episodes[1], launched=True, opened=False))
        self.assertFalse(is_ready(self.episodes[2], launched=True, opened=False))
        self.assertTrue(is_ready(self.episodes[2], launched=True, opened=True))
        self.assertIsNone(select_episode(self.episodes[1:], set(), launched=False, opened=False))
        self.assertEqual(select_episode(self.episodes[1:], set(), launched=True)["id"], 2)
        self.assertEqual(select_episode(self.episodes[1:], {2}, launched=True, opened=True)["id"], 3)

    def test_queue_exhaustion_is_explicit(self):
        self.assertIsNone(select_episode(self.episodes, {1, 2, 3}))
        reason = no_episode_reason(self.episodes, {1, 2, 3})
        self.assertIn("QUEUE_EXHAUSTED", reason)

    def test_blocked_queue_is_not_mistaken_for_exhaustion(self):
        reason = no_episode_reason(self.episodes[1:], set(), launched=False, opened=False)
        self.assertIn("NO_READY_EPISODE", reason)
        self.assertIn("2, 3", reason)


    def test_daily_queue_refill_contains_two_distinct_ready_existing_tools(self):
        catalog_path = Path(__file__).resolve().parents[1] / "episodes.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        episodes = catalog["episodes"]
        ids = [int(item["id"]) for item in episodes]
        self.assertEqual(len(ids), len(set(ids)))

        by_id = {int(item["id"]): item for item in episodes}
        invoice = by_id[20]
        analytics = by_id[21]
        self.assertTrue(is_ready(invoice))
        self.assertTrue(is_ready(analytics))
        self.assertEqual(invoice["path"], "/free-tools/invoice-generator")
        self.assertEqual(len(invoice["input"].splitlines()), 11)
        self.assertEqual(analytics["path"], "/free-tools/behavior-analytics")
        self.assertEqual(analytics["input"], "")

        done = set(range(1, 20))
        self.assertEqual(select_episode(episodes, done)["id"], 20)
        self.assertEqual(select_episode(episodes, done | {20})["id"], 21)

    def test_forced_episode_preserves_explicit_rerender_behavior(self):
        self.assertEqual(select_episode(self.episodes, {1, 2, 3}, forced_id="2")["id"], 2)
        self.assertIn("FORCED_EPISODE_NOT_FOUND", no_episode_reason(self.episodes, set(), forced_id="99"))


if __name__ == "__main__":
    unittest.main()
