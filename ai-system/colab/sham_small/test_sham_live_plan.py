"""The Studio trainers narrow what the live trainer collects through SHAM_LIVE_KINDS / SHAM_LIVE_TARGETS (collection_plan); unset must change nothing."""
import unittest

import sham_live


class CollectionPlan(unittest.TestCase):
    def test_unset_is_the_default_mix(self):
        shares, kinds = sham_live.collection_plan({})
        self.assertEqual(shares, sham_live.TARGETS)
        self.assertIsNone(kinds)

    def test_one_kind_gets_everything(self):
        shares, kinds = sham_live.collection_plan({"SHAM_LIVE_KINDS": "image"})
        self.assertEqual(kinds, {"image"})
        self.assertAlmostEqual(shares["image"], 1.0)

    def test_explicit_shares_are_normalised(self):
        shares, kinds = sham_live.collection_plan({"SHAM_LIVE_TARGETS": "image:0.8,text:0.2", "SHAM_LIVE_KINDS": "image,text"})
        self.assertAlmostEqual(shares["image"], 0.8)
        self.assertAlmostEqual(sum(shares.values()), 1.0)
        self.assertEqual(kinds, {"image", "text"})

    def test_garbage_falls_back(self):
        shares, kinds = sham_live.collection_plan({"SHAM_LIVE_TARGETS": "junk,x:y", "SHAM_LIVE_KINDS": "nothing"})
        self.assertEqual(shares, sham_live.TARGETS)
        self.assertIsNone(kinds)


if __name__ == "__main__":
    unittest.main()
