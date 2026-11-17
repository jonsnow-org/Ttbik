import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_pool as P  # noqa: E402


class T(unittest.TestCase):
    def test_merge_keeps_only_accepted_and_new_prompts(self):
        old = [{"prompt": "س1", "target": "ج", "metadata": {"verification_status": "owner_accepted"}}]
        new = [{"prompt": "س1", "target": "x", "metadata": {"verification_status": "passed"}},
               {"prompt": "س2", "target": "y", "metadata": {"verification_status": "passed"}},
               {"prompt": "س3", "target": "z", "metadata": {"verification_status": "pending"}},
               {"prompt": " س4 ", "target": "w", "metadata": {"verification_status": "owner_accepted"}}]
        out, added = P.merge(old, new)
        self.assertEqual(added, 2); self.assertEqual([r["prompt"] for r in out], ["س1", "س2", " س4 "])


if __name__ == "__main__":
    unittest.main()
