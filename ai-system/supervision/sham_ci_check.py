"""
The pull-request check for the model project (read-only, no secrets): what a reviewer — the owner, or an assistant such as
Grok — needs to know before merging anything under ai-system/ into the branch every Kaggle notebook clones.

  1. every changed .py compiles; every changed .json/.ipynb parses;
  2. the project contract holds (sham_contract.py: datasets, single writer, notebooks described, allowed paths);
  3. no ADDED line executes text (exec/eval), shells out, prints a secret, or looks like a key;
  4. every changed module of ai-system/colab/sham_small (and of ai-system/supervision, with --selftest) that has a self-test runs it;
  5. a changed notebook must come with a rebuilt cell-sync table (sham_cell_updates.json), or its fix would never reach the
     notebooks already imported on Kaggle;
  6. a changed workflow file is not blocked, but is called out loudly: it can only be merged with the owner's eyes on it.

    python sham_ci_check.py --base origin/<default-branch>
"""

from __future__ import annotations

import json
import os
import py_compile
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHAM = "ai-system/colab/sham_small/"
sys.path.insert(0, str(HERE))
import sham_contract  # noqa: E402

BAD_ADDED = [
    (re.compile(r"\bexec\s*\("), "exec( — تنفيذ نص مرفوض في مشروعنا"),
    (re.compile(r"\beval\s*\("), "eval( — تنفيذ نص مرفوض"),
    (re.compile(r"os\.system\s*\("), "os.system"),
    (re.compile(r"shell\s*=\s*True"), "shell=True"),
    (re.compile(r"print\(\s*(os\.environ|os\.getenv|[A-Za-z_]*(TOKEN|SECRET|API_KEY|KAGGLE_KEY|PASSWORD)\w*\s*[,)])", re.I), "طباعة قيمة سرّ"),
    (re.compile(r"print\(\s*f[\"'][^\"']*\{[^}]*(TOKEN|SECRET|API_KEY|KAGGLE_KEY|PASSWORD)", re.I), "طباعة قيمة سرّ داخل f-string"),
    (re.compile(r"(ghp_|github_pat_|KGAT_|xox[bp]-|AKIA)[A-Za-z0-9_\-]{12,}"), "ما يشبه مفتاحاً سرياً"),
]


def added_lines(diff: str) -> list[tuple[str, str]]:
    """[(path, added line)] from a unified diff."""
    out, path = [], ""
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++"):
            out.append((path, line[1:]))
    return out


SELF = "ai-system/supervision/sham_ci_check.py"   # defines the patterns, so it cannot be scanned by them (a change to it is flagged for the owner)


def scan_added(diff: str) -> list[str]:
    found = []
    for path, line in added_lines(diff):
        if path == SELF or not path.endswith((".py", ".ipynb", ".sh", ".yml", ".yaml", ".json")):
            continue
        for rx, why in BAD_ADDED:
            if rx.search(line):
                found.append(f"{path}: {why}: {line.strip()[:100]}")
    return found


def git(*a, cwd=ROOT) -> str:
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, check=True).stdout


def scrubbed_env() -> dict:
    return {k: v for k, v in os.environ.items()
            if not re.search(r"TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL", k, re.I) and not k.startswith(("ACTIONS_", "GITHUB_"))}


