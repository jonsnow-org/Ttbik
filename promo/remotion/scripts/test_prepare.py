import unittest

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

    def test_forced_episode_preserves_explicit_rerender_behavior(self):
        self.assertEqual(select_episode(self.episodes, {1, 2, 3}, forced_id="2")["id"], 2)
        self.assertIn("FORCED_EPISODE_NOT_FOUND", no_episode_reason(self.episodes, set(), forced_id="99"))


if __name__ == "__main__":
    unittest.main()
