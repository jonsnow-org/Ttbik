"""Sampling must not fail a whole reply on non-finite probabilities (live 2026-11-16: every Sham v1 reply died with
'probability tensor contains either inf, nan or element < 0')."""
import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small"))
import generate  # noqa: E402


class SamplingTest(unittest.TestCase):
    def test_nan_and_inf_logits_still_give_a_token(self):
        generate._NAN_REPORTED = True      # keep the test output quiet
        logits = torch.tensor([[float("nan"), 1.0, 2.0, float("inf")]])
        out = generate._sample_from_logits(logits, temperature=0.8, top_k=3, top_p=0.9)
        self.assertEqual(tuple(out.shape), (1, 1))
        self.assertIn(int(out[0, 0]), range(4))

    def test_all_masked_row_does_not_raise(self):
        generate._NAN_REPORTED = True
        out = generate._sample_from_logits(torch.full((1, 6), float("-inf")), temperature=1.0)
        self.assertEqual(tuple(out.shape), (1, 1))

    def test_normal_logits_unchanged(self):
        torch.manual_seed(0)
        out = generate._sample_from_logits(torch.tensor([[0.0, 0.0, 50.0]]), temperature=1.0)
        self.assertEqual(int(out[0, 0]), 2)


if __name__ == "__main__":
    unittest.main()
