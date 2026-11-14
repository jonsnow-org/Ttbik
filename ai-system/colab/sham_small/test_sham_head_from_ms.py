"""The published head can come from the ModelScope model repo (fast from the cn Studio) when SHAM_HEAD_SOURCE=modelscope; Kaggle stays the fallback. Own interpreter: importing sham_inputs installs the VQ patch."""
import pathlib
import subprocess
import sys
import unittest

CODE = r'''
import os, pathlib, sys, tempfile, types
sys.path.insert(0, sys.argv[1])
os.environ["SHAM_HEAD_SOURCE"] = "modelscope"
tmp = pathlib.Path(tempfile.mkdtemp())
repo = tmp / "repo"; repo.mkdir()
for n in ("final_merged.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt", "bridge_manifest.json"):
    (repo / n).write_bytes(b"x")
fake = types.ModuleType("modelscope")
fake.snapshot_download = lambda repo_id, cache_dir=None, **k: str(repo)
sys.modules["modelscope"] = fake
import sham_inputs
sham_inputs.FETCH_ROOT = tmp / "fetch"
d = sham_inputs.fetch_dataset("sham-merged-checkpoint")
print("GOT", sorted(p.name for p in d.iterdir()))
'''


class HeadFromMs(unittest.TestCase):
    def test_copies_only_what_the_trainer_needs(self):
        r = subprocess.run([sys.executable, "-c", CODE, str(pathlib.Path(__file__).parent)], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-600:])
        self.assertIn("'final_merged.pt'", r.stdout)
        self.assertIn("'sham_small_tokenizer.json'", r.stdout)
        self.assertNotIn("bridge_manifest", r.stdout)


if __name__ == "__main__":
    unittest.main()
