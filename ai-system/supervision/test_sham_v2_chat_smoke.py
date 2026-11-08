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

    def test_deploy_enables_native_tool_calls_in_the_private_sham_v2_studio(self):
        workflow = (ROOT / ".github" / "workflows" / "deploy-modelscope-sham-v2.yml").read_text(encoding="utf-8")
        self.assertIn('set_secret SHAM_NATIVE_TOOL_CALLS "1"', workflow)

    def test_deploy_waits_for_the_new_app_context_not_the_previous_container(self):
        # A redeploy keeps the PREVIOUS container answering until the new one is up. The
        # pre-2026-10-30 app reports "ready" WITHOUT context_tokens; accepting that made the
        # deploy pass its own gate and then fail the chat smoke on a context window of 0.
        for name in ("deploy-modelscope-sham-v2.yml", "deploy-modelscope-sham-v2-overflow.yml"):
            workflow = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            self.assertIn("context_tokens", workflow, name)
            self.assertIn('"$ctx" -ge 4096', workflow, name)
            # The steps run under `bash -e`, so a failing grep in the assignment must be
            # tolerated (`|| true`) or the deploy aborts with no message.
            self.assertIn("head -1 || true)", workflow, name)

    def test_computer_calls_use_sham_v2s_own_embedded_computer_not_the_shared_hub(self):
        source = SMOKE.read_text(encoding="utf-8")
        self.assertIn("COMPUTER_BASE = BASE", source)
        self.assertIn('"sham-v2-server" not in COMPUTER_BASE.lower()', source)
        self.assertNotIn("COMPUTER_STUDIO_URL", source)
        self.assertNotIn("sham-v2-video-server", source)

    def test_live_smoke_requires_the_model_to_choose_and_execute_its_own_terminal_tool(self):
        source = SMOKE.read_text(encoding="utf-8")
        self.assertIn('call("agent_step"', source)
        self.assertIn('"- computer_run(command, cwd?, timeout?)', source)
        self.assertIn('call_computer_box({', source)
        self.assertIn("Sham v2 itself selected computer_run", source)
        self.assertIn("generated_command", source)


if __name__ == "__main__":
    unittest.main()
