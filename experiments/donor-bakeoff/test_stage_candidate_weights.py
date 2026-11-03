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


    def test_model_repository_creation_and_upload_use_numeric_model_visibility(self):
        source = (Path(stage.__file__).with_name("stage_candidate_weights.py")).read_text(encoding="utf-8")
        self.assertIn("from modelscope.hub.constants import ModelVisibility", source)
        self.assertIn("api.create_model(destination, visibility=ModelVisibility.PRIVATE)", source)
        self.assertIn("visibility=ModelVisibility.PRIVATE", source)
        self.assertNotIn("visibility=Visibility.PRIVATE", source)

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
