import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modelscope_weights import EXPECTED_REPOSITORIES, MANIFEST_NAME, download_candidate_file


class PrivateCandidateWeights(unittest.TestCase):
    def setUp(self):
        self.route = "qwen35-9b"
        self.repo = EXPECTED_REPOSITORIES[self.route]
        self.payload = b"private-modelscope-weights" * 100000
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.downloaded_files = []
        self.config = {
            "route_id": self.route,
            "modelscope_repo_id": self.repo,
            "modelscope_weights_revision": "2026-11-03-r1",
            "repo_id": "HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive",
            "filename": "candidate.gguf",
            "mmproj_filename": "mmproj.gguf",
        }

    def _fake_hub_api_factory(self, manifest_sha=None, source_revision='a' * 40):
        test = self
        class FakeHubApi:
            def __init__(self, token=None):
                test.assertEqual(token, "secret")

            def download_file(self, repo, repo_type, file_path, local_dir, force=False):
                test.assertEqual(repo, test.repo)
                test.assertEqual(repo_type, "model")
                test.assertTrue(force)
                test.downloaded_files.append(file_path)
                root = Path(local_dir)
                root.mkdir(parents=True, exist_ok=True)
                if file_path == MANIFEST_NAME:
                    manifest = {
                        "candidate_id": test.route,
                        "source_repo_id": test.config["repo_id"],
                        "source_revision": source_revision,
                        "modelscope_repo_id": test.repo,
                        "modelscope_weights_revision": "2026-11-03-r1",
                        "filename": "candidate.gguf",
                        "mmproj_filename": "mmproj.gguf",
                        "files": {"candidate.gguf": {"size_bytes": len(test.payload), "sha256": manifest_sha or test.sha}},
                    }
                    target = root / MANIFEST_NAME
                    target.write_text(json.dumps(manifest), encoding="utf-8")
                elif file_path == "candidate.gguf":
                    target = root / file_path
                    target.write_bytes(test.payload)
                else:
                    raise AssertionError("Unexpected file download: " + file_path)
                return target
        return FakeHubApi

    def test_downloads_only_from_the_selected_candidates_private_repo_and_checks_sha(self):
        with tempfile.TemporaryDirectory() as folder:
            path = download_candidate_file(self.config, "candidate.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory())
            self.assertEqual(path, Path(folder) / "candidate.gguf")
            self.assertEqual(path.read_bytes(), self.payload)
            self.assertEqual(self.downloaded_files, [MANIFEST_NAME, "candidate.gguf"])

    def test_wrong_candidate_repository_is_refused_before_any_network_call(self):
        config = dict(self.config, modelscope_repo_id=EXPECTED_REPOSITORIES["gemma4-e4b"])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "cross-candidate"):
                download_candidate_file(config, "candidate.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory())

    def test_unassigned_projector_or_file_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "not assigned"):
                download_candidate_file(self.config, "another.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory())

    def test_missing_token_is_refused_before_any_download(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "DONOR_MODEL_READ_TOKEN"):
                download_candidate_file(self.config, "candidate.gguf", folder, token="", hub_api_factory=self._fake_hub_api_factory())

    def test_hash_mismatch_refuses_to_return_a_model_path(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                download_candidate_file(self.config, "candidate.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory("0" * 64))


    def test_candidate_scoped_studio_token_wins_over_stale_shared_tokens(self):
        env = {
            "DONOR_MODEL_READ_TOKEN": "secret",
            "MODELSCOPE_API_TOKEN": "stale-shared-token",
            "MODELSCOPE_TOKEN": "older-token",
        }
        with patch.dict(os.environ, env, clear=False), tempfile.TemporaryDirectory() as folder:
            path = download_candidate_file(
                self.config,
                "candidate.gguf",
                folder,
                hub_api_factory=self._fake_hub_api_factory(),
            )
            self.assertEqual(path.read_bytes(), self.payload)
        self.assertEqual(self.downloaded_files, [MANIFEST_NAME, "candidate.gguf"])

    def test_candidate_workflow_sets_dedicated_read_token_and_valid_shell_continuation(self):
        workflow = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "donor-bakeoff-modelscope.yml"
        source = workflow.read_text(encoding="utf-8")
        self.assertIn('for secret_name in ("MODELSCOPE_API_TOKEN", "DONOR_MODEL_READ_TOKEN"):', source)
        self.assertIn("api.add_secret(studio, secret_name, token)", source)
        self.assertIn("api.update_secret(studio, secret_name, token)", source)
        status_line = next(line for line in source.splitlines() if "studio_code=$(curl" in line)
        self.assertTrue(status_line.endswith("\\"))
        self.assertFalse(status_line.endswith("\\\\"))

    def test_runtime_downloads_exact_private_files_instead_of_enumerating_repository(self):
        source = Path(__file__).with_name("modelscope_weights.py").read_text(encoding="utf-8")
        self.assertIn("api.download_file(", source)
        self.assertIn('repo_type="model"', source)
        self.assertIn("force=True", source)
        self.assertNotIn("snapshot_download", source)

    def test_runtime_has_no_huggingface_client_or_external_weight_endpoint(self):
        app = (Path(__file__).with_name("app.py")).read_text(encoding="utf-8")
        requirements = (Path(__file__).with_name("requirements.txt")).read_text(encoding="utf-8")
        self.assertNotIn("hf_hub_download", app)
        self.assertNotIn("huggingface_hub", app)
        self.assertNotIn("huggingface.co", app)
        self.assertNotIn("hf-mirror.com", app)
        self.assertNotIn("huggingface_hub", requirements)
    def test_manifest_must_pin_a_valid_upstream_source_commit(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "manifest does not match"):
                download_candidate_file(self.config, "candidate.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory(source_revision="not-a-commit"))
    def test_runtime_config_cannot_change_to_an_unapproved_weights_revision(self):
        config = dict(self.config, modelscope_weights_revision="unreviewed")
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "revision"):
                download_candidate_file(config, "candidate.gguf", folder, token="secret", hub_api_factory=self._fake_hub_api_factory())


if __name__ == "__main__":
    unittest.main()
