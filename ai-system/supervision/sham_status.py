"""
Sham's live status ("حالة المشروع الحيّة") — what a supervisor needs to know, in one file, refreshed by a workflow.

It reads, with the repository's own Kaggle token and GitHub token:
  • every notebook of the account and its last run (the existing sham_registry discovery: status, failure text, which stage
    it is) — names stay as aliases, as the owner decided for anything public;
  • every dataset of the account: size, last update, who is supposed to write it (CONTRACT.json) — and any `sham*`
    dataset that is NOT in the contract (a forgotten one);
  • the workflows of the free GitHub factory (collector, CPU trainer, merge/eval): last runs and their result;
  • the last reports of the sessions (the `sham-reports` mirror);
and turns them into ALERTS a supervisor can act on, e.g. a failed notebook, a main-line dataset that stopped being
updated, a workflow that failed twice, a dataset nobody writes.

Outputs: STATUS.md (Arabic, for people/assistants), status.json (for programs), plus sham-registry.json and
sham-report.txt (the older files the control-center notebook wrote to the same branch).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "ai-system" / "scripts"))
sys.path.insert(0, str(ROOT / "ai-system" / "colab" / "sham_small"))
sys.path.insert(0, str(HERE))

REPO = os.environ.get("GITHUB_REPOSITORY", "jonsnow-org/Ttbik")
FACTORY = {"Sham Collector (free CPU runner)": 6, "Sham CPU Trainer (free CPU runner, slow and continuous)": 6,
           "Sham Merge + Repair + Eval (free CPU runner)": 8}   # workflow name → expected hours between runs
MAIN_LINE = ["sham-checkpoint", "sham-multimodal-checkpoint", "sham-chat-checkpoint"]
STALE_HOURS = 24 * 5


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse(ts: str) -> dt.datetime | None:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(ts[:len("2026-01-01 00:00:00")] if "%f" not in fmt else ts, fmt).replace(tzinfo=dt.timezone.utc)
        except Exception:
            continue
    return None


def kaggle_datasets(run=subprocess.run) -> list[dict]:
    """The account's datasets via the kaggle CLI (name, size, last update)."""
    rows: list[dict] = []
    for page in range(1, 8):
        r = run(["kaggle", "datasets", "list", "-m", "--csv", "-p", str(page)], capture_output=True, text=True)
        got = list(csv.DictReader(io.StringIO(r.stdout or "")))
        if not got:
            break
        for g in got:
            ref = g.get("ref", "")
            rows.append({"name": ref.split("/", 1)[-1], "size": g.get("size", ""), "updated": g.get("lastUpdated", ""),
                         "downloads": g.get("downloadCount", "")})
    return rows


AUDIO_EXT = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".opus")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
VIDEO_EXT = (".mp4", ".webm", ".mkv", ".avi", ".mov")
TEXT_EXT = (".txt", ".jsonl", ".csv", ".json", ".parquet", ".md", ".tsv")


def classify_files(names: list[str]) -> dict[str, int]:
    """How many files of each kind a dataset holds, by extension: audio / image / video / text / model / other."""
    out: dict[str, int] = {}
    for n in names:
        low = n.lower()
        if low.endswith(AUDIO_EXT):
            k = "audio"
        elif low.endswith(IMAGE_EXT):
            k = "image"
        elif low.endswith(VIDEO_EXT):
            k = "video"
        elif low.endswith((".pt", ".pth", ".ckpt", ".safetensors")):
            k = "model"
        elif low.endswith(TEXT_EXT):
            k = "text"
        else:
            k = "other"
        out[k] = out.get(k, 0) + 1
    return out


_UNKNOWN_WORDS = ("429", "too many", "rate", "timed out", "timeout", "connection", "unauthor", "403", "500", "502", "503")


