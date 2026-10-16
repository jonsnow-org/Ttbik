"""One command: evaluate a trained boost against plain Sham on the SAME
held-out gate the CI merge uses, and write a merged checkpoint only if no
skill gets worse.

  python -m sham_boost.one_click_merge --ckpt final_merged.pt \
      --boost boost/boost_state.pt --tokenizer tokenizer.json            # report only
  ... --apply --out final_boosted.pt                                     # write if it passes

Rules
- Gate batches: sham_ci_merge.default_gate (text / chat / media).
- Pass test: sham_merge._passes with --tolerance (default 0.005 = the
  current merge gate; the engineer may relax it, e.g. 0.015).
- Optional --stageb-base: stage-B base weights are scored the same way.
- Output is always a NEW file; final_merged.pt is never written.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from sham_boost.boosted import BoostedSham  # noqa: E402


def score(model, gate: dict, device: str = "cpu") -> dict:
    from sham_merge import batches_loss
    with torch.no_grad():
        return {k: batches_loss(model, v, device) for k, v in gate.items()}


def decide(base_score: dict, boost_score: dict, tolerance: float) -> tuple[bool, str]:
    from sham_merge import _passes
    ok = _passes(boost_score, base_score, tolerance)
    lines = [f"{k}: {base_score[k]:.4f} → {boost_score[k]:.4f} ({(boost_score[k] / base_score[k] - 1) * 100:+.2f}%)"
             for k in base_score]
    return ok, ("✅ يمرّ" if ok else "❌ لا يمرّ") + " | " + ", ".join(lines)


def run(ckpt, boost, gate: dict, tolerance=0.005, apply=False, out=None, stageb_base=None, log=print) -> dict:
    model = BoostedSham.from_checkpoint(ckpt, boost)
    model.eval()
    if stageb_base:
        sd = torch.load(stageb_base, map_location="cpu", weights_only=False)["model_state_dict"]
        plain = BoostedSham.from_checkpoint(ckpt).base
        model.base.load_state_dict(sd)
    else:
        plain = model.base
    base_s = score(plain, gate)
    boost_s = score(model, gate)
    ok, line = decide(base_s, boost_s, tolerance)
    log(line)
    log("البوابات: " + json.dumps({k: round(v, 4) for k, v in model.gates().items()}, ensure_ascii=False))
    written = None
    if ok and apply:
        if not out:
            raise SystemExit("--apply needs --out (a NEW file name)")
        written = str(model.fold_in(out, source=ckpt))
        log(f"كُتب الملف المدموج: {written}")
    elif apply:
        log("لم يُكتب شيء لأن الفحص لم ينجح.")
    return {"pass": ok, "base": base_s, "boost": boost_s, "written": written}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--boost", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--base-dir", default=".")
    ap.add_argument("--tolerance", type=float, default=0.005)
    ap.add_argument("--stageb-base", default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-media", action="store_true")
    a = ap.parse_args(argv)
    from text_tokenizer import ShamTextTokenizer
    from sham_ci_merge import default_gate
    tok = ShamTextTokenizer.load(a.tokenizer)
    ref = BoostedSham.from_checkpoint(a.ckpt).base
    gate = default_gate(ref, tok, Path(a.base_dir), "cpu", build_media=not a.no_media)
    del ref
    r = run(a.ckpt, a.boost, gate, a.tolerance, a.apply, a.out, a.stageb_base)
    return 0 if r["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
