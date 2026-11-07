"""Regression guards for Sham's tool-call training data (owner's order 2026-11-06).

The live engine (src/lib/shamExec.ts) offers every tool; the chat stage must train on
the SAME tool set, or the trained model answers requests for a tool it never saw. That
exact gap — tool data wired into v2 only, never into v1's chat stage — is what these
tests keep closed.
"""
from __future__ import annotations

import json
import random
import re
import unittest
from pathlib import Path

from sham_tools_data import TOOL_SPECS, mix_share, tool_batches

REPO = Path(__file__).resolve().parents[3]
SHAM_EXEC = REPO / "src" / "lib" / "shamExec.ts"
NOTEBOOKS = [
    REPO / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks" / "sham_chat_stage.ipynb",
    REPO / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks" / "sham_chat_image_in_one.ipynb",
]


def _fake(text: str) -> list[int]:
    return [ord(ch) % 4000 + 10 for ch in text]


class ToolCoverageTests(unittest.TestCase):
    def test_training_covers_every_tool_the_live_engine_offers(self):
        live = set(re.findall(r'tool\("([a-z_]+)"', SHAM_EXEC.read_text(encoding="utf-8")))
        self.assertTrue(live, "no tools parsed from shamExec.ts")
        missing = sorted(live - set(TOOL_SPECS))
        self.assertEqual(missing, [], f"tools the engine offers but training never teaches: {missing}")

    def test_tool_batches_are_on_by_default_and_real(self):
        self.assertGreater(mix_share(), 0.0, "tool training must be ON by default")
        batches = tool_batches(_fake, random.Random(7), 12, 4)
        self.assertTrue(batches, "default share produced no batches")
        for ids, labels in batches:
            self.assertEqual(ids.shape, labels.shape)
            self.assertTrue((labels != -100).any(), "a batch with nothing learned is useless")

    def test_zero_share_turns_tool_training_off(self):
        import os
        os.environ["SHAM_TOOLS_MIX"] = "0"
        try:
            self.assertEqual(tool_batches(_fake, random.Random(7), 12, 4), [])
        finally:
            os.environ.pop("SHAM_TOOLS_MIX", None)

    def test_both_chat_stage_notebooks_train_on_tools(self):
        for path in NOTEBOOKS:
            src = "\n".join("".join(c["source"]) for c in json.loads(path.read_text(encoding="utf-8"))["cells"])
            self.assertIn("tool_batches", src, f"{path.name} never trains on tool calls")
            self.assertIn("_tools", src, f"{path.name} builds tool batches but does not interleave them")


if __name__ == "__main__":
    unittest.main()
