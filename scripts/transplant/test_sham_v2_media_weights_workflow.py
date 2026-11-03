import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "sham-v2-media-weights.yml"


class ShamV2MediaWeightsWorkflow(unittest.TestCase):
    def test_private_repo_reads_use_the_explicit_current_token(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('pip install modelscope "modelscope-hub==0.6.1"', source)
        self.assertIn("from modelscope_hub.compat import snapshot_download", source)
        self.assertIn('snapshot_download(media_id, cache_dir="src", token=token)', source)
        self.assertIn('snapshot_download(target_id, cache_dir="existing", token=token)', source)
        self.assertNotIn("from modelscope import snapshot_download", source)

    def test_only_sham_v2_receives_media_and_size_guard_remains(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('target_id = "novaai2026/sham-v2"', source)
        self.assertIn('media_id = "novaai2026/nova-media-models"', source)
        self.assertIn('get("SHAM_V2_MAX_MODEL_GIB", "7.2")', source)
        self.assertIn("api.push_model(model_id=target_id", source)
        self.assertIn("visibility=Visibility.PRIVATE", source)


if __name__ == "__main__":
    unittest.main()
