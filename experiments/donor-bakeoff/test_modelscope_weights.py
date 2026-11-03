import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from modelscope_weights import EXPECTED_REPOSITORIES, MANIFEST_NAME, download_candidate_file


class PrivateCandidateWeights(unittest.TestCase):
    def setUp(self):
        self.route = "qwen35-9b"
        self.repo = EXPECTED_REPOSITORIES[self.route]
        self.payload = b"private-modelscope-weights" * 100000
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.config = {
            "route_id": self.route,
            "modelscope_repo_id": self.repo,
            "modelscope_weights_revision": "2026-11-03-r1",
            "repo_id": "HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive",
            "filename": "candidate.gguf",
            "mmproj_filename": "mmproj.gguf",
        }

    def _fake_snapshot(self, manifest_sha=None, source_revision='a' * 40):
        def snapshot(repo, local_dir, allow_patterns, token=None):
            self.assertEqual(repo, self.repo)
            self.assertEqual(token, "secret")
            self.assertEqual(set(allow_patterns), {MANIFEST_NAME, "candidate.gguf"})
            root = Path(local_dir)
            (root / "candidate.gguf").write_bytes(self.payload)
            manifest = {
                "candidate_id": self.route,
                "source_repo_id": self.config["repo_id"],
                "source_revision": source_revision,
                "modelscope_repo_id": self.repo,
                "modelscope_weights_revision": "2026-11-03-r1",
                "filename": "candidate.gguf",
                "mmproj_filename": "mmproj.gguf",
                "files": {"candidate.gguf": {"size_bytes": len(self.payload), "sha256": manifest_sha or self.sha}},
            }
            (root / MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
        return snapshot

    def test_downloads_only_from_the_selected_candidates_private_repo_and_checks_sha(self):
        with tempfile.TemporaryDirectory() as folder:
            path = download_candidate_file(self.config, "candidate.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot())
            self.assertEqual(path, Path(folder) / "candidate.gguf")
            self.assertEqual(path.read_bytes(), self.payload)

    def test_wrong_candidate_repository_is_refused_before_any_network_call(self):
        config = dict(self.config, modelscope_repo_id=EXPECTED_REPOSITORIES["gemma4-e4b"])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "cross-candidate"):
                download_candidate_file(config, "candidate.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot())

    def test_unassigned_projector_or_file_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "not assigned"):
                download_candidate_file(self.config, "another.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot(), login_impl=lambda _: None)

    def test_missing_token_is_refused_before_modelscope_login(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "MODELSCOPE_API_TOKEN"):
                download_candidate_file(self.config, "candidate.gguf", folder, token="", snapshot_download_impl=self._fake_snapshot(), login_impl=lambda _: self.fail("login must not be called"))

    def test_hash_mismatch_refuses_to_return_a_model_path(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                download_candidate_file(self.config, "candidate.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot("0" * 64), login_impl=lambda _: None)

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
                download_candidate_file(self.config, "candidate.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot(source_revision="not-a-commit"), login_impl=lambda _: None)
    def test_runtime_config_cannot_change_to_an_unapproved_weights_revision(self):
        config = dict(self.config, modelscope_weights_revision="unreviewed")
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, "revision"):
                download_candidate_file(config, "candidate.gguf", folder, token="secret", snapshot_download_impl=self._fake_snapshot(), login_impl=lambda _: None)


if __name__ == "__main__":
    unittest.main()
