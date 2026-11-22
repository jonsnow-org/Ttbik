"""No model output may sit outside the merge by accident (owner's order 2026-11-13: «no notebook or output may be lost without being connected to the merge»).
Every dataset the contract says a notebook/trainer WRITES as a model checkpoint must be picked up by the merge's discovery rule (model_dataset_candidates); the ones that are
excluded on purpose (tokenizers, corpora, media factory, v2) are named here, so a new exclusion needs a conscious edit. Own interpreter: sham_inputs installs the VQ patch on import."""
import json
import pathlib
import subprocess
import sys
import unittest

CODE = r'''
import json, sys, pathlib
sys.path.insert(0, sys.argv[1])
import sham_inputs
contract = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
names = list(contract["datasets"].keys())
found = set(sham_inputs.model_dataset_candidates(names))
print(json.dumps({"names": names, "found": sorted(found)}))
'''

# excluded ON PURPOSE: not a mergeable model of the old lineage
INTENTIONAL = ("tokenizer", "corpus", "video", "reports", "keeper", "orchestrator", "runtime-creds", "text-shards", "sham-media-", "sham-v2", "sham-bank", "sham-merged")


class MergeCoverage(unittest.TestCase):
    def test_every_checkpoint_the_contract_writes_is_discovered(self):
        here = pathlib.Path(__file__).parent
        contract = here.parent.parent / "supervision" / "CONTRACT.json"
        r = subprocess.run([sys.executable, "-c", CODE, str(here), str(contract)], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        data = json.loads(r.stdout.strip().splitlines()[-1])
        c = json.loads(contract.read_text(encoding="utf-8"))["datasets"]
        lost = []
        for n in data["names"]:
            info = c[n]
            if not info.get("writer"):          # legacy / read-only names
                continue
            if any(x in n for x in INTENTIONAL):
                continue
            if "checkpoint" in n and n not in data["found"]:
                lost.append(n)
        self.assertEqual(lost, [], f"checkpoint datasets the contract writes but the merge would never see: {lost}")


if __name__ == "__main__":
    unittest.main()
