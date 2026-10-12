"""
Read-only probe of Kaggle datasets: their status, version and file list, and whether a download really works (first bytes only).
Why: `kaggle datasets download` answers a bare 404 for a dataset whose latest version is broken or still processing, and the callers print
nothing more (the access check said 'unavailable' for sham-merged-checkpoint for hours). This prints the facts.

  python sham_dataset_probe.py name1 name2 ...      (names without the owner; the owner is KAGGLE_USERNAME)
"""
from __future__ import annotations

import os
import subprocess
import sys


def run(cmd: list[str], timeout: int = 120) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return ((r.stdout or "") + (r.stderr or "")).strip()


def main(names: list[str]) -> int:
    user = os.environ.get("KAGGLE_USERNAME", "")
    if names and names[0] == "--list":                      # --list <prefix>: the account's datasets whose name starts with it, with sizes
        for page in range(1, 6):
            out = run(["kaggle", "datasets", "list", "-m", "-s", names[1], "--csv", "-p", str(page)])
            rows = [l for l in out.splitlines()[1:] if l.startswith(f"{user}/")]
            if not rows:
                break
            print("\n".join(r[:160] for r in rows))
        return 0
    if names and names[0] == "--inventory":                 # every sham* dataset of the account: kind, size, and whether any code of the project reads it
        sys.path.insert(0, "ai-system/colab/sham_small")
        import re
        from sham_inputs import repo_dataset_names
        used = repo_dataset_names()
        rows: dict[str, list] = {}
        for page in range(1, 21):
            out = run(["kaggle", "datasets", "list", "-m", "--csv", "-p", str(page)])
            got = [l.split(",") for l in out.splitlines()[1:] if l.startswith(f"{user}/")]
            if not got:
                break
            for g in got:
                name = g[1] if len(g) > 1 else g[0].split("/", 1)[1]
                if name.startswith(("sham", "nova")):
                    rows[name] = [int(g[2]) if len(g) > 2 and g[2].isdigit() else 0, g[3][:10] if len(g) > 3 else ""]
        batch = re.compile(r"^sham-media-(image|audio)-\d{12}$")
        kinds = {"media_batches": [], "tokenizer": [], "corpus": [], "model": [], "other": []}
        for n, (size, day) in sorted(rows.items()):
            k = ("media_batches" if batch.match(n) else "tokenizer" if "tokenizer" in n else "corpus" if n.endswith("corpus")
                 else "model" if any(x in n for x in ("checkpoint", "merged", "crawl-gh", "-gh")) else "other")
            kinds[k].append((n, size, day))
        print(f"مجموعات شام في الحساب: {len(rows)}")
        mb = kinds.pop("media_batches")
        print(f"- دفعات مصنع الوسائط: {len(mb)} (صور {sum(1 for n, *_ in mb if '-image-' in n)}، صوت {sum(1 for n, *_ in mb if '-audio-' in n)})")
        for k, items in kinds.items():
            print(f"- {k}:")
            for n, size, day in items:
                reads = "يقرؤها كود المشروع" if n in used else "لا أحد يقرؤها بالاسم"
                print(f"    {n} | {size / 1e6:.1f} MB | {day} | {reads}")
        return 0
    for n in names:
        slug = n if "/" in n else f"{user}/{n}"
        print(f"===== {slug}")
        print("status:", run(["kaggle", "datasets", "status", slug])[:300])
        files = run(["kaggle", "datasets", "files", slug, "--csv"])
        print("files:\n" + "\n".join(files.splitlines()[:12])[:900])
        meta = run(["kaggle", "datasets", "metadata", slug, "-p", "/tmp/dsmeta"])
        print("metadata:", meta[:200])
        tmp = f"/tmp/dsprobe_{n}"
        out = run(["kaggle", "datasets", "download", slug, "-p", tmp, "--unzip", "-f", "sham_small_tokenizer.json"], timeout=300)
        print("download one small file:", out[:300])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
