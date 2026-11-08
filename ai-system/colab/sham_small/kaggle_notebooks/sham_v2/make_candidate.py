"""Derive the CANDIDATE-donor notebook from the Sham v2 notebook (so the two can never drift): same cells, same gate, but its own donor and its own checkpoint dataset.

The served Sham v2 lineage (sham-v2-checkpoint, Qwen3 vocabulary 151936) is never touched by a candidate: a candidate publishes to `sham-v2-candidate-checkpoint` and only
replaces the served one through sham_v2_switch.py (measured, deliberate). Usage: python make_candidate.py  (rewrites ../sham_v2_candidate/)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "sham_v2_candidate"
DONOR = "HuggingFaceTB/SmolLM3-3B"
DATASET = "sham-v2-candidate-checkpoint"
SLUG = "jonsnowjonsnow/sham-v2-candidate-train"

ENV_CELL = f'''# CANDIDATE lineage: another donor body (chosen by measurement, docs/SHAM_V2_ANALYSIS.md), published to its OWN dataset; the served Sham v2 is not touched.
import os
os.environ["SHAM_V2_DONOR"] = "{DONOR}"
os.environ["SHAM_V2_DATASET"] = "{DATASET}"
# bf16 body: a 3B donor does not fit twice in fp32 on the free GPU/CPU (12 GB); sham_v2_train.prepare_model builds in this dtype
os.environ.setdefault("SHAM_V2_DTYPE", "bfloat16")
'''


def build() -> None:
    nb = json.loads((HERE / "sham_v2_train.ipynb").read_text(encoding="utf-8"))
    head = {"cell_type": "markdown", "metadata": {}, "source": [f"# شام v2 المرشَّح — جسم `{DONOR}` (سلالة مرشحة تُقاس قبل أن تحلّ محل المخدومة)\n"]}
    code = {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": ENV_CELL.splitlines(True)}
    nb["cells"] = [head, code] + nb["cells"]
    OUT.mkdir(exist_ok=True)
    (OUT / "sham_v2_candidate_train.ipynb").write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    meta = json.loads((HERE / "kernel-metadata.json").read_text(encoding="utf-8"))
    meta.update({"id": SLUG, "title": "sham-v2-candidate-train", "code_file": "sham_v2_candidate_train.ipynb"})
    (OUT / "kernel-metadata.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    build()
    sys.exit(0)
