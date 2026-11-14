"""resolve_start: a healthy published head is the start WITHOUT downloading the other three lineages (own interpreter: sham_inputs installs the VQ patch on import)."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

CODE = r'''
import pathlib, sys, tempfile
sys.path.insert(0, sys.argv[1])
import sham_inputs, sham_base_select, sham_live
tmp = pathlib.Path(tempfile.mkdtemp())
fetched = []

def fake_fetch(name, *a, **k):
    fetched.append(name)
    d = tmp / name
    d.mkdir(exist_ok=True)
    if name == "sham-merged-checkpoint":
        (d / "final_merged.pt").write_bytes(b"x")
        (d / "sham_small_tokenizer.json").write_text("{}")
        return d
    return None

def fake_probe(*a, **k):
    def probe(ckpt, tok):
        probe.last_chance = 10.0
        return 4.4
    probe.last_chance = None
    return probe

sham_inputs.fetch_dataset = fake_fetch
sham_base_select.make_probe = fake_probe
ckpt, folder, base, origin = sham_live.resolve_start("sham-crawl-ms1")
print("FETCHED", ",".join(fetched))
print("ORIGIN", origin)
'''


class StartFast(unittest.TestCase):
    def test_head_only(self):
        r = subprocess.run([sys.executable, "-c", CODE, str(pathlib.Path(__file__).parent)], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stderr[-600:])
        self.assertIn("FETCHED sham-merged-checkpoint,sham-crawl-ms1", r.stdout)
        self.assertIn("sham-merged-checkpoint", r.stdout.split("ORIGIN", 1)[1])


if __name__ == "__main__":
    unittest.main()
