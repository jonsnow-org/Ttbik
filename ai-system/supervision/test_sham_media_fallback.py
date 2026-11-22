"""A clip the model cannot make (no motion token rows in its vocabulary) must come back as words, not as a failed reply
(live 2026-11-16: 'IndexError: index out of range in self' + 'probability tensor contains inf/nan' on plain messages)."""
import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small"))
import sham_studio_media as media  # noqa: E402
from model import ShamSmall, ShamSmallConfig, SpecialTokens, TOTAL_VOCAB_SIZE  # noqa: E402


class Tok:
    vocab_size = 400

    def encode(self, t):
        return [3 + (ord(c) % 390) for c in t]

    def decode(self, ids):
        return "".join(chr(0x0621 + (i % 40)) for i in ids)


class MediaFallbackTest(unittest.TestCase):
    def test_video_without_motion_rows_answers_in_words(self):
        torch.manual_seed(0)
        cfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE - 1024, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=512)
        model = ShamSmall(cfg).train(False)
        out = media.generate_any(model, Tok(), None, None, "مرحبا", 4, choose=lambda *a, **k: SpecialTokens.VIDEO_START, motion_tokenizer=object())
        self.assertEqual(out["type"], "text")


if __name__ == "__main__":
    unittest.main()
