"""Pure-Python tests for Sham's constrained tool-call envelope and repair path."""
from __future__ import annotations

import json
import unittest

from sham_toolcall import CLOSE_TAG, OPEN_TAG, repair_call, tool_names_from_prompt


class ToolCallEnvelopeTests(unittest.TestCase):
    def test_tools_are_read_from_the_available_tools_prompt(self):
        prompt = "Tools:\n- github_read_file(repo, path) — reads\n- github_create_issue(repo, title) — creates\n- github_read_file(repo, path) — duplicate"
        self.assertEqual(tool_names_from_prompt(prompt), ["github_read_file", "github_create_issue"])
        self.assertEqual(tool_names_from_prompt("No tools here"), [])

    def test_truncated_json_is_repaired_only_when_unambiguous(self):
        broken = '<tool_call>{"name": "github_read_file", "arguments": {"repo": "a/b", "path": "README.md"'
        fixed = repair_call(broken)
        self.assertTrue(fixed.endswith(CLOSE_TAG))
        payload = json.loads(fixed.split(OPEN_TAG, 1)[1].split(CLOSE_TAG, 1)[0])
        self.assertEqual(payload["name"], "github_read_file")
        self.assertEqual(payload["arguments"]["path"], "README.md")

    def test_trailing_comma_is_repaired(self):
        self.assertEqual(
            repair_call('<tool_call>{"name": "x", "arguments": {"n": 1,}}</tool_call>'),
            '<tool_call>{"name": "x", "arguments": {"n": 1}}</tool_call>',
        )

    def test_unrelated_text_and_ambiguous_json_are_preserved(self):
        self.assertEqual(repair_call("normal answer"), "normal answer")
        broken = '<tool_call>{"name": "x" "arguments"}</tool_call>'
        self.assertEqual(repair_call(broken), broken)


if __name__ == "__main__":
    unittest.main()
