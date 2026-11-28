import tempfile
import unittest
from pathlib import Path

from stage_sham_v2_studio import patch_staged_sham_v2_download, render_wrapper, stage_sham_v2, stage_tldm_serving, write_sham_v2_wrapper


class StagedShamV2Runtime(unittest.TestCase):
    def test_only_staged_v2_loader_uses_explicit_current_hub_token(self):
        with tempfile.TemporaryDirectory() as folder:
            studio = Path(folder)
            source = '''def _download():
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    cands = [("MODELSCOPE_TOKEN", "token")]
    for name, tok in cands:
        try:
            if tok:
                HubApi().login(tok)
            path = Path(snapshot_download(MODEL_ID, cache_dir=str(cache)))
        except Exception:
            pass
'''
            (studio / "sham_app.py").write_text(source, encoding="utf-8")
            (studio / "requirements.txt").write_text("gradio==6.17.3\nmodelscope\n", encoding="utf-8")
            patch_staged_sham_v2_download(studio)
            patched = (studio / "sham_app.py").read_text(encoding="utf-8")
            requirements = (studio / "requirements.txt").read_text(encoding="utf-8")
            self.assertIn("from modelscope_hub.compat import snapshot_download", patched)
            self.assertIn("from modelscope_hub import HubApi", patched)
            self.assertIn("HubApi(token=tok).whoami()", patched)
            self.assertIn("snapshot_download(MODEL_ID, cache_dir=str(cache), token=tok or None)", patched)
            self.assertNotIn("from modelscope import snapshot_download", patched)
            self.assertIn("modelscope-hub==0.6.1", requirements)

    def test_wrapper_remains_strictly_configured_for_sham_v2(self):
        with tempfile.TemporaryDirectory() as folder:
            studio = Path(folder)
            write_sham_v2_wrapper(studio)
            wrapper = (studio / "app.py").read_text(encoding="utf-8")
            self.assertIn('os.environ["SHAM_MS_MODEL"] = "novaai2026/sham-v2"', wrapper)
            self.assertIn('os.environ.setdefault("SHAM_NATIVE_TOOL_CALLS", "1")', wrapper)
            self.assertNotIn("novaai2026/sham-v1", wrapper)
            self.assertIn('os.environ.setdefault("SHAM_TLDM", "0")', wrapper)
            self.assertNotIn('os.environ["SHAM_TLDM"] = "1"', wrapper)
            self.assertIn("novaai2026/sham2-tldm-head", wrapper)

    def test_the_computer_and_browser_are_in_the_models_own_code_not_behind_an_api(self):
        # owner 2026-11-08: Sham's computer lives in the model's code (its generation loop), not on a Studio and not behind a command API
        with tempfile.TemporaryDirectory() as folder:
            studio = Path(folder)
            stage_sham_v2(studio)
            self.assertTrue((studio / "sham_small" / "sham_embedded_tools.py").is_file())
            self.assertTrue((studio / "sham_small" / "sham_computer.py").is_file())
            self.assertTrue((studio / "browser_computer.py").is_file())
            self.assertFalse((studio / "computer_box.py").exists())
            app = (studio / "sham_app.py").read_text(encoding="utf-8")
            self.assertIn("sham_embedded_tools", app)
            self.assertNotIn('api_name="box_do"', app)
            self.assertNotIn('api_name="browser_do"', app)
            self.assertIn('api_name="computer_changes"', app)          # read-only, for publishing after the user confirms

    def test_tldm_serving_files_are_staged_but_left_off(self):
        with tempfile.TemporaryDirectory() as folder:
            studio = Path(folder)
            stage_sham_v2(studio)
            self.assertTrue((studio / "sham_tldm_serve.py").is_file())
            self.assertTrue((studio / "sham_tldm_experience.py").is_file())
            self.assertTrue((studio / "tldm" / "evolution" / "api.py").is_file())
            self.assertTrue((studio / "tldm" / "evolution" / "owner_denylist.txt").is_file())
            self.assertTrue((studio / "tldm" / "serve_adapter.py").is_file())
            self.assertTrue((studio / "tldm" / "sham_tldm" / "model.py").is_file())
            self.assertTrue((studio / "terminal" / "sham_binding.py").is_file())
            self.assertTrue((studio / "terminal" / "approvals.py").is_file())
            for rel in ("sham_pro_coordinator.py", "terminal/tasks.py", "terminal/media_workers.py", "terminal/sham_pro_agent.py"):
                self.assertTrue((studio / rel).is_file(), rel)
            self.assertFalse((studio / "tldm" / "training").exists())
            wrapper = (studio / "app.py").read_text(encoding="utf-8")
            self.assertIn('os.environ.setdefault("SHAM_TLDM", "0")', wrapper)


