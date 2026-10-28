"""Pure-Python tests for Sham's constrained tool-call envelope and repair path."""
from __future__ import annotations

import json
import unittest

from sham_toolcall import CLOSE_TAG, OPEN_TAG, ToolCallGuard, repair_call, tool_names_from_prompt


class _CharTokenizer:
    """Deterministic tokenizer double: tool-call tags each occupy one token."""
    def encode(self, text: str):
        if text == OPEN_TAG:
            return [1]
        if text == CLOSE_TAG:
            return [2]
        return [ord(ch) + 10 for ch in text]


class ToolCallEnvelopeTests(unittest.TestCase):
    def test_guard_constrains_tool_name_but_leaves_arguments_free(self):
        prompt = "Tools:\\n- github_read_file(repo, path) — reads\\n- github_create_issue(repo, title) — creates"
        names = tool_names_from_prompt(prompt)
        tok = _CharTokenizer()
        guard = ToolCallGuard(tok, names)
        self.assertTrue(guard.usable)

        # Before the frame starts, only the opening brace is legal.
        self.assertEqual(guard([tok.encode(OPEN_TAG)[0]]), {ord("{") + 10})

        # At the fork in two loaded tool names, only their real next characters are legal.
        prefix = tok.encode(OPEN_TAG) + tok.encode('{"name": "github_')
        allowed = guard(prefix)
        self.assertEqual(allowed, {ord("r") + 10, ord("c") + 10})
        self.assertNotIn(ord("x") + 10, allowed)

        # Once the exact function-name/arguments prefix is complete, argument tokens are unconstrained.
        full_prefix = tok.encode(OPEN_TAG) + tok.encode('{"name": "github_read_file", "arguments":')
        self.assertIsNone(guard(full_prefix))

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
