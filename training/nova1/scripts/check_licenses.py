"""Re-reads the licence of every Hugging Face source in datasets.yaml from its live dataset card and stops on any change.

    python scripts/check_licenses.py            # exit 1 if a licence differs from datasets.yaml or is non-commercial
"""
import json
import sys
import urllib.request
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent.parent
BLOCKED = ("nc", "non-commercial", "noncommercial", "nd")


def card_license(repo: str) -> str:
    with urllib.request.urlopen(f"https://huggingface.co/api/datasets/{repo}", timeout=30) as r:
        d = json.load(r)
    lic = (d.get("cardData") or {}).get("license") or ",".join(t[8:] for t in d.get("tags", []) if t.startswith("license:"))
    return str(lic or "").lower()


def main() -> int:
    plan = yaml.safe_load((HERE / "datasets.yaml").read_text())
    bad = 0
    for s in plan["sources"] + plan.get("eval", []):
        repo = s.get("hf")
        if not repo or s.get("status") in ("excluded", "hold") or s.get("enabled") is False:
            continue
        want = str(s["license"]).split(" ")[0].lower()
        got = card_license(repo)
        flag = ""
        if want not in got:
            flag = "CHANGED"
        if any(f"-{b}" in got or got == b for b in BLOCKED):
            flag = "NON-COMMERCIAL"
        bad += bool(flag)
        print(f"{'!!' if flag else 'ok'}  {repo:55s} plan={want:12s} card={got:15s} {flag}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
