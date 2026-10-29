"""Regression tests for the dedicated Sham v2 Qwen3 chat route; no model weights or torch runtime required."""
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


class Qwen3RouteTests(unittest.TestCase):
    def test_v2_system_prompt_forces_qwen_template_when_checkpoint_metadata_is_missing(self):
        with patch.dict(os.environ, {"SHAM_QWEN3_SYSTEM": "A direct test system prompt"}, clear=False):
            module = load_module()
            model = types.SimpleNamespace(cfg=types.SimpleNamespace(chat_format=""))
            tokenizer = object()
            with patch.object(module, "qwen3_chat", return_value="direct answer") as qwen3:
                result = module.studio_generate(model, tokenizer, "What is the capital of Syria?", 24, search_fn=None)
            self.assertEqual(result, "direct answer")
            qwen3.assert_called_once_with(model, tokenizer, "What is the capital of Syria?", 24, temperature=0.0, think_tokens=0)
            self.assertEqual(module._qwen3_system_prompt(), "A direct test system prompt")

    def test_long_history_does_not_truncate_away_v2_system_identity(self):
        with patch.dict(os.environ, {"SHAM_QWEN3_SYSTEM": "IDENTITY: Sham v2; Nova is separate"}, clear=False):
            module = load_module()

        class CharacterTokenizer:
            def encode(self, text):
                return [ord(ch) for ch in text]

        prompt = "OLD_HISTORY_SENTINEL " + ("older turn " * 70) + "CURRENT_QUESTION_SENTINEL"
        ids = module._qwen3_prompt_ids(
            CharacterTokenizer(), prompt, think=False, max_context_tokens=220
        )
        rendered = "".join(chr(token) for token in ids)
        self.assertIn("IDENTITY: Sham v2; Nova is separate", rendered)
        self.assertIn("CURRENT_QUESTION_SENTINEL", rendered)
        self.assertNotIn("OLD_HISTORY_SENTINEL", rendered)

    def test_v1_keeps_its_own_template_unless_qwen3_metadata_or_v2_prompt_is_present(self):
        with patch.dict(os.environ, {"SHAM_QWEN3_SYSTEM": ""}, clear=False):
            module = load_module()
            old_model = types.SimpleNamespace(cfg=types.SimpleNamespace(chat_format=""))
            donor_model = types.SimpleNamespace(cfg=types.SimpleNamespace(chat_format="qwen3"))
            self.assertFalse(module._uses_qwen3_chat(old_model))
            self.assertTrue(module._uses_qwen3_chat(donor_model))


if __name__ == "__main__":
    unittest.main()
