"""Sham's weight inventory (read-only): what every saved lineage really is, measured on the SAME ruler the merge gate uses.

sham-ci: entrypoint (needs Kaggle credentials and checkpoints; the pure helpers are tested by test_sham_inventory.py)

For the merged head and every candidate source (KNOWN_SOURCES + the sham-crawl-* models) it records:
  * health: finite weights, shapes and tokenizer identical to the head's (a mismatch means the file can never be merged as it is);
  * distance: relative L2 between the candidate and the head, per group (embeddings / attention / mlp / norms / head);
  * the gate's three skills (text, chat, media) for the candidate ALONE, both as the file is and as the merge job sees it after the repair stage;
  * the interpolation curve head -> candidate at several ratios (does ANY ratio keep every skill inside the gate, or does one skill fall faster than another gains?);
  * the trainer's OWN holdout numbers (crawl_progress.json) next to the gate's: when they disagree the ruler, not the model, may be wrong;
  * a verdict in plain words.
Nothing is written to Kaggle or to any checkpoint. The result is printed and saved as inventory.json / inventory.md (the workflow uploads them as an artifact).
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

import torch

GROUPS = (("embed", ("embed", "wte", "tok_emb")), ("head", ("lm_head", "output")), ("attn", ("attn", "attention", "qkv", "wq", "wk", "wv", "wo")),
          ("mlp", ("mlp", "ffn", "feed_forward", "w1", "w2", "w3")), ("norm", ("norm", "ln_")))
CURVE = (0.05, 0.1, 0.25, 0.5, 1.0)


def group_of(name: str) -> str:
    low = name.lower()
    for group, keys in GROUPS:
        if any(k in low for k in keys):
            return group
    return "other"


def relative_distance(a: dict, b: dict) -> dict:
    """Relative L2 ||a-b|| / ||b|| overall and per group, over parameters both have with the same shape."""
    num: dict[str, float] = {}
    den: dict[str, float] = {}
    for n, pb in b.items():
        pa = a.get(n)
        if pa is None or pa.shape != pb.shape:
            continue
        g = group_of(n)
        d = (pa.float() - pb.float())
        num[g] = num.get(g, 0.0) + float((d * d).sum())
        den[g] = den.get(g, 0.0) + float((pb.float() ** 2).sum())
    out = {g: math.sqrt(num[g] / max(den[g], 1e-12)) for g in num}
    out["all"] = math.sqrt(sum(num.values()) / max(sum(den.values()), 1e-12)) if num else float("nan")
    return out


def health(state: dict, head: dict) -> dict:
    bad = [n for n, p in state.items() if p.is_floating_point() and not torch.isfinite(p).all()]
    missing = [n for n in head if n not in state]
    shaped = [n for n in head if n in state and state[n].shape != head[n].shape]
    return {"finite": not bad, "nonfinite_params": bad[:5], "missing": missing[:5], "shape_mismatch": shaped[:5],
            "max_abs": max((float(p.abs().max()) for p in state.values() if p.is_floating_point()), default=0.0)}


def interpolate(head_state: dict, other_state: dict, lam: float) -> dict:
    return {n: ((1 - lam) * p.float() + lam * other_state[n].float()).to(p.dtype) if n in other_state and other_state[n].shape == p.shape else p for n, p in head_state.items()}


def passes_gate(score: dict, base: dict, tolerance: float | None = None) -> bool:
    from sham_merge import _passes, default_tolerance
    return _passes(score, base, default_tolerance() if tolerance is None else tolerance)


def verdict(entry: dict, base: dict) -> str:
    h = entry.get("health") or {}
    if entry.get("error"):
        return "لا يُقرأ: " + str(entry["error"])[:80]
    if h and not h.get("finite", True):
        return "معطوب (قيم غير منتهية): يُحذف"
    if h and (h.get("missing") or h.get("shape_mismatch")):
        return "غير متوافق مع الرأس (بنية مختلفة): لا يُدمج بالأوزان"
    if entry.get("tokenizer_match") is False:
        return "مُرمِّزه يختلف عن الرأس: لا يُدمج دون إصلاح"
    alone = entry.get("alone") or {}
    own = entry.get("trainer_holdout") or {}
    if alone and own.get("chat") is not None and own.get("chat_base") is not None and alone.get("chat") and base.get("chat"):
        if own["chat"] < own["chat_base"] and alone["chat"] > base["chat"] * 1.2:
            return "تعارض بين المسطرتين: المدرّب يرى المحادثة تحسّنت والبوابة ترى أنها ساءت — افحص القياس قبل الحكم على الأوزان"
    ok = [lam for lam, s in (entry.get("curve") or {}).items() if passes_gate(s, base)]
    if ok:
        return f"قابل للدمج عند النسب {', '.join(str(x) for x in ok)}"
    if alone and base:
        gains = {k: (alone[k] / base[k] - 1) * 100 for k in base if k in alone}
        better = [k for k, v in gains.items() if v <= -2]
        worse = [k for k, v in gains.items() if v >= 20]
        if better and worse:
            return f"متخصص: يتحسن في {', '.join(better)} ويخسر {', '.join(worse)} — يُعاد تأهيله بالتذكير أو يُدرَّب الرأس على بياناته"
        if not better:
            return "لا يضيف شيئًا على الرأس"
    return "غير محسوم"


def markdown(head: dict, rows: list[dict]) -> str:
    lines = ["# جرد أوزان شام", "", f"الرأس: خطوة {head.get('step')} — " + ", ".join(f"{k}={v:.3f}" for k, v in (head.get('score') or {}).items()), "",
             "| المصدر | الخطوة | text | chat | media | المسافة عن الرأس | الحكم |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        a = r.get("alone") or {}
        d = (r.get("distance") or {}).get("all")
        lines.append(f"| {r['name']} | {r.get('step', '—')} | " + " | ".join(f"{a[k]:.3f}" if k in a else "—" for k in ("text", "chat", "media"))
                     + f" | {d:.3f} | " if d is not None and d == d else f"| {r['name']} | {r.get('step', '—')} | — | — | — | — | ")
        lines[-1] = lines[-1] + (r.get("verdict") or "") + " |"
    return "\n".join(lines)


def main() -> int:
    from checkpoint import load_checkpoint
    from sham_ci_merge import OWN, WORK, _FROZEN, default_gate, pick_base
    import sham_ci_merge
    from sham_inputs import fetch_dataset
    from sham_merge import KNOWN_SOURCES, batches_loss, latest_checkpoint, load_source
    from text_tokenizer import ShamTextTokenizer

    device = "cpu"
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    ckpt, base_dir, label, progress = pick_base(fetch_dataset, probe=None)
    if (os.environ.get("SHAM_INV_HEAD") or "merged").lower() != "pick":
        # 2026-11-13: the first inventory used the name-ordered pick (chat checkpoint, step 85,917) as the head, while the real merge continues from the published head
        # (sham-merged-checkpoint, step 61,555): every distance and verdict was measured against the wrong model. Default = the published head.
        own = fetch_dataset(OWN)
        hits = sorted(own.rglob("final_merged.pt")) if own else []
        if hits:
            ckpt, base_dir, label = hits[0], hits[0].parent, OWN
            progress = {}
            for q in own.rglob("merge_progress.json"):
                try:
                    progress = json.loads(q.read_text(encoding="utf-8"))
                except Exception:
                    pass
    model, step, _ = load_checkpoint(ckpt, map_location=device)
    tok_path = sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]
    tokenizer = ShamTextTokenizer.load(str(tok_path))
    tok_hash = hashlib.sha256(tok_path.read_bytes()).hexdigest()[:12]
    _FROZEN.clear()
    if progress.get("gate_text"):
        _FROZEN["text"] = progress["gate_text"]
    gate = default_gate(model, tokenizer, base_dir, device)
    score = lambda m: {k: batches_loss(m, v, device) for k, v in gate.items()}
    base = score(model)
    head_state = {n: p.detach().clone() for n, p in model.state_dict().items()}
    print(f"الرأس: {label} خطوة {step:,} — " + ", ".join(f"{k}={v:.3f}" for k, v in base.items()), flush=True)

    only = [s.strip() for s in os.environ.get("SHAM_INV_SOURCES", "").split(",") if s.strip()]
    limit = int(os.environ.get("SHAM_INV_MAX", "14"))
    sources = [(n, p, r) for n, p, r in list(KNOWN_SOURCES) if n != OWN and (not only or n in only)][:limit]
    rows: list[dict] = []
    for name, pattern, _rows in sources:
        entry: dict = {"name": name}
        t0 = time.time()
        try:
            root = fetch_dataset(name)
            if not root:
                entry["error"] = "المجموعة غير متاحة"
                rows.append(entry)
                continue
            path = latest_checkpoint(root, pattern)
            if path is None:
                entry["error"] = "لا توجد نقطة حفظ"
                rows.append(entry)
                shutil.rmtree(root, ignore_errors=True)
                continue
            for p in root.rglob("crawl_progress.json"):
                try:
                    pj = json.loads(p.read_text(encoding="utf-8"))
                    hold, basel = pj.get("holdout") or {}, pj.get("baseline") or {}
                    entry["trainer_holdout"] = {"chat": hold.get("chat"), "chat_base": basel.get("chat"), "all": hold, "baseline": basel, "base": pj.get("base"), "sessions": pj.get("sessions"),
                                                "rollbacks": pj.get("rollbacks")}
                except Exception:
                    pass
                break
            toks = sorted(root.rglob("sham_small_tokenizer.json"))
            entry["tokenizer_match"] = (hashlib.sha256(toks[0].read_bytes()).hexdigest()[:12] == tok_hash) if toks else None
            raw, raw_step, _ = load_checkpoint(path, map_location=device)
            entry["step"] = int(raw_step)
            state = {n: p.detach() for n, p in raw.state_dict().items()}
            entry["health"] = health(state, head_state)
            entry["distance"] = relative_distance(state, head_state)
            if entry["health"]["finite"] and not entry["health"]["missing"] and not entry["health"]["shape_mismatch"]:
                entry["alone"] = score(raw)
                curve = {}
                work = copy.deepcopy(model)
                for lam in CURVE:
                    work.load_state_dict(interpolate(head_state, state, lam))
                    curve[lam] = score(work)
                entry["curve"] = curve
                del work
                try:                                                   # the candidate as the merge job sees it (after the repair stage): a difference from `alone` is the repair's doing
                    loaded, why = load_source(root, pattern, model, tokenizer)
                    entry["merge_view"] = score(loaded[0]) if loaded else None
                    entry["merge_view_note"] = why
                except Exception as exc:  # noqa: BLE001
                    entry["merge_view_note"] = f"{type(exc).__name__}: {str(exc)[:100]}"
            del raw
            shutil.rmtree(root, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        entry["verdict"] = verdict(entry, base)
        entry["seconds"] = round(time.time() - t0)
        rows.append(entry)
        print(f"• {name}: {entry['verdict']}", flush=True)
    out = {"head": {"label": label, "step": int(step), "score": base, "tokenizer": tok_hash}, "sources": rows}
    (WORK / "inventory.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    (WORK / "inventory.md").write_text(markdown(out["head"], rows), encoding="utf-8")
    print((WORK / "inventory.md").read_text(encoding="utf-8"))
    return 0


def _selftest() -> None:
    a = {"tok_emb.weight": torch.ones(4, 4), "layers.0.attn.wq.weight": torch.ones(4, 4), "layers.0.mlp.w1.weight": torch.ones(4, 4), "norm.weight": torch.ones(4)}
    b = {k: v * 1.1 for k, v in a.items()}
    d = relative_distance(b, a)
    assert abs(d["all"] - 0.1) < 1e-6 and set(d) >= {"embed", "attn", "mlp", "norm", "all"}, d
    bad = dict(a)
    bad["norm.weight"] = torch.tensor([1.0, float("nan"), 1.0, 1.0])
    assert health(bad, a)["finite"] is False and health(a, a)["finite"] is True
    assert health({**a, "tok_emb.weight": torch.ones(2, 2)}, a)["shape_mismatch"] == ["tok_emb.weight"]
    mid = interpolate(a, b, 0.5)
    assert abs(float(mid["norm.weight"][0]) - 1.05) < 1e-6
    base = {"text": 4.0, "chat": 2.0, "media": 7.0}
    assert verdict({"error": "x"}, base).startswith("لا يُقرأ")
    assert "يُحذف" in verdict({"health": {"finite": False}}, base)
    assert "غير متوافق" in verdict({"health": {"finite": True, "missing": ["a"], "shape_mismatch": []}}, base)
    spec = {"health": {"finite": True, "missing": [], "shape_mismatch": []}, "alone": {"text": 3.5, "chat": 4.1, "media": 9.0}, "curve": {0.05: {"text": 3.99, "chat": 2.1, "media": 7.1}}}
    assert verdict(spec, base).startswith("متخصص"), verdict(spec, base)
    conflict = {**spec, "trainer_holdout": {"chat": 1.8, "chat_base": 2.0}}
    assert verdict(conflict, base).startswith("تعارض"), verdict(conflict, base)
    good = {"health": {"finite": True, "missing": [], "shape_mismatch": []}, "alone": {"text": 3.9, "chat": 2.0, "media": 7.0}, "curve": {0.5: {"text": 3.9, "chat": 1.99, "media": 6.9}}}
    assert verdict(good, base).startswith("قابل للدمج"), verdict(good, base)
    assert "|" in markdown({"step": 1, "score": base}, [{"name": "x", "step": 2, "alone": base, "distance": d, "verdict": "ok"}])
    print("sham_inventory self-test OK: distances, health, interpolation, verdicts (specialist, ruler conflict, mergeable)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        raise SystemExit(main())