def dataset_status(ref: str, run=subprocess.run, sleep=time.sleep) -> str:
    """Kaggle's own word for the latest version: ready / pending / error ... ('' if unknown: a rate limit or a network error is NOT a status)."""
    for attempt in range(3):
        r = run(["kaggle", "datasets", "status", ref], capture_output=True, text=True)
        out = ((r.stdout or "") + (r.stderr if r.returncode else "")).strip()
        word = out.splitlines()[0].strip().lower() if out else ""
        if not any(w in word for w in _UNKNOWN_WORDS):
            return word
        sleep(20 * (attempt + 1) if "429" in word or "too many" in word else 2)
    return ""


def dataset_files(ref: str, run=subprocess.run, limit: int = 200) -> list[dict]:
    r = run(["kaggle", "datasets", "files", ref, "--csv", "--page-size", str(limit)], capture_output=True, text=True)
    return [{"name": g.get("name", ""), "size": g.get("size", "")} for g in csv.DictReader(io.StringIO(r.stdout or "")) if g.get("name")]


def diagnose_datasets(datasets: list[dict], contract: dict, user: str, run=subprocess.run) -> dict:
    """Why a dataset might not be usable (not ready / no files) and what the undocumented ones hold (by file kind)."""
    import fnmatch
    out: dict = {}
    known = set(contract["datasets"])
    for d in datasets:
        n = d["name"]
        if not n.startswith(("sham", "nova")):
            continue
        in_contract = n in known or any(fnmatch.fnmatch(n, p) for p in contract.get("dynamic_dataset_patterns", []))
        zero = d.get("size", "") in ("", "0", "0B", "0 B")
        if n in MAIN_LINE or zero or not in_contract:
            try:
                time.sleep(float(os.environ.get("SHAM_STATUS_PAUSE", "1.5")))   # Kaggle answers 429 to bursts of calls
                files = dataset_files(f"{user}/{n}", run)
                out[n] = {"status": dataset_status(f"{user}/{n}", run) if (n in MAIN_LINE or zero) else "",
                          "files": len(files), "kinds": classify_files([f["name"] for f in files]),
                          "sample": [f["name"] for f in files[:4]], "documented": in_contract}
            except Exception as exc:
                out[n] = {"error": f"{type(exc).__name__}: {str(exc)[:100]}", "documented": in_contract}
    return out


def github_runs(get_json) -> dict[str, list[dict]]:
    j = get_json(f"https://api.github.com/repos/{REPO}/actions/runs?per_page=100") or {}
    out: dict[str, list[dict]] = {}
    for r in j.get("workflow_runs", []):
        if r.get("name") in FACTORY or str(r.get("name", "")).startswith(("Sham ", "Grok")):
            start, end = _parse(r.get("run_started_at") or ""), _parse(r.get("updated_at") or "")
            out.setdefault(r["name"], []).append({
                "id": r.get("id"), "url": r.get("html_url", ""),
                "status": r.get("status"), "conclusion": r.get("conclusion"), "started": (r.get("run_started_at") or "")[:16],
                "minutes": round((end - start).total_seconds() / 60) if start and end and r.get("status") == "completed" else None,
                "event": r.get("event")})
    return {k: v[:4] for k, v in out.items()}


def recent_failures(runs: dict[str, list[dict]], get_json, limit: int = 3) -> list[dict]:
    """The latest failed runs across the factory, each with the job/step that failed (so a supervisor sees WHERE, not just that)."""
    failed = [dict(r, workflow=name) for name, rs in runs.items() for r in rs if r.get("conclusion") == "failure"]
    failed.sort(key=lambda r: r.get("started", ""), reverse=True)
    out = []
    for r in failed[:limit]:
        steps: list[str] = []
        try:
            jobs = (get_json(f"https://api.github.com/repos/{REPO}/actions/runs/{r['id']}/jobs") or {}).get("jobs", [])
            for j in jobs:
                for st in j.get("steps", []):
                    if st.get("conclusion") == "failure":
                        steps.append(f"{j.get('name')} ← {st.get('name')}")
        except Exception:
            pass
        out.append({"workflow": r["workflow"], "started": r["started"], "url": r.get("url", ""), "failed_steps": steps[:4]})
    return out


