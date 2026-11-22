import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.compress import MIN_VIDEO_BPS, STREAM_LIMIT_BYTES, pick_height, plan_bitrate


class CompressPlanTests(unittest.TestCase):
    def test_bitrate_fits_the_limit(self):
        for duration in (15, 60, 300, 600):
            bps = plan_bitrate(duration) + 64_000
            self.assertLessEqual(bps * duration / 8, STREAM_LIMIT_BYTES)

    def test_floor_for_very_long_clips(self):
        self.assertEqual(plan_bitrate(36_000), MIN_VIDEO_BPS)
        self.assertEqual(plan_bitrate(0), MIN_VIDEO_BPS)

    def test_shrink_lowers_bitrate(self):
        self.assertLess(plan_bitrate(120, shrink=0.72), plan_bitrate(120))

    def test_resolution_follows_bitrate(self):
        self.assertEqual([pick_height(b) for b in (2_000_000, 1_000_000, 500_000, 200_000)], [720, 540, 480, 360])


if __name__ == "__main__":
    unittest.main()
