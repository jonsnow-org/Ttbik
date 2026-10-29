"""Regression tests for Sham v2's native Qwen3 role-message chat path."""
from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("sham_studio_chat.py")


def load_module():
    name = "_sham_studio_chat_route_test"
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load sham_studio_chat.py")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"torch": types.ModuleType("torch")}):
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        finally:
            sys.modules.pop(name, None)
    return module


class CharacterTokenizer:
    def encode(self, text):
        return [ord(ch) for ch in text]


class Qwen3RouteTests(unittest.TestCase):
    def test_qwen3_route_depends_on_checkpoint_format_not_environment_prompt(self):
        with patch.dict(os.environ, {"SHAM_QWEN3_SYSTEM": "ignored identity injection"}, clear=False):
            module = load_module()
        legacy = types.SimpleNamespace(cfg=types.SimpleNamespace(chat_format=""))
        donor = types.SimpleNamespace(cfg=types.SimpleNamespace(chat_format="qwen3"))
        self.assertFalse(module._uses_qwen3_chat(legacy))
        self.assertTrue(module._uses_qwen3_chat(donor))

    def test_single_user_turn_has_no_hidden_system_message(self):
        module = load_module()
        ids = module._qwen3_messages_prompt_ids(
            CharacterTokenizer(), [{"role": "user", "content": "RAW_CURRENT_QUESTION"}], 500
        )
        rendered = "".join(chr(token) for token in ids)
        self.assertIn("<|im_start|>user\nRAW_CURRENT_QUESTION<|im_end|>", rendered)
        self.assertIn("<|im_start|>assistant\n", rendered)
        self.assertNotIn("<|im_start|>system", rendered)
        self.assertNotIn("ignored identity injection", rendered)

    def test_history_is_separate_roles_and_oldest_complete_turn_is_removed(self):
        module = load_module()
        messages = [
            {"role": "user", "content": "OLD_HISTORY_SENTINEL " + ("older " * 40)},
            {"role": "assistant", "content": "old answer"},
            {"role": "user", "content": "CURRENT_QUESTION_SENTINEL"},
        ]
        ids = module._qwen3_messages_prompt_ids(CharacterTokenizer(), messages, 180)
        rendered = "".join(chr(token) for token in ids)
        self.assertIn("CURRENT_QUESTION_SENTINEL", rendered)
        self.assertIn("<|im_start|>assistant\n", rendered)
        self.assertNotIn("OLD_HISTORY_SENTINEL", rendered)

    def test_oversized_current_question_keeps_its_beginning(self):
        module = load_module()
        long_question = "CURRENT_START " + ("important " * 80) + " CURRENT_END"
        ids = module._qwen3_messages_prompt_ids(
            CharacterTokenizer(), [{"role": "user", "content": long_question}], 80
        )
        rendered = "".join(chr(token) for token in ids)
        self.assertIn("CURRENT_START", rendered)
        self.assertNotIn("CURRENT_END", rendered)

    def test_invalid_roles_are_rejected(self):
        module = load_module()
        with self.assertRaises(ValueError):
            module._qwen3_messages_prompt_ids(
                CharacterTokenizer(), [{"role": "system", "content": "not accepted"}], 100
            )


if __name__ == "__main__":
    unittest.main()
