"""
Sham's project contract checker ("عقد المشروع").

CONTRACT.json states, for every notebook and workflow of the project, what it reads and what it writes, and which
files an outside editor (an assistant such as Grok, through the grok-gateway) may touch. This checker keeps
that map honest, so a proposed change cannot quietly break the data flow ("two notebooks publishing over one dataset"
was a real incident):

  • every dataset name the notebooks / modules / workflows mention must be in the contract (or match a dynamic pattern
    such as sham-crawl-*);
  • every notebook and workflow of the project must be described in the contract, and every described file must exist;
  • a dataset has ONE writer;
  • an edit may only touch allow-listed paths and never a deny-listed one.

    python sham_contract.py --check          # exit 1 on a violation
    python sham_contract.py --paths a b c    # check paths against the allow/deny lists
"""

from __future__ import annotations

import fnmatch
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CONTRACT = HERE / "CONTRACT.json"
NAME = re.compile(r"\b(?:sham|nova)-[a-z0-9]+(?:-[a-z0-9]+)*\b")
# names that look like datasets but are not (branches, services, ...): only checkpoint/corpus/crawl names are datasets
def _is_dataset_like(n: str) -> bool:
    return n.endswith(("checkpoint", "corpus", "checkpoint-v2", "incoming", "legacy", "reports")) or n.startswith("sham-crawl-") \
        or n in ("sham-merged-checkpoint",)


def load() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def _code_text(path: Path) -> str:
    if path.suffix == ".ipynb":
        nb = json.loads(path.read_text(encoding="utf-8"))
        return "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
    return path.read_text(encoding="utf-8", errors="ignore")


def known(name: str, contract: dict) -> bool:
    return name in contract["datasets"] or any(fnmatch.fnmatch(name, p) for p in contract.get("dynamic_dataset_patterns", []))


def check(root: Path = ROOT) -> tuple[list[str], list[str]]:
    """(violations, warnings)"""
    c = load()
    bad, warn = [], []
    files = {v["file"] for v in c["components"].values()}
    for key, comp in c["components"].items():
        if not (root / comp["file"]).exists():
            bad.append(f"المكوّن {key}: الملف {comp['file']} غير موجود")
    for d in sorted((root / "ai-system/colab/sham_small/kaggle_notebooks").glob("*.ipynb")):
        rel = str(d.relative_to(root)).replace("\\", "/")
        if rel not in files:
            bad.append(f"الدفتر {rel} غير موصوف في CONTRACT.json")
    for w in sorted((root / ".github/workflows").glob("sham-*.yml")) + [root / ".github/workflows/grok-gateway.yml"]:
        if w.exists() and str(w.relative_to(root)).replace("\\", "/") not in files:
            bad.append(f"سير العمل {w.name} غير موصوف في CONTRACT.json")
    writers: dict[str, list[str]] = {}
    for key, comp in c["components"].items():
        for ds in comp.get("writes", []):
            writers.setdefault(ds, []).append(key)
            if not known(ds, c):
                bad.append(f"{key} يكتب في مجموعة غير معرّفة: {ds}")
    for ds, who in writers.items():
        if len(set(who)) > 1:
            bad.append(f"المجموعة {ds} لها أكثر من كاتب: {', '.join(sorted(set(who)))}")
        decl = c["datasets"].get(ds, {}).get("writer")
        if decl and not decl.startswith("any") and decl not in who:
            warn.append(f"المجموعة {ds}: الكاتب المعلن {decl} غير مذكور في writes")
    scan = [root / v["file"] for v in c["components"].values() if (root / v["file"]).exists()]
    scan += [p for p in (root / "ai-system/colab/sham_small").glob("*.py")]
    for p in scan:
        try:
            text = _code_text(p)
        except Exception:
            continue
        for n in sorted(set(NAME.findall(text))):
            if _is_dataset_like(n) and not known(n, c):
                bad.append(f"{p.relative_to(root)} يذكر مجموعة غير معرّفة في العقد: {n}")
    for key, comp in c["components"].items():
        p = root / comp["file"]
        if p.exists() and comp["kind"].startswith("notebook"):
            text = _code_text(p)
            for ds in comp.get("writes", []):
                if ds not in text:
                    warn.append(f"{key}: لا يذكر {ds} في كوده (قد يكتبها عبر وحدة)")
    return bad, warn


def path_allowed(path: str, c: dict | None = None) -> tuple[bool, str]:
    c = c or load()
    p = path.replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    if ".." in p.split("/") or p.startswith("/"):
        return False, "مسار يخرج من المستودع"
    low = p.lower()
    for bad in c["edit_denylist"]:
        if bad.lower() in low:
            return False, f"مسار ممنوع التعديل ({bad})"
    if not any(p.startswith(a) for a in c["edit_allowlist"]):
        return False, "خارج المسارات المسموح تعديلها"
    return True, ""


if __name__ == "__main__":
    if "--paths" in sys.argv:
        c = load()
        for p in sys.argv[sys.argv.index("--paths") + 1:]:
            ok, why = path_allowed(p, c)
            print(("✅ " if ok else "❌ ") + p + (f" — {why}" if why else ""))
        sys.exit(0)
    violations, warnings = check()
    for w in warnings:
        print("⚠", w)
    for v in violations:
        print("❌", v)
    print(f"العقد: {len(violations)} مخالفة، {len(warnings)} تنبيه")
    if "--selftest" in sys.argv:
        ok, _ = path_allowed("ai-system/colab/sham_small/sham_merge.py")
        no1, _ = path_allowed(".github/workflows/ci.yml")
        no2, _ = path_allowed("ai-system/colab/sham_small/api_keys.py")
        no3, _ = path_allowed("ai-system/colab/sham_small/../../app/x.py")
        no4, _ = path_allowed("ai-system/app/x.py")
        assert ok and not (no1 or no2 or no3 or no4)
        assert known("sham-crawl-foo-corpus", load()) and not known("sham-mystery-checkpoint", load())
        print("sham_contract self-test OK")
    sys.exit(1 if violations else 0)
