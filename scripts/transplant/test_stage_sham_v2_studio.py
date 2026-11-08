import tempfile
import unittest
from pathlib import Path

from stage_sham_v2_studio import patch_staged_sham_v2_download, stage_sham_v2, write_sham_v2_wrapper


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


if __name__ == "__main__":
    unittest.main()
