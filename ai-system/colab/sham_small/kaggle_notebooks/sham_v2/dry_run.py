"""Run a Sham v2 notebook END TO END on this machine with a tiny random donor, no network, no Kaggle: the first time a notebook edit is checked by RUNNING it, not by reading it.

  python dry_run.py <notebook.ipynb> [--sessions 2] [--work /tmp/dry]

What it replaces (and nothing else): the Kaggle secrets / pip / git-clone cells (skipped), the Hugging Face downloads (the donor is a local folder), the Kaggle dataset
fetch/publish (a local folder per dataset name) and `datasets.load_dataset` (offline: the code's own fallbacks run). Every other cell runs as written, in order, in one namespace.
Session 2 resumes from what session 1 published, which is the save/resume round trip. Prints a JSON summary; exit code 1 when anything is wrong.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CODE = HERE.parents[1]                                 # ai-system/colab/sham_small
SKIP = ("SHAM_SECRETS_FALLBACK_V3", "SHAM_QUIET_START_V4", "UserSecretsClient", '"pip", "install"', "sham_trigger_restarter")


def make_donor(root: Path) -> Path:
    """A tiny random Qwen3 (vocab ~ 400) with a real byte-level tokenizer that has the chat specials: enough to exercise every code path."""
    from tokenizers import Tokenizer, models, pre_tokenizers, decoders, trainers
    from transformers import Qwen3Config, Qwen3ForCausalLM
    root.mkdir(parents=True, exist_ok=True)
    tok = Tokenizer(models.BPE())
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    corpus = ["مرحبا بالعالم، هذا نص عربي للاختبار يتحدث عن الحاسوب والملفات والأدوات.", "Hello world, this is a test about tools, files, python and the computer.", "def f(x):\n    return x + 1\n"] * 40
    trainer = trainers.BpeTrainer(vocab_size=380, special_tokens=["<|endoftext|>", "<|im_start|>", "<|im_end|>", "<think>", "</think>"], initial_alphabet=pre_tokenizers.ByteLevel.alphabet())
    tok.train_from_iterator(corpus, trainer)
    tok.save(str(root / "tokenizer.json"))
    n = tok.get_vocab_size()
    cfg = Qwen3Config(vocab_size=n, hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2, head_dim=16,
                      max_position_embeddings=4096, rope_theta=1_000_000.0, tie_word_embeddings=True)
    Qwen3ForCausalLM(cfg).save_pretrained(str(root), safe_serialization=True)
    (root / "tokenizer_config.json").write_text("{}", encoding="utf-8")
    return root


PRELUDE = r'''
import os, sys, shutil, types
from pathlib import Path
DRY = Path(os.environ["DRY_ROOT"])
sys.path.insert(0, os.environ["DRY_CODE"])
os.makedirs("/kaggle/working", exist_ok=True)
import huggingface_hub as _hh
_local = lambda repo: Path(str(repo)).exists()
_orig_snap, _orig_dl = _hh.snapshot_download, _hh.hf_hub_download
_hh.snapshot_download = lambda repo_id, *a, **k: str(repo_id) if _local(repo_id) else _orig_snap(repo_id, *a, **k)
_hh.hf_hub_download = lambda repo_id, filename, *a, **k: str(Path(repo_id) / filename) if _local(repo_id) else _orig_dl(repo_id, filename, *a, **k)
import sham_inputs as _si
def _fetch(name, owner=None, fresh=False):
    d = DRY / "datasets" / name.split("#")[0]
    return d if d.exists() and any(d.iterdir()) else None
def _publish(upload_dir, name, message):
    d = DRY / "datasets" / name
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(upload_dir, d)
    (DRY / "published.log").open("a").write(name + " | " + message + "\n")
    return name
_si.fetch_dataset, _si.publish_dataset = _fetch, _publish
import json as _j, math as _m
import sham_data_sources as _sd
def _collect(kind, output_dir, max_samples, ledger, **k):
    """Offline stand-in for the network collectors: a few synthetic pictures (gradients with a caption) or tones (with a sentence), same manifest format."""
    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    n = min(int(max_samples), 24)
    size = int(k.get("image_size", 64))
    with open(out / "manifest.jsonl", "w", encoding="utf-8") as mf:
        for i in range(n):
            if kind == "image":
                from PIL import Image
                im = Image.new("RGB", (size, size)); px = im.load()
                for x in range(size):
                    for y in range(size):
                        px[x, y] = ((x * 255 // size + i * 9) % 256, (y * 255 // size) % 256, (i * 40) % 256)
                im.save(out / f"i{i}.png"); mf.write(_j.dumps({"image": f"i{i}.png", "caption": f"صورة رقم {i} فيها ألوان متدرجة"}, ensure_ascii=False) + "\n")
            elif kind == "audio":
                import numpy as np, soundfile as sf
                t = np.arange(16000) / 16000.0
                sf.write(str(out / f"a{i}.wav"), 0.3 * np.sin(2 * _m.pi * (200 + 30 * i) * t), 16000)
                mf.write(_j.dumps({"audio": f"a{i}.wav", "sentence": f"نغمة رقم {i}"}, ensure_ascii=False) + "\n")
    stats = _sd.CollectStats(); stats.written = n
    return str(out / "manifest.jsonl"), stats
_sd.collect = _collect
try:
    import datasets as _ds
    def _offline(*a, **k):
        raise ConnectionError("dry run: no network")
    _ds.load_dataset = _offline
except ImportError:
    pass
'''


def run_session(nb_path: Path, work: Path, session: int, donor: Path) -> dict:
    nb = json.loads(nb_path.read_text(encoding="utf-8"))
    cells = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
    cells = [c for c in cells if not any(m in c for m in SKIP)]
    script = work / f"session{session}.py"
    body = [PRELUDE]
    for i, c in enumerate(cells):
        body.append(f"# ---- cell {i}\n{c}\n")
    body.append("print('DRY-RUN-DONE')\n")
    script.write_text("\n".join(body), encoding="utf-8")
    env = {**os.environ, "DRY_ROOT": str(work), "DRY_CODE": str(CODE), "SHAM_V2_DONOR": str(donor), "SHAM_V2_HOURS": "0.012", "SHAM_V2_TOOL_CASES": "3",
           "SHAM_V2_TOOL_EXAMPLES": "60", "SHAM_V2_TEXT_DOCS": "20", "SHAM_V2_ADAPTER_RANK": "4", "PYTHONPATH": str(CODE), "CUDA_VISIBLE_DEVICES": ""}
    env.pop("SHAM_TEXT_VOCAB", None)
    r = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, env=env, timeout=1500)
    (work / f"session{session}.log").write_text(r.stdout + "\n" + r.stderr, encoding="utf-8")
    return {"ok": r.returncode == 0 and "DRY-RUN-DONE" in r.stdout, "tail": (r.stdout + r.stderr)[-1800:]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("notebook")
    ap.add_argument("--sessions", type=int, default=2)
    ap.add_argument("--work", default="")
    a = ap.parse_args()
    work = Path(a.work or tempfile.mkdtemp(prefix="sham_dry_"))
    shutil.rmtree(work / "datasets", ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    donor = make_donor(work / "donor")
    nb = Path(a.notebook).resolve()
    out = {"notebook": nb.name, "work": str(work), "sessions": []}
    bad = False
    for s in range(1, a.sessions + 1):
        res = run_session(nb, work, s, donor)
        entry = {"session": s, "ran": res["ok"]}
        if not res["ok"]:
            entry["tail"] = res["tail"]
            bad = True
        out["sessions"].append(entry)
        if bad:
            break
    published = sorted((work / "datasets").glob("*/v2_history.json"))
    out["history"] = []
    for h in published:
        hist = json.loads(h.read_text(encoding="utf-8"))
        out["dataset"] = h.parent.name
        out["history"] = [{k: e.get(k) for k in ("step", "stage", "device", "dtype", "resident_gb")} | {"gate_ok": (e.get("gate") or {}).get("ok"), "bpb_after": e.get("bpb_after")} for e in hist]
        out["files"] = sorted(p.name for p in h.parent.iterdir())
    if a.sessions >= 2 and not bad:
        steps = [e["step"] for e in out["history"]]
        out["resumed_from_previous_session"] = len(steps) >= 2 and steps[-1] > steps[-2]
        bad = bad or not out["resumed_from_previous_session"]
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
