"""Offline checks for Sham v2's native-role chat route (no identity answer interception)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SMOKE = Path(__file__).with_name("sham_v2_chat_smoke.py")


class ShamV2ChatRouteTests(unittest.TestCase):
    def test_live_smoke_does_not_reject_or_rewrite_identity_answers(self):
        source = SMOKE.read_text(encoding="utf-8")
        self.assertNotIn("check_identity_answer", source)
        self.assertNotIn("identified itself as Nova", source)
        self.assertNotIn("did not identify itself as Sham", source)
        self.assertNotIn("echoed the identity question", source)

    def test_studio_uses_native_role_messages_without_identity_system_prompt(self):
        runtime = (ROOT / "ai-system" / "colab" / "sham_small" / "sham_studio_chat.py").read_text(encoding="utf-8")
        app = (ROOT / "ai-system" / "modelscope-sham" / "app.py").read_text(encoding="utf-8")
        self.assertIn("def qwen3_chat_messages(", runtime)
        self.assertNotIn("QWEN3_SYSTEM", runtime)
        self.assertIn("def generate_chat(", app)
        self.assertIn('api_name="generate_chat"', app)

    def test_live_smoke_waits_for_the_new_context_before_calling_it_ready(self):
        source = SMOKE.read_text(encoding="utf-8")
        self.assertIn('context >= 4096', source)
        self.assertIn("before the 300s deadline", source)


if __name__ == "__main__":
    unittest.main()
