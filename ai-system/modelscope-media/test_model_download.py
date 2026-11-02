from __future__ import annotations

import importlib
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parent))


def fake_modelscope(snapshot_download):
    package = types.ModuleType("modelscope")
    package.__path__ = []
    package.snapshot_download = snapshot_download
    hub = types.ModuleType("modelscope.hub")
    hub.__path__ = []
    repository_module = types.ModuleType("modelscope.hub.repository")
    package.hub = hub
    hub.repository = repository_module

    class Repository:
        calls = []

        def __init__(self, model_dir, clone_from, git_token=None, endpoint=None):
            self.calls.append({
                "model_dir": model_dir,
                "clone_from": clone_from,
                "git_token": git_token,
                "endpoint": endpoint,
            })
            root = Path(model_dir)
            (root / ".git").mkdir(parents=True, exist_ok=True)
            (root / ".git" / "config").write_text("[remote \"origin\"]\nurl = https://oauth2:" + str(git_token or "user") + "@" + endpoint.split("://", 1)[-1] + "/" + clone_from + ".git\n")
            (root / "manifest.json").write_text("{}")

    repository_module.Repository = Repository
    return package, hub, repository_module, Repository


class ModelDownloadTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        self.module = importlib.import_module("model_download")

    def tearDown(self):
        sys.modules.pop("modelscope", None)
        sys.modules.pop("modelscope.hub", None)
        sys.modules.pop("modelscope.hub.repository", None)
        os.environ.pop("MODELSCOPE_ENDPOINT", None)

    def test_snapshot_uses_exact_repository_and_validates_required_files(self):
        calls = []

        def snapshot_download(model_id, cache_dir=None, endpoint=None, token=None, allow_patterns=None, local_dir=None):
            calls.append((model_id, endpoint, token))
            root = Path(cache_dir) / "snapshot"
            root.mkdir(parents=True, exist_ok=True)
            (root / "manifest.json").write_text("{}")
            return str(root)

        package, hub, repository_module, _ = fake_modelscope(snapshot_download)
        with patch.dict(sys.modules, {
            "modelscope": package,
            "modelscope.hub": hub,
            "modelscope.hub.repository": repository_module,
        }), tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"MODELSCOPE_ENDPOINT": ""}):
            result = self.module.download_model_repo(
                "owner/exact-photo-model",
                temp,
                token="private-token",
                required_files=("manifest.json",),
                allow_git_fallback=False,
            )
        self.assertTrue((result / "manifest.json").is_file())
        self.assertEqual(calls, [("owner/exact-photo-model", "https://modelscope.ai", "private-token")])

    def test_git_lfs_fallback_uses_same_exact_repo_and_model_scope_token(self):
        def broken_snapshot(*args, **kwargs):
            raise RuntimeError("Hub tree endpoint unavailable")

        package, hub, repository_module, repository = fake_modelscope(broken_snapshot)
        completed = types.SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.dict(sys.modules, {
            "modelscope": package,
            "modelscope.hub": hub,
            "modelscope.hub.repository": repository_module,
        }), patch.object(self.module.subprocess, "run", return_value=completed) as git_run, tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"MODELSCOPE_ENDPOINT": "https://modelscope.ai"}):
            result = self.module.download_model_repo(
                "owner/exact-photo-model",
                temp,
                token="private-token",
                required_files=("manifest.json",),
                timeout_seconds=17,
            )
        self.assertTrue((result / "manifest.json").is_file())
        self.assertEqual(repository.calls[0]["clone_from"], "models/owner/exact-photo-model")
        self.assertEqual(repository.calls[0]["git_token"], "private-token")
        self.assertEqual(repository.calls[0]["endpoint"], "https://modelscope.ai")
        commands = [call.args[0] for call in git_run.call_args_list]
        self.assertEqual(commands[0], ["git", "lfs", "pull"])
        self.assertEqual(commands[1], ["git", "remote", "set-url", "origin", "https://modelscope.ai/models/owner/exact-photo-model.git"])
        self.assertNotIn("private-token", " ".join(commands[1]))
        self.assertEqual(git_run.call_args_list[0].kwargs["timeout"], 17)

    def test_download_failure_redacts_private_token_and_never_changes_model_id(self):
        secret = "secret-token-should-not-leak"

        def broken_snapshot(*args, **kwargs):
            raise RuntimeError("unauthorized: " + secret)

        package, hub, repository_module, _ = fake_modelscope(broken_snapshot)

        class BrokenRepository:
            def __init__(self, **kwargs):
                raise RuntimeError("git auth failed: " + secret)

        repository_module.Repository = BrokenRepository
        with patch.dict(sys.modules, {
            "modelscope": package,
            "modelscope.hub": hub,
            "modelscope.hub.repository": repository_module,
        }), tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"MODELSCOPE_ENDPOINT": "https://modelscope.ai"}):
            with self.assertRaises(RuntimeError) as caught:
                self.module.download_model_repo(
                    "owner/the-only-model",
                    temp,
                    token=secret,
                    required_files=("manifest.json",),
                )
        message = str(caught.exception)
        self.assertNotIn(secret, message)
        self.assertIn("owner/the-only-model", message)
        self.assertIn("selected repository", message)

    def test_rejects_path_traversal_in_repo_identifier(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                self.module.download_model_repo("../other/repo", temp)


if __name__ == "__main__":
    unittest.main()
