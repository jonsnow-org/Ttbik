import tempfile
import unittest
from pathlib import Path

from stage_candidate_weights import MANIFEST_NAME, download_private_manifest


class CandidateManifestFileDownloadTests(unittest.TestCase):
    def test_downloads_manifest_by_exact_path_from_candidate_private_model_repo(self):
        class FakeHub:
            def __init__(self):
                self.calls = []

            def download_file(self, repo_id, repo_type, file_path, local_dir, force=False):
                self.calls.append((repo_id, repo_type, file_path, local_dir, force))
                target = Path(local_dir) / file_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{"candidate_id":"qwen35-9b"}', encoding="utf-8")
                return target

        api = FakeHub()
        with tempfile.TemporaryDirectory() as folder:
            result = download_private_manifest(api, "novaai2026/sham-donor-qwen35-9b-weights", folder)
            self.assertEqual(result, Path(folder) / MANIFEST_NAME)
            self.assertEqual(result.read_text(encoding="utf-8"), '{"candidate_id":"qwen35-9b"}')
        self.assertEqual(api.calls[0][0:3], (
            "novaai2026/sham-donor-qwen35-9b-weights",
            "model",
            MANIFEST_NAME,
        ))
        self.assertTrue(api.calls[0][4])

    def test_missing_downloaded_file_is_not_treated_as_verified(self):
        class FakeHub:
            def download_file(self, *args, **kwargs):
                return Path(kwargs["local_dir"]) / MANIFEST_NAME

        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(FileNotFoundError):
                download_private_manifest(FakeHub(), "novaai2026/sham-donor-qwen35-9b-weights", folder)


if __name__ == "__main__":
    unittest.main()