def post_alerts(alerts: list[str], token: str | None, request=None, repo: str = REPO) -> str:
    """One open issue labelled `sham-alert` mirrors the CURRENT alerts (a supervisor with no push channel finds it by that
    stable title/label): created when alerts appear, edited when they change, closed when they are gone. Our own text only."""
    import hashlib
    if not token:
        return "لا توكن — لم يُنشر تنبيه"
    if request is None:
        import requests
        request = requests.request
    hdr = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    api = f"https://api.github.com/repos/{repo}"
    real = [a for a in alerts if not a.startswith("ℹ")]
    r = request("GET", f"{api}/issues", headers=hdr, params={"labels": "sham-alert", "state": "open", "per_page": 5}, timeout=60)
    open_issues = [i for i in (r.json() if r.status_code == 200 else []) if "pull_request" not in i]
    marker = hashlib.sha1("\n".join(real).encode()).hexdigest()[:12]
    if not real:
        for i in open_issues:
            request("POST", f"{api}/issues/{i['number']}/comments", headers=hdr, timeout=60, json={"body": "✅ لا تنبيهات الآن — أُغلق تلقائياً."})
            request("PATCH", f"{api}/issues/{i['number']}", headers=hdr, timeout=60, json={"state": "closed", "state_reason": "completed"})
        return f"أُغلق {len(open_issues)} تنبيه" if open_issues else "لا تنبيهات"
    body = ("تنبيهات حالة شام (تتحدث تلقائياً كل 3 ساعات من `sham-status`):\n\n" + "\n".join(f"- {a}" for a in real)
            + "\n\nالمشرف: @jonsnowx1r-lab — الحالة الكاملة: https://raw.githubusercontent.com/jonsnow-org/Ttbik/sham-status/STATUS.md"
            + f"\n\n<!-- alerts:{marker} -->")
    title = f"sham-alert: {len(real)} تنبيه"
    if open_issues:
        cur = open_issues[0]
        if f"alerts:{marker}" in (cur.get("body") or ""):
            return "التنبيهات لم تتغير"
        request("PATCH", f"{api}/issues/{cur['number']}", headers=hdr, timeout=60, json={"title": title, "body": body})
        return f"حُدِّث التنبيه #{cur['number']}"
    request("POST", f"{api}/labels", headers=hdr, timeout=60, json={"name": "sham-alert", "color": "d93f0b", "description": "تنبيه حالة نموذج شام"})
    c = request("POST", f"{api}/issues", headers=hdr, timeout=60, json={"title": title, "body": body, "labels": ["sham-alert"]})
    return f"أُنشئ تنبيه #{c.json().get('number')}" if c.status_code in (200, 201) else f"فشل إنشاء التنبيه ({c.status_code})"


def last_reports(fetch, n: int = 10) -> list[dict]:
    root = fetch("sham-reports")
    if not root:
        return []
    for p in Path(root).rglob("reports.jsonl"):
        rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
        return rows[-n:][::-1]
    return []


