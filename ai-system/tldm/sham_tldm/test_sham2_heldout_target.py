"""Credential-free regression tests for the Run 9 trainer crash (KeyError: 'target').

Run 9 (Actions run 44571660519, 2026-11-19) trained the whole requested partial
scope -- identity 16 + terminal 30 = 46 examples, 600/600 terminal steps -- and
then died on the *first* held-out row:

    File "ai-system/tldm/sham_tldm/sham2_unified.py", line 1605,
      in train_sham2_unified
        exact += int(predicted_text == str(row["target"]).strip())
    KeyError: 'target'

``_encode_rows`` only returned ``input_ids``, ``target_ids``, ``valid_mask``,
``target_bytes`` and ``stage`` -- never the target text -- so the held-out
exact-match comparison could never succeed and no head was ever saved.

These tests use the real committed JSONL rows with an offline stand-in
tokenizer: no token, no network, no donor checkpoint, no optimizer run.  They
fail with ``KeyError: 'target'`` on the pre-fix trainer and pass after it.

Run with:

    python -m unittest discover -s ai-system/tldm/sham_tldm -p 'test_sham2_heldout_target.py' -v
"""
from __future__ import annotations

import importlib
import inspect
import json
import os
import pathlib
import sys
import unittest

MODULE_DIR = pathlib.Path(__file__).resolve().parent
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

sham2_unified = importlib.import_module("sham2_unified")

DATA_DIR = pathlib.Path(
    os.environ.get("SHAM2_DATA_DIR") or (MODULE_DIR.parent / "data" / "sham2_export")
)
BLOCK = 192            # Sham2UnifiedConfig.block
VOCAB_SIZE = 162192    # verified donor vocabulary


class _FakeEncoding:
    def __init__(self, ids):
        self.ids = ids


class _FakeTokenizer:
    """Deterministic in-vocabulary ids; the real tokenizer is not needed here."""

    def encode(self, text):
        raw = str(text).encode("utf-8")[:32]
        ids = [1000 + (byte % 4096) for byte in raw]
        return _FakeEncoding(ids or [1000])


class _FakeConfig:
    max_seq_len = 2048
    block = BLOCK


def _load(name):
    path = DATA_DIR / name
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


class EncodeRowsKeepsTargetTest(unittest.TestCase):
    def setUp(self):
        self.tokenizer = _FakeTokenizer()
        self.cfg = _FakeConfig()
        self.train_rows = _load("train.jsonl")
        self.heldout_rows = _load("heldout.jsonl")

    def test_encoded_rows_keep_the_target_text(self):
        encoded = sham2_unified._encode_rows(
            self.train_rows, self.tokenizer, self.cfg, VOCAB_SIZE, "training"
        )
        self.assertEqual(len(encoded), 46)
        for source, row in zip(self.train_rows, encoded):
            # This is the exact lookup that raised KeyError: 'target'.
            self.assertIn("target", row)
            self.assertEqual(str(row["target"]).strip(), str(source["target"]).strip())

    def test_heldout_exact_match_expression_never_raises(self):
        encoded = sham2_unified._encode_rows(
            self.heldout_rows, self.tokenizer, self.cfg, VOCAB_SIZE, "heldout"
        )
        self.assertEqual(len(encoded), 26)
        exact = 0
        for row in encoded:
            predicted_text = sham2_unified.decode_target_bytes(row["target_ids"])
            exact += int(predicted_text == str(row["target"]).strip())
        # The --target_ids decode is the byte contract the trainer compares
        # against, so a perfect decode of the encoder output must match.
        self.assertEqual(exact, len(encoded))

    def test_target_bytes_stay_the_encoded_length(self):
        encoded = sham2_unified._encode_rows(
            self.heldout_rows, self.tokenizer, self.cfg, VOCAB_SIZE, "heldout"
        )
        for source, row in zip(self.heldout_rows, encoded):
            expected = len(str(source["target"]).encode("utf-8"))
            self.assertEqual(row["target_bytes"], expected)
            self.assertEqual(sum(row["valid_mask"]), expected + 1)


class HeadIsSavedBeforeHeldoutEvaluationTest(unittest.TestCase):
    def test_head_save_precedes_the_heldout_loop(self):
        source = inspect.getsource(sham2_unified.train_sham2_unified)
        save_at = source.index('save_path = out / "sham2_heads.pt"')
        heldout_at = source.index("heldout_losses = []")
        self.assertLess(
            save_at, heldout_at,
            "the trained head must be persisted before held-out evaluation "
            "so a gate/reporting failure cannot discard it",
        )


if __name__ == "__main__":
    unittest.main()
