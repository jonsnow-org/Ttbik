from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ComputerHubWorkflowTests(unittest.TestCase):
    def test_deploy_parser_reads_the_nested_browser_status_object(self):
        source = (ROOT / ".github" / "workflows" / "deploy-minicpmo-big.yml").read_text(encoding="utf-8")
        self.assertIn('browser=value.get("browser",value)', source)
        self.assertIn('browser.get("phase")=="ready"', source)

    def test_deploy_copies_and_compiles_the_private_bank_module(self):
        workflow = (ROOT / ".github" / "workflows" / "deploy-minicpmo-big.yml").read_text(encoding="utf-8")
        app = (ROOT / "ai-system" / "modelscope-media" / "computer_studio_app.py").read_text(encoding="utf-8")
        self.assertIn("ai-system/modelscope-media/computer_banks.py", workflow)
        self.assertIn("ms/computer_banks.py", workflow)
        self.assertIn("computer-hub-16gb-2026-11-22-r10-banks", app)
        self.assertIn("computer-hub-16gb-2026-11-22-r10-banks", workflow)

    def test_sham_v2_deploy_is_isolated_from_computer_changes_and_never_creates_studios(self):
        source = (ROOT / ".github" / "workflows" / "deploy-modelscope-sham-v2.yml").read_text(encoding="utf-8")
        self.assertNotIn("ai-system/modelscope-media/computer_box.py", source)
        self.assertNotIn(".github/workflows/deploy-modelscope-sham-v2.yml", source)
        self.assertIn("Require the existing owner-provisioned Studio (read-only)", source)
        self.assertNotIn("Create the Studio if missing", source)
        self.assertNotIn('curl -sS -o create.json', source)

    def test_real_browser_smoke_runs_after_a_successful_computer_deploy(self):
        source = (ROOT / ".github" / "workflows" / "computer-hub-terminal-browser-smoke.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_run:", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("workflow_run.head_sha || github.sha", source)
        self.assertNotIn("  push:", source)
        self.assertIn("Deploy the dedicated computer and full developer toolchain to the reserved 16 GB ModelScope Studio", source)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", source)
        self.assertIn("--browser", source)


if __name__ == "__main__":
    unittest.main()