def build_alerts(data: dict, contract: dict, now: dt.datetime | None = None) -> list[str]:
    now = now or _now()
    alerts: list[str] = []
    for k in data.get("kernels", []):
        if k["status"] == "error" and k["role"] == "primary":
            alerts.append(f"❌ دفتر أساسي فشل: {k['alias']} ({k['track']}) — {k['failure'][:160]}".replace("\n", " "))
    for name, runs in data.get("workflows", {}).items():
        done = [r for r in runs if r["status"] == "completed"]
        if len(done) >= 2 and all(r["conclusion"] == "failure" for r in done[:2]):
            alerts.append(f"❌ سير العمل «{name}» فشل في آخر تشغيلين")
        if name in FACTORY and runs:
            t = _parse(runs[0]["started"].replace("T", " ") + ":00")
            if t and (now - t).total_seconds() / 3600 > FACTORY[name] * 3:
                alerts.append(f"⚠ سير العمل «{name}» لم يعمل منذ أكثر من {FACTORY[name] * 3} ساعة (الجدولة متوقفة؟)")
    for name in FACTORY:
        if name not in data.get("workflows", {}):
            alerts.append(f"⚠ لا تشغيلات مسجلة لسير العمل «{name}» (لم يبدأ بعد؟)")
    by_name = {d["name"]: d for d in data.get("datasets", [])}
    for ds in MAIN_LINE:
        d = by_name.get(ds)
        if not d:
            alerts.append(f"⚠ مجموعة الخط الرئيسي {ds} غير موجودة في الحساب")
            continue
        t = _parse(d["updated"])
        if t and (now - t).total_seconds() / 3600 > STALE_HOURS:
            alerts.append(f"⚠ {ds} لم تُحدَّث منذ {int((now - t).total_seconds() / 86400)} أيام")
    for name, dg in (data.get("dataset_diag") or {}).items():
        if dg.get("error"):
            continue
        if name in MAIN_LINE or dg.get("status"):
            if dg.get("status") and dg["status"] not in ("ready", "complete"):
                alerts.append(f"⚠ {name}: حالة Kaggle «{dg['status']}» (النشر لم يكتمل أو فشل؟)")
            if dg.get("files", 1) == 0:
                alerts.append(f"❌ {name}: آخر نسخة بلا أي ملف (النشر فارغ) — الجلسة القادمة ستبدأ من نقطة أقدم أو من الصفر")
    # a sham* dataset without a contract entry is NOT an alert: it is classified by its file kinds and merged per modality
    if not data.get("reports"):
        alerts.append("ℹ لا تقارير بعد في sham-reports (تظهر بعد أول جلسة تعمل بالكود الجديد)")
    return alerts


