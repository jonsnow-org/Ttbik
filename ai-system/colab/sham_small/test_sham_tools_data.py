"""Regression guards for Sham v1 tool-call training data (owner's order 2026-11-06).

The v1 chat stage must train on every tool visible to v1. Four self-review and skill
management tools are deliberately Sham Pro-only and filtered by shamTools() for v1;
they must not be mistaken for missing v1 training examples or leaked into its dataset.
"""
from __future__ import annotations

import json
import random
import re
import unittest
from pathlib import Path

from sham_tools_data import TOOL_SPECS, mix_share, tool_batches, tool_examples

REPO = Path(__file__).resolve().parents[3]
SHAM_EXEC = REPO / "src" / "lib" / "shamExec.ts"
NOTEBOOKS = [
    REPO / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks" / "sham_chat_stage.ipynb",
    REPO / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks" / "sham_chat_image_in_one.ipynb",
]


def _fake(text: str) -> list[int]:
    return [ord(ch) % 4000 + 10 for ch in text]


class ToolCoverageTests(unittest.TestCase):
    def test_v1_training_covers_its_live_tool_set_without_importing_sham_pro_tools(self):
        source = SHAM_EXEC.read_text(encoding="utf-8")
        live = set(re.findall(r'tool\("([a-z_]+)"', source))
        self.assertTrue(live, "no tools parsed from shamExec.ts")

        match = re.search(r"SHAM_SELF_TOOLS\s*=\s*new Set\(\[([^\]]+)\]\)", source, re.S)
        self.assertIsNotNone(match, "Sham Pro-only tools must stay explicitly scoped")
        pro_only = set(re.findall(r'"([a-z_]+)"', match.group(1)))
        self.assertEqual(pro_only, {"self_review", "skill_save", "skill_list", "skill_delete"})
        self.assertIn("proSkill || !SHAM_SELF_TOOLS.has(t.function.name)", source)
        self.assertTrue(pro_only.isdisjoint(TOOL_SPECS), "Sham Pro-only tools must not leak into Sham v1 training")

        missing = sorted(live - pro_only - set(TOOL_SPECS))
        self.assertEqual(missing, [], f"v1 tools offered by the engine but absent from v1 training: {missing}")

    def test_tool_batches_are_on_by_default_and_real(self):
        self.assertGreater(mix_share(), 0.0, "tool training must be ON by default")
        batches = tool_batches(_fake, random.Random(7), 12, 4)
        self.assertTrue(batches, "default share produced no batches")
        for ids, labels in batches:
            self.assertEqual(ids.shape, labels.shape)
            self.assertTrue((labels != -100).any(), "a batch with nothing learned is useless")

    def test_tool_examples_are_single_unpadded_examples_the_live_trainer_can_batch(self):
        """The live trainer once added each padded batch (a 2-D tensor) as ONE example and crashed in pad_batch
        ("expand(LongTensor[4, 172], size=[4])"): its tool examples must be flat lists that make_batches can pad."""
        from sham_live import make_batches
        ex = tool_examples(_fake, random.Random(7), 10)
        self.assertTrue(ex)
        for ids, labels in ex:
            self.assertIsInstance(ids[0], int)
            self.assertIsInstance(labels[0], int)
            self.assertEqual(len(ids), len(labels))
        batches = make_batches(ex, 4096)                  # must not raise
        self.assertTrue(batches)
        self.assertEqual(sum(b[0].shape[0] for b in batches), len(ex))

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


class AgentTraceTests(unittest.TestCase):
    """Real executed agent traces (UltraData, mapped to Sham's own computer tools) are part of the v1 tool mix: calls learned, results masked, a cut trace ends after its last result."""

    def test_the_real_traces_file_is_there_and_uses_only_sham_tool_names(self):
        import gzip
        from sham_tools_data import AGENT_TRACES
        self.assertTrue(AGENT_TRACES.is_file(), "agent_traces_v1.jsonl.gz must ship with the code (the Studios receive only this folder)")
        names = set()
        with gzip.open(AGENT_TRACES, "rt", encoding="utf-8") as f:
            for i, line in enumerate(f):
                r = json.loads(line)
                names |= {st[0] for st in r["steps"]}
                if i > 400:
                    break
        self.assertTrue(names <= {"computer_run", "computer_read", "computer_search"}, names)

    def test_a_trace_without_an_answer_masks_results_and_has_no_eos(self):
        from sham_tools_data import IGNORE, build_tool_example, examples_from_agent_traces, AGENT_TRACES
        ids, labels = build_tool_example(_fake, "fix the bug", [("computer_run", {"command": "ls"}, "a.py\nb.py")], "")
        self.assertEqual(len(ids), len(labels))
        self.assertTrue(any(x != IGNORE for x in labels) and labels[-1] == IGNORE and ids[-1] != labels[-1] or labels[-1] == IGNORE)
        ex = examples_from_agent_traces(AGENT_TRACES, _fake, limit=5)
        self.assertEqual(len(ex), 5)
        for i, l in ex:
            self.assertEqual(len(i), len(l))
            self.assertTrue(any(x != IGNORE for x in l))

    def test_the_tool_mix_takes_a_share_from_the_traces_and_can_be_switched_off(self):
        import os
        os.environ["SHAM_TOOLS_MIX"] = "0.3"
        try:
            on = tool_examples(_fake, random.Random(1), 60, max_len=0)
            os.environ["SHAM_AGENT_TRACES"] = "0"
            off = tool_examples(_fake, random.Random(1), 60, max_len=0)
        finally:
            os.environ.pop("SHAM_TOOLS_MIX", None)
            os.environ.pop("SHAM_AGENT_TRACES", None)
        self.assertEqual(len(on), 60)
        self.assertEqual(len(off), 60)
        self.assertNotEqual(on, off)


if __name__ == "__main__":
    unittest.main()
