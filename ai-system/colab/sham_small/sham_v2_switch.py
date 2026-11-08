"""The merge point between Sham v2 lineages (served vs candidate donor). A candidate never replaces the served checkpoint by name or hope: it must be MEASURED better on the
fixed held-out documents (bits per byte, comparable across tokenizers) without losing the tools, and it must fit the Studio's memory.

  python sham_v2_switch.py <served v2_history.json> <candidate v2_history.json> [resident_gb_limit]   -> prints the decision as JSON, exit 0 = switch, 1 = keep the served one

The history files are written by the notebooks (sham_v2_train.ipynb / the candidate notebook) next to each checkpoint. Switching itself (publishing the candidate's checkpoint to the model
repo and changing the Studio's SHAM_TEXT_VOCAB / model id together) is a deliberate, separate step: docs/SHAM_V2_ANALYSIS.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def last_entry(path: str | Path) -> dict:
    hist = json.loads(Path(path).read_text(encoding="utf-8"))
    if not hist:
        raise ValueError(f"{path}: empty history")
    return hist[-1]


def decide(served: dict, candidate: dict, ar_margin: float = 0.05, en_tolerance: float = 0.03, tool_floor: float = 0.9,
           resident_gb: float | None = None, resident_limit_gb: float | None = None) -> dict:
    """{switch, reasons}: switch only when the candidate passed its own gate, is better in Arabic by `ar_margin`, not worse in English by more than `en_tolerance`,
    keeps >= `tool_floor` of the served model's tool score, and (when both are given) fits `resident_limit_gb`."""
    why_not = []
    if not (candidate.get("gate") or {}).get("ok", False):
        why_not.append("the candidate did not pass its own merge gate")
    sb, cb = served.get("bpb_after") or served.get("bpb_before"), candidate.get("bpb_after")
    if not sb or not cb:
        why_not.append("bits-per-byte is missing for one of the two (run the notebooks that write it)")
    else:
        if cb["ar"] > sb["ar"] * (1 - ar_margin):
            why_not.append(f"Arabic bits/byte {cb['ar']:.4f} is not better than {sb['ar']:.4f} by {int(ar_margin * 100)} %")
        if cb["en"] > sb["en"] * (1 + en_tolerance):
            why_not.append(f"English bits/byte {cb['en']:.4f} is worse than {sb['en']:.4f} by more than {int(en_tolerance * 100)} %")
    st, ct = served.get("tools_after") or {}, candidate.get("tools_after") or {}
    if st.get("cases") and ct.get("cases"):
        if ct["right"] / ct["cases"] < tool_floor * st["right"] / st["cases"]:
            why_not.append(f"tools {ct['right']}/{ct['cases']} fell below {int(tool_floor * 100)} % of {st['right']}/{st['cases']}")
    if resident_gb is not None and resident_limit_gb is not None and resident_gb > resident_limit_gb:
        why_not.append(f"resident memory {resident_gb:.1f} GB exceeds the Studio limit {resident_limit_gb:.1f} GB")
    return {"switch": not why_not, "reasons": why_not}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: sham_v2_switch.py <served history> <candidate history> [resident_gb_limit]")
    limit = float(sys.argv[3]) if len(sys.argv) > 3 else None
    cand = last_entry(sys.argv[2])
    out = decide(last_entry(sys.argv[1]), cand, resident_gb=cand.get("resident_gb"), resident_limit_gb=limit)
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0 if out["switch"] else 1)