def collect(api=None, get_json=None, fetch=None, run=subprocess.run, contract: dict | None = None) -> dict:
    import sham_registry as reg
    contract = contract or json.loads((HERE / "CONTRACT.json").read_text(encoding="utf-8"))
    data: dict = {"generated_at": _now().strftime("%Y-%m-%d %H:%M UTC"), "errors": []}
    try:
        if api is None:
            from kaggle.api.kaggle_api_extended import KaggleApi
            api = KaggleApi()
            api.authenticate()
        kernels, datasets_info = reg.discover(api, Path(tempfile.mkdtemp()))
        registry = reg.build_registry(kernels, datasets_info)
        reg.assign_aliases(registry)
        data["registry_private"] = registry   # never written to the public output
        # a failed primary notebook with an EMPTY failure text (typical of a scheduled run that could not even start, e.g. the GPU
        # quota is spent) gets Kaggle's raw status line, so a supervisor can tell "could not start" from "crashed"
        for k in registry["kernels"]:
            if k["status"] == "error" and k["role"] == "primary" and not (k.get("failure") or "").strip():
                try:
                    r = run(["kaggle", "kernels", "status", k["ref"]], capture_output=True, text=True)
                    raw = ((r.stdout or "") + (r.stderr or "")).strip().replace(k["ref"], "<notebook>")
                    k["failure"] = ("(بلا رسالة فشل من Kaggle) الحالة الخام: " + raw[:240]) if raw else ""
                except Exception:
                    pass
        pub = reg.public_registry(registry)
        data.update(kernels=pub["kernels"], pipeline=pub["pipeline"], other_notebooks=pub["other_notebooks_count"],
                    engineer_notebooks=pub["engineer_notebooks_count"], public_registry=pub,
                    public_report=reg.render_public_report(pub))
    except Exception as exc:
        data["errors"].append(f"سجل الدفاتر: {type(exc).__name__}: {str(exc)[:160]}")
        data.setdefault("kernels", [])
    try:
        data["datasets"] = kaggle_datasets(run)
    except Exception as exc:
        data["errors"].append(f"قائمة المجموعات: {type(exc).__name__}: {str(exc)[:160]}")
        data["datasets"] = []
    try:
        data["dataset_diag"] = diagnose_datasets(data["datasets"], contract, os.environ.get("KAGGLE_USERNAME", "jonsnowjonsnow"), run)
    except Exception as exc:
        data["errors"].append(f"تشخيص المجموعات: {type(exc).__name__}: {str(exc)[:160]}")
        data["dataset_diag"] = {}
    try:
        if get_json is None:
            import requests
            hdr = {"Accept": "application/vnd.github+json"}
            if os.environ.get("GITHUB_TOKEN"):
                hdr["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
            get_json = lambda url: requests.get(url, headers=hdr, timeout=60).json()
        data["workflows"] = github_runs(get_json)
        data["failures"] = recent_failures(data["workflows"], get_json)
    except Exception as exc:
        data["errors"].append(f"تشغيلات GitHub: {type(exc).__name__}: {str(exc)[:160]}")
        data["workflows"] = {}
    try:
        if fetch is None:
            from sham_inputs import fetch_dataset
            fetch = fetch_dataset
        data["reports"] = last_reports(fetch)
    except Exception as exc:
        data["errors"].append(f"التقارير: {type(exc).__name__}: {str(exc)[:160]}")
        data["reports"] = []
    data["alerts"] = build_alerts(data, contract)
    return data


def render_md(data: dict, contract: dict) -> str:
    L = [f"# حالة مشروع شام — {data['generated_at']}", "",
         "> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.", ""]
    L += ["## التنبيهات (ابدأ منها)"]
    L += [f"- {a}" for a in data["alerts"]] or ["- لا تنبيهات ✅"]
    if data.get("errors"):
        L += ["", "## أخطاء جمع الحالة نفسها (قد تعني أن الصورة ناقصة)"] + [f"- {e}" for e in data["errors"]]
    pipe = data.get("pipeline")
    if pipe:
        L += ["", "## المراحل"]
        for key, st in pipe["stages"].items():
            mark = "✅" if st["ready"] else ("⏳" if st["kernel_status"] in ("running", "queued") else "⬜")
            L.append(f"- {mark} {st['name']} — دفتر: {st['kernel_status'] or 'لا دفتر'}" + (f" — تقدم: {st['progress']}" if st.get("progress") else ""))
        L += ["", f"**الخطوة التالية المقترحة:** {pipe['next_step']['why']} — {pipe['next_step']['do']}"]
    L += ["", "## الدفاتر على Kaggle (بأسماء مستعارة)"]
    for k in data.get("kernels", []):
        L.append(f"- {k['status']} | {k['alias']} | الدور: {k['role']} | آخر تشغيل {k['last_run']}" + (f" | GPU" if k["gpu"] else "")
                 + (f" | الخطأ: {k['failure'][:200]}".replace("\n", " ") if k["status"] == "error" and k["failure"] else ""))
    L += [f"- (+{data.get('other_notebooks', 0)} دفتراً غير تابع لشام، +{data.get('engineer_notebooks', 0)} من دفاتر المهندس — مخفية)"]
    L += ["", "## مصنع GitHub المجاني (آخر التشغيلات)"]
    for name, runs in data.get("workflows", {}).items():
        L.append(f"- {name}: " + " ، ".join(f"{r['started'] or '—'} {r['conclusion'] or r['status']}" + (f" ({r['minutes']}د)" if r["minutes"] else "") for r in runs))
    if not data.get("workflows"):
        L.append("- لا بيانات")
    L += ["", "## آخر أخطاء مصنع GitHub (أين فشل بالضبط)"]
    for f in data.get("failures", []):
        L.append(f"- {f['started']} «{f['workflow']}» — الخطوة: " + (" | ".join(f["failed_steps"]) or "غير معروفة") + f" — {f['url']}")
    if not data.get("failures"):
        L.append("- لا أخطاء حديثة ✅")
    L += ["", "## المجموعات (ما كُتب أم لا، ومن يكتبها)", "| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |", "|---|---|---|---|---|"]
    by = {d["name"]: d for d in data.get("datasets", [])}
    for name, meta in contract["datasets"].items():
        d = by.get(name)
        L.append(f"| {name} | {d['size'] if d else '—'} | {d['updated'][:10] if d else 'غير موجودة'} | {meta['writer'] or '—'} | {meta['role']} |")
    import fnmatch
    extra = [d for n, d in by.items() if n.startswith(("sham", "nova")) and n not in contract["datasets"]]
    for d in extra:
        # same rule as sham_contract.known(): dynamic patterns (sham-crawl-*) are known collectors
        covered = any(fnmatch.fnmatch(d["name"], pat) for pat in contract.get("dynamic_dataset_patterns", []))
        writer = "زاحف مكتشف تلقائياً" if covered else "يُصنَّف تلقائياً"
        role = "(نمط ديناميكي في العقد)" if covered else "(تُدمج بحسب نوع ملفاتها)"
        L.append(f"| {d['name']} | {d['size']} | {d['updated'][:10]} | {writer} | {role} |")
    diag = data.get("dataset_diag") or {}
    bad = {n: g for n, g in diag.items() if g.get("documented") and (g.get("files") == 0 or (g.get("status") and g["status"] not in ("ready", "complete")))}
    if bad:
        L += ["", "## مجموعات غير جاهزة أو فارغة"] + [f"- {n}: الحالة «{g.get('status') or '—'}»، الملفات {g.get('files', '؟')}" for n, g in bad.items()]
    undoc = {n: g for n, g in diag.items() if not g.get("documented") and not g.get("error")}
    if undoc:
        L += ["", "## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)"]
        for n, g in undoc.items():
            kinds = "، ".join(f"{k} {v}" for k, v in sorted(g["kinds"].items(), key=lambda kv: -kv[1])) or "فارغة"
            L.append(f"- {n}: {g['files']} ملف ({kinds}) — مثال: " + " | ".join(g["sample"][:3]))
    L += ["", "## آخر تقارير الجلسات (الأحدث أولاً)"]
    for r in data.get("reports", [])[:6]:
        L += [f"### {r['time']} — {r['source'][:80]}", "```", r["text"][:1800], "```"]
    if not data.get("reports"):
        L.append("لا تقارير بعد.")
    return "\n".join(L) + "\n"


def write_outputs(data: dict, out: Path, contract: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "STATUS.md").write_text(render_md(data, contract), encoding="utf-8")
    pub = {k: v for k, v in data.items() if k not in ("registry_private", "public_registry", "public_report")}
    (out / "status.json").write_text(json.dumps(pub, ensure_ascii=False, indent=1), encoding="utf-8")
    if data.get("public_registry"):
        (out / "sham-registry.json").write_text(json.dumps(data["public_registry"], ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "sham-report.txt").write_text(data["public_report"], encoding="utf-8")
    (out / "vercel.json").write_text(json.dumps({"git": {"deploymentEnabled": False}}), encoding="utf-8")


def main():
    contract = json.loads((HERE / "CONTRACT.json").read_text(encoding="utf-8"))
    data = collect(contract=contract)
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sham_status_out")
    write_outputs(data, out, contract)
    print((out / "STATUS.md").read_text(encoding="utf-8")[:3000])
    if os.environ.get("SHAM_POST_ALERTS") == "1":
        try:
            print("🔔", post_alerts(data["alerts"], os.environ.get("GITHUB_TOKEN")))
        except Exception as exc:
            print(f"🔔 تعذّر نشر التنبيه: {type(exc).__name__}: {str(exc)[:120]}")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        contract = json.loads((HERE / "CONTRACT.json").read_text(encoding="utf-8"))
        runs = {"workflow_runs": [
            {"name": "Sham Collector (free CPU runner)", "status": "completed", "conclusion": "success",
             "run_started_at": "2026-10-04T10:00:00Z", "updated_at": "2026-10-04T15:20:00Z", "event": "schedule"},
            {"name": "Sham Merge + Repair + Eval (free CPU runner)", "status": "completed", "conclusion": "failure",
             "run_started_at": "2026-10-04T08:00:00Z", "updated_at": "2026-10-04T08:20:00Z", "event": "schedule"},
            {"name": "Sham Merge + Repair + Eval (free CPU runner)", "status": "completed", "conclusion": "failure",
             "run_started_at": "2026-10-03T22:00:00Z", "updated_at": "2026-10-03T22:10:00Z", "event": "schedule"},
            {"name": "CI", "status": "completed", "conclusion": "success", "run_started_at": "2026-10-04T10:00:00Z", "updated_at": "2026-10-04T10:05:00Z"}]}

        class FakeRun:
            stdout = ("ref,title,size,lastUpdated,downloadCount,voteCount,usabilityRating\n"
                      "me/sham-checkpoint,x,3GB,2026-10-04 12:00:00,1,0,0\n"
                      "me/sham-chat-checkpoint,x,580MB,2026-09-20 12:00:00,1,0,0\n"
                      "me/sham-mystery-data,x,10MB,2026-10-01 12:00:00,1,0,0\n"
                      "me/other-stuff,x,1MB,2026-10-01 12:00:00,1,0,0\n")
        calls = {"n": 0}

        class R2:
            def __init__(self, out, code=0): self.stdout, self.stderr, self.returncode = out, "", code

        def fake_run(cmd, **kw):
            calls["n"] += 1
            if cmd[:3] == ["kaggle", "datasets", "status"]:
                return R2("pending" if cmd[3].endswith("sham-checkpoint") else "ready")
            if cmd[:3] == ["kaggle", "datasets", "files"]:
                if cmd[3].endswith("sham-checkpoint"):
                    return R2("name,size,creationDate\n")
                if cmd[3].endswith("sham-mystery-data"):
                    return R2("name,size,creationDate\na/b.wav,1,x\na/c.wav,1,x\nlabels.csv,1,x\n")
                return R2("name,size,creationDate\nfinal_chat.pt,1,x\n")
            if cmd[:3] == ["kaggle", "datasets", "list"]:
                return FakeRun() if "-p" in cmd and cmd[cmd.index("-p") + 1] == "1" else R2("")
            return R2("")

        class NS(dict):
            __getattr__ = dict.get
        import sham_registry as reg
        tdr = Path(tempfile.mkdtemp())

        class FakeApi:
            def kernels_list(self, **kw):
                return [NS(ref="me/nb1", title="شام — أول دورة تدريب نصية حقيقية", last_run_time="2026-10-04")] if kw.get("page", 1) == 1 else []
            def kernels_pull(self, ref, path, metadata=True, quiet=True):
                Path(path, "nb.ipynb").write_text(json.dumps({"cells": [{"source": ["# شام — أول دورة تدريب نصية حقيقية\n'sham-checkpoint' sham_small_tokenizer.json"]}]}), encoding="utf-8")
                Path(path, "kernel-metadata.json").write_text(json.dumps({"enable_gpu": True, "dataset_sources": []}), encoding="utf-8")
            def kernels_status(self, ref):
                return NS(status="complete", failure_message="")
            def kernels_output(self, *a, **k):
                raise RuntimeError("no log")
            def dataset_list(self, mine=True):
                return []
            def dataset_list_files(self, ref, page_size=200):
                return NS(files=[])
            def dataset_download_file(self, *a, **k):
                pass
        data = collect(api=FakeApi(), get_json=lambda url: runs, fetch=lambda n: None, run=fake_run, contract=contract)
        alerts = "\n".join(data["alerts"])
        assert "فشل في آخر تشغيلين" in alerts and "sham-multimodal-checkpoint غير موجودة" in alerts, alerts
        assert "other-stuff" not in alerts and "Sham Collector" not in alerts.split("لم يعمل")[0], alerts
        out = Path(tempfile.mkdtemp())
        write_outputs(data, out, contract)
        md = (out / "STATUS.md").read_text(encoding="utf-8")
        assert "التنبيهات" in md and "| sham-checkpoint |" in md and "mystery" in md and "me/" not in md and "nb1" not in md
        assert "registry_private" not in (out / "status.json").read_text(encoding="utf-8")
        assert (out / "sham-registry.json").exists()
        assert "آخر أخطاء مصنع GitHub" in md
        # a main-line dataset that is pending / empty is flagged, and an undocumented one is described by its file kinds
        assert "حالة Kaggle «pending»" in alerts and "بلا أي ملف" in alerts, alerts
        assert "مجموعات غير جاهزة أو فارغة" in md and "audio 2" in md and "text 1" in md, md
        assert classify_files(["a.wav", "b.PNG", "c.mp4", "d.pt", "e.txt", "f.bin"]) == {"audio": 1, "image": 1, "video": 1, "model": 1, "text": 1, "other": 1}
        md_dyn = render_md({
            "generated_at": "t", "alerts": [], "kernels": [], "workflows": {}, "failures": [], "reports": [],
            "datasets": [
                {"name": "sham-crawl-xlive", "size": "1MB", "updated": "2026-10-04 12:00:00"},
                {"name": "sham-crawl-agent", "size": "1MB", "updated": "2026-10-04 12:00:00"},
                {"name": "sham-crawl-agent-corpus", "size": "2MB", "updated": "2026-10-04 12:00:00"},
                {"name": "sham-mystery-data", "size": "1MB", "updated": "2026-10-01 12:00:00"},
            ],
        }, contract)
        assert md_dyn.count("زاحف مكتشف تلقائياً") == 3, md_dyn
        assert "❓" not in md_dyn and md_dyn.count("يُصنَّف تلقائياً") == 1
        # the failing run is reported with the step that failed
        jobs = {"jobs": [{"name": "merge", "steps": [{"name": "setup", "conclusion": "success"}, {"name": "Repair, merge", "conclusion": "failure"}]}]}
        runs2 = github_runs(lambda url: dict(runs, workflow_runs=[dict(r, id=7 + i, html_url=f"https://x/{i}") for i, r in enumerate(runs["workflow_runs"])]))
        fails = recent_failures(runs2, lambda url: jobs)
        assert fails and fails[0]["failed_steps"] == ["merge ← Repair, merge"] and fails[0]["url"].startswith("https://x/"), fails
        # alert issue: create → unchanged → update → close, against a fake GitHub
        class R:
            def __init__(self, code, js): self.status_code, self._j = code, js
            def json(self): return self._j
        store = {"issues": [], "log": []}
        def fake_request(method, url, **kw):
            store["log"].append((method, url.split("/repos/")[1]))
            if method == "GET": return R(200, [i for i in store["issues"] if i["state"] == "open"])
            if method == "POST" and url.endswith("/issues"):
                store["issues"].append({"number": 5, "state": "open", **{k: kw["json"][k] for k in ("title", "body")}}); return R(201, {"number": 5})
            if method == "PATCH":
                store["issues"][0].update({k: v for k, v in kw["json"].items() if k in ("title", "body", "state")}); return R(200, {})
            return R(201, {})
        A = ["❌ سير العمل فشل", "ℹ لا تقارير"]
        assert "أُنشئ" in post_alerts(A, "t", fake_request, "o/r") and len(store["issues"]) == 1 and "ℹ" not in store["issues"][0]["body"]
        assert post_alerts(A, "t", fake_request, "o/r") == "التنبيهات لم تتغير"
        assert "حُدِّث" in post_alerts(A + ["⚠ جديد"], "t", fake_request, "o/r")
        assert "أُغلق" in post_alerts(["ℹ فقط"], "t", fake_request, "o/r") and store["issues"][0]["state"] == "closed"
        assert post_alerts(A, None, fake_request, "o/r").startswith("لا توكن")
        print(md[:600])
        print("sham_status self-test OK")
    else:
        main()