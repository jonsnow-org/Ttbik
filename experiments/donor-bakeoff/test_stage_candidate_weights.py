import json
import tempfile
import unittest
from pathlib import Path

import stage_candidate_weights as stage


class CandidateMirrorAssignment(unittest.TestCase):
    def test_each_candidate_has_a_distinct_private_destination(self):
        self.assertEqual(len(set(stage.EXPECTED_REPOSITORIES.values())), 3)
        self.assertEqual(stage.EXPECTED_REPOSITORIES["qwen35-9b"], "novaai2026/sham-donor-qwen35-9b-weights")
        self.assertEqual(stage.EXPECTED_REPOSITORIES["gemma4-e4b"], "novaai2026/sham-donor-gemma4-e4b-weights")
        self.assertEqual(stage.EXPECTED_REPOSITORIES["minicpmo45"], "novaai2026/sham-donor-minicpmo45-weights")

    def test_manifest_revision_and_candidate_source_are_fixed(self):
        with tempfile.TemporaryDirectory() as d:
            config = {
                "route_id": "qwen35-9b",
                "repo_id": "HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive",
                "modelscope_repo_id": stage.EXPECTED_REPOSITORIES["qwen35-9b"],
                "modelscope_weights_revision": stage.REVISION,
                "filename": "model.gguf",
                "mmproj_filename": "mmproj.gguf",
            }
            path = Path(d) / "candidate.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            self.assertEqual(stage.validate_assignment(json.loads(path.read_text(encoding="utf-8"))), stage.EXPECTED_REPOSITORIES["qwen35-9b"])

    def test_private_repo_creation_uses_repo_type_and_private_visibility(self):
        class Info:
            visibility = "private"

        class FakeApi:
            def __init__(self):
                self.created = []
            def repo_exists(self, repo_id, repo_type):
                self.created.append(("exists", repo_id, repo_type))
                return False
            def create_repo(self, repo_id, *, repo_type, visibility, license, description):
                self.created.append(("create", repo_id, repo_type, visibility, license))
                return Info()

        api = FakeApi()
        created = stage.ensure_private_model_repo(api, stage.EXPECTED_REPOSITORIES["qwen35-9b"])
        self.assertTrue(created)
        self.assertEqual(api.created[0], ("exists", "novaai2026/sham-donor-qwen35-9b-weights", "model"))
        self.assertEqual(api.created[1][2:], ("model", "private", "apache-2.0"))

    def test_existing_public_candidate_repo_is_never_used_for_private_weights(self):
        class Info:
            visibility = "public"

        class FakeApi:
            def repo_exists(self, repo_id, repo_type):
                return True
            def get_repo(self, repo_id, repo_type):
                return Info()
            def create_repo(self, *args, **kwargs):
                raise AssertionError("must not alter or upload to an existing public repository")

        with self.assertRaisesRegex(RuntimeError, "not confirmed private"):
            stage.ensure_private_model_repo(FakeApi(), stage.EXPECTED_REPOSITORIES["gemma4-e4b"])

    def test_existing_private_candidate_repo_is_reused_without_recreation(self):
        class Info:
            visibility = "private"

        class FakeApi:
            def repo_exists(self, repo_id, repo_type):
                return True
            def get_repo(self, repo_id, repo_type):
                return Info()
            def create_repo(self, *args, **kwargs):
                raise AssertionError("existing private repo should not be recreated")

        self.assertFalse(stage.ensure_private_model_repo(FakeApi(), stage.EXPECTED_REPOSITORIES["minicpmo45"]))

    def test_private_import_skip_requires_a_valid_source_commit_sha(self):
        self.assertTrue(stage.valid_commit_sha("a" * 40))
        self.assertFalse(stage.valid_commit_sha("not-a-commit"))
        self.assertFalse(stage.valid_commit_sha("a" * 39))
    def test_cross_candidate_destination_is_rejected(self):
        config = {
            "route_id": "qwen35-9b",
            "repo_id": "source/repo",
            "modelscope_repo_id": stage.EXPECTED_REPOSITORIES["minicpmo45"],
            "modelscope_weights_revision": stage.REVISION,
            "filename": "model.gguf",
            "mmproj_filename": "mmproj.gguf",
        }
        with self.assertRaises(RuntimeError):
            stage.validate_assignment(config)


if __name__ == "__main__":
    unittest.main()