def run(base: str, selftest_timeout: int = 900) -> tuple[list[tuple[str, bool, str]], list[str]]:
    changed = [c for c in git("diff", "--name-only", f"{base}...HEAD").split() if (ROOT / c).exists()]
    results: list[tuple[str, bool, str]] = []
    notes: list[str] = []
    for path in changed:
        p = ROOT / path
        try:
            if path.endswith(".py"):
                py_compile.compile(str(p), doraise=True)
            elif path.endswith((".json", ".ipynb")):
                json.loads(p.read_text(encoding="utf-8"))
            else:
                continue
            results.append((f"صياغة {path}", True, ""))
        except Exception as exc:
            results.append((f"صياغة {path}", False, str(exc)[:300]))
    bad, warn = sham_contract.check(ROOT)
    results.append(("عقد المشروع (مدخلات/مخارج، كاتب واحد)", not bad, "; ".join(bad)[:700]))
    risky = scan_added(git("diff", f"{base}...HEAD", "--", "ai-system", ".github", "docs"))
    results.append(("لا تنفيذ نصوص/أسرار في الأسطر المضافة", not risky, "; ".join(risky)[:700]))
    for path in changed:
        rel = path[len(SHAM):] if path.startswith(SHAM) else ""
        if rel and "/" not in rel and rel.endswith(".py") and 'if __name__ == "__main__"' in (ROOT / path).read_text(encoding="utf-8"):
            try:
                r = subprocess.run([sys.executable, rel], cwd=ROOT / SHAM, capture_output=True, text=True, timeout=selftest_timeout, env=scrubbed_env())
                results.append((f"اختبار {rel} الذاتي", r.returncode == 0, "" if r.returncode == 0 else (r.stdout + r.stderr)[-500:]))
            except subprocess.TimeoutExpired:
                results.append((f"اختبار {rel} الذاتي", False, f"تجاوز {selftest_timeout} ثانية"))
    for path in changed:   # the supervision modules carry their own `--selftest`
        if path.startswith("ai-system/supervision/") and path.endswith(".py") and "/" not in path[len("ai-system/supervision/"):]:
            if "--selftest" in (ROOT / path).read_text(encoding="utf-8"):
                try:
                    r = subprocess.run([sys.executable, Path(path).name, "--selftest"], cwd=ROOT / "ai-system/supervision",
                                       capture_output=True, text=True, timeout=selftest_timeout, env=scrubbed_env())
                    results.append((f"اختبار {Path(path).name} الذاتي", r.returncode == 0, "" if r.returncode == 0 else (r.stdout + r.stderr)[-500:]))
                except subprocess.TimeoutExpired:
                    results.append((f"اختبار {Path(path).name} الذاتي", False, f"تجاوز {selftest_timeout} ثانية"))
    if any(c.endswith(".ipynb") and c.startswith(SHAM) for c in changed):
        table = SHAM + "sham_cell_updates.json"
        r = subprocess.run([sys.executable, "sham_cell_sync.py", "--build"], cwd=ROOT / SHAM, capture_output=True, text=True, env=scrubbed_env())
        dirty = bool(git("status", "--porcelain", "--", table).strip())
        results.append(("جدول مزامنة الخلايا محدَّث (وإلا لن تصل التعديلات للدفاتر المستوردة)", r.returncode == 0 and not dirty,
                        "شغّل: python ai-system/colab/sham_small/sham_cell_sync.py --build ثم أضف sham_cell_updates.json" if dirty else r.stderr[-200:]))
    wf = [c for c in changed if c.startswith(".github/")]
    if wf:
        notes.append("⚠ يغيّر ملفات سير عمل (" + ", ".join(wf) + "): لا يُدمج إلا بعد أن تراه المالكة بنفسها.")
    if SELF in changed:
        notes.append("⚠ يغيّر الفاحص الأمني نفسه (sham_ci_check.py): لا يُدمج إلا بعين المالكة — هو الذي يحرس بقية التعديلات.")
    if any(c.startswith("ai-system/supervision/CONTRACT") for c in changed):
        notes.append("⚠ يغيّر عقد المدخلات/المخارج: يحتاج موافقة المالكة الصريحة.")
    return results, notes + [f"تنبيه عقد: {w}" for w in warn]


def render(results, notes) -> str:
    ok = all(r[1] for r in results)
    L = [f"## {'✅ كل الفحوص نجحت' if ok else '❌ فحوص فشلت'}", ""]
    for name, good, detail in results:
        L.append(f"- {'✅' if good else '❌'} {name}" + (f" — {detail}" if detail and not good else ""))
    L += [""] + [f"- {n}" for n in notes]
    return "\n".join(L)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        d = ("+++ b/ai-system/colab/sham_small/x.py\n+ok = 1\n+bad = eval(input())\n+print(os.environ['KAGGLE_KEY'])\n"
             "+++ b/docs/a.md\n+eval(this is prose)\n+++ b/ai-system/colab/sham_small/y.py\n-removed = eval(1)\n+fine = 2\n")
        got = scan_added(d)
        assert len(got) == 2 and "eval(" in got[0] and "سرّ" in got[1], got
        assert scan_added("+++ b/a.py\n+token = 'ghp_" + "a" * 20 + "'\n")
        assert scan_added("+++ b/a.py\n+print(f\"key {my_TOKEN}\")\n") and scan_added("+++ b/a.py\n+print(GITHUB_TOKEN)\n")
        assert not scan_added("+++ b/a.py\n+print(\"ok\", post(os.environ.get(\"GITHUB_TOKEN\")))\n")
        assert added_lines("+++ b/a.py\n+x\n--- b\n+++ b/c.py\n+y\n") == [("a.py", "x"), ("c.py", "y")]
        assert render([("a", True, ""), ("b", False, "why")], ["note"]).startswith("## ❌")
        print("sham_ci_check self-test OK")
        sys.exit(0)
    base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "origin/claude/free-services-marketplace-h6rwk2"
    res, notes = run(base)
    text = render(res, notes)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        Path(summary).write_text(text, encoding="utf-8")
    sys.exit(0 if all(r[1] for r in res) else 1)
