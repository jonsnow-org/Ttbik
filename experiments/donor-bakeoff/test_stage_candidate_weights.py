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


class ReadBackAndNeutralNames(unittest.TestCase):
    def _hub(self, contents):
        class Hub:
            def download_file(self, repo_id, repo_type, file_path, local_dir, force=False):
                target = Path(local_dir) / file_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(contents[file_path])
                return target
        return Hub()

    def test_read_back_checks_size_and_hash_then_rechecks_the_manifest(self):
        import hashlib
        import json
        from stage_candidate_weights import verify_remote_files
        data = b"x" * 2048
        manifest = {"files": {"qwen35-9b-Q4_K_M.gguf": {"size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}}}
        hub = self._hub({"qwen35-9b-Q4_K_M.gguf": data, MANIFEST_NAME: json.dumps(manifest).encode()})
        slept = []
        verify_remote_files(hub, "novaai2026/sham-donor-qwen35-9b-weights", manifest, "qwen35-9b", recheck_s=7, sleep=slept.append)
        self.assertEqual(slept, [7])

    def test_a_changed_file_fails_the_read_back(self):
        from stage_candidate_weights import verify_remote_files
        manifest = {"files": {"a.gguf": {"size_bytes": 3, "sha256": "0" * 64}}}
        with self.assertRaises(RuntimeError):
            verify_remote_files(self._hub({"a.gguf": b"abc"}), "r", manifest, "qwen35-9b", recheck_s=0)

    def test_stored_names_are_neutral_and_sources_are_kept(self):
        import json
        for name in ("qwen35-9b.json", "gemma4-e4b.json"):
            cfg = json.loads((Path(__file__).parent / "candidates" / name).read_text(encoding="utf-8"))
            for key in ("filename", "mmproj_filename"):
                self.assertNotRegex(cfg[key].lower(), "uncensored|heretic|aggressive")
            self.assertTrue(cfg["source_filename"].endswith(".gguf") and cfg["source_mmproj_filename"].endswith(".gguf"))