class StagedOnTheInternationalSite(unittest.TestCase):
    def test_ai_wrapper_reads_the_mirrored_repos_and_the_international_hub_and_cn_is_unchanged(self):
        ai, cn = render_wrapper("ai"), render_wrapper("cn")
        self.assertIn('os.environ["SHAM_MS_MODEL"] = "Jonjithup/sham-v2"', ai)
        self.assertIn('"SHAM_TLDM_REPO", "Jonjithup/sham2-tldm-head"', ai)
        self.assertIn('os.environ.setdefault("MODELSCOPE_DOMAIN", "www.modelscope.ai")', ai)
        self.assertIn('os.environ.setdefault("MODELSCOPE_ENDPOINT", "https://www.modelscope.ai")', ai)
        self.assertNotIn("novaai2026", ai)                                       # nothing of the cn account leaks into the served copy
        self.assertIn('os.environ["SHAM_MS_MODEL"] = "novaai2026/sham-v2"', cn)
        self.assertNotIn("MODELSCOPE_DOMAIN", cn)                                 # the default is exactly what it always was
        self.assertNotIn("@OWNER@", ai + cn)
        self.assertNotIn("@DOMAIN@", ai + cn)
        compile(ai, "wrapper_ai", "exec")
        compile(cn, "wrapper_cn", "exec")                                         # both are valid Python
        with self.assertRaises(ValueError):
            render_wrapper("mars")

    def test_the_domain_is_set_before_anything_imports_the_hub(self):
        ai = render_wrapper("ai")
        self.assertLess(ai.index("MODELSCOPE_DOMAIN"), ai.index("import sham_mesh_node"))
        self.assertLess(ai.index("MODELSCOPE_DOMAIN"), ai.index("runpy.run_path"))


class StagedTldmImports(unittest.TestCase):
    def test_staged_tldm_tree_imports_like_the_studio(self):
        """generate_tldm on the live Studio failed with ModuleNotFoundError terminal_tasks (2026-11-18): the staged tree must import alone."""
        import importlib.util
        import subprocess
        import sys
        if importlib.util.find_spec("torch") is None:
            self.skipTest("torch is not installed")
        with tempfile.TemporaryDirectory() as folder:
            studio = Path(folder)
            stage_tldm_serving(studio)
            for rel in ("sham_tldm_serve.py", "tldm/serve_adapter.py", "tldm/data/trajectories.py", "tldm/data/augment.py",
                        "tldm/data/terminal_tasks.py", "tldm/tools/organize.py", "terminal/sandbox_terminal.py", "distill/exec_verify.py", "tldm/sham_tldm/donor.py"):
                self.assertTrue((studio / rel).is_file(), rel)
            code = ("import sys; sys.path[:0] = [r'{0}', r'{0}/tldm', r'{0}/tldm/data', r'{0}/tldm/memory', r'{0}/terminal'];"
                    "import serve_adapter, augment, terminal_tasks, approvals, backends; from sham_tldm.donor import FeatureTLDM; import sham_tldm_serve as S;"
                    "assert S.HEAD_FILE == 'sham2_heads.pt'; print('ok')").format(studio)
            r = subprocess.run([sys.executable, "-c", code], cwd=folder, capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"}, timeout=120)
            self.assertEqual(r.returncode, 0, r.stderr[-1500:])
            self.assertIn("ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
