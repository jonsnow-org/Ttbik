"""
Keeps the owner's long-running Kaggle notebooks in a continuous cycle (owner, 2026-10-13: "instead of working a few hours a day and stopping until tomorrow").

A notebook cannot restart itself after it ends (its session dies with it), so this watcher runs OUTSIDE Kaggle, on a free GitHub schedule, every 15 minutes:

  which notebooks: the PRIMARY notebook of each track named in the repository variable SHAM_RESTART_TRACKS (e.g. cpu_training_track,research_track,chat_stage,
  image_tokenizer,live_trainer), found on the owner's Kaggle account by the same content markers sham_registry already uses (no names needed from her);
  and/or explicit `owner/slug`s in the secret SHAM_RESTART_KERNELS. Without the file ai-system/supervision/RESTARTER_LIVE containing 1 (or SHAM_RESTART_LIVE=1) it only reports what it WOULD do (dry run).
  for each of them:
    running or queued                       -> nothing
    stopped for the first time it is seen   -> the grace period starts (GRACE_MINUTES; default 0 = pushed at once)
    stopped for longer than the grace       -> push a new version (kaggle_auto_resume.resume_kernel, GPU when the owner chose it and the quota
                                               allows, else CPU), at most MAX_PER_DAY times a day
    two quick failures in a row after a push-> STOP restarting this notebook and say so (circuit breaker): a push can detach a notebook's Secrets
                                               (a documented Kaggle limit, 2026-09-20), after which every run would die in its first cell

Public Actions logs show «دفتر 1»، «دفتر 2» only: never a real name. The state (times, counters, GPU-fallback memory; keys are hashes) lives in the owner's private
dataset sham-keeper-state. Offline self-test (no credentials): python sham_restarter.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

GRACE_MINUTES = int(os.environ.get("SHAM_RESTART_GRACE_MINUTES", "0"))  # 0: push on first sighting (GitHub cron runs only every 3-5h)
MAX_PER_DAY = 8
QUICK_FAIL_MINUTES = 90
BREAKER_AT = 2
STATE_DATASET = "sham-keeper-state"
STATE_FILE = "restarter_state.json"
RUNNING = {"RUNNING", "QUEUED"}


def _key(slug: str) -> str:
    return hashlib.sha1(slug.encode()).hexdigest()[:10]

FIX_EPOCH = "secrets-fallback-v2"


class HashedState(dict):
    """kaggle_auto_resume keeps its GPU-fallback memory under the real slug: keep the stored keys hashed instead."""

    def setdefault(self, slug, default=None):
        return super().setdefault(_key(slug), default)


def decide(status: str, entry: dict, now: float, grace_s: float = GRACE_MINUTES * 60) -> str:
    """'skip' | 'wait' | 'push' | 'blocked' — pure logic, tested below. Mutates `entry` (the notebook's own record)."""
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if entry.get("day") != day:
        entry["day"], entry["pushes_today"] = day, 0
    last_push = entry.get("last_push")
    if status in RUNNING:
        entry["idle_since"] = None
        if last_push and now - last_push > QUICK_FAIL_MINUTES * 60:
            entry["quick_fails"] = 0            # it stayed alive long enough: the last push did not break it
        return "skip"
    quick = bool(last_push) and now - last_push < QUICK_FAIL_MINUTES * 60 + 30 * 60 and status == "ERROR" and not entry.get("counted_fail")
    if quick:
        entry["quick_fails"] = int(entry.get("quick_fails", 0)) + 1
        entry["counted_fail"] = True
    if int(entry.get("quick_fails", 0)) >= BREAKER_AT:
        entry["blocked"] = True
    if entry.get("blocked"):
        return "blocked"
    if not entry.get("idle_since"):
        entry["idle_since"] = now
        if grace_s > 0:
            return "wait"
    if now - entry["idle_since"] < grace_s:
        return "wait"
    if int(entry.get("pushes_today", 0)) >= MAX_PER_DAY:
        return "wait"
    return "push"


def run(slugs: list[str], api, state: dict, resume, now: float | None = None, log=print, grace_s: float | None = None) -> list[str]:
    now = now or time.time()
    notes = []
    accel = HashedState(state.setdefault("accelerator", {}))
    state["accelerator"] = accel
    nbs = state.setdefault("notebooks", {})
    for i, slug in enumerate(slugs, 1):
        label = f"دفتر {i}"
        entry = nbs.setdefault(_key(slug), {})
        try:
            status = api.kernels_status(slug).status
            status = getattr(status, "name", str(status)).split(".")[-1].upper()
        except Exception as exc:
            log(f"{label}: تعذّرت قراءة حالته ({type(exc).__name__}) — لا إجراء")
            continue
        action = decide(status, entry, now, GRACE_MINUTES * 60 if grace_s is None else grace_s)
        if action == "push":
            try:
                result = resume(slug, accel)
            except Exception as exc:
                result = f"failed: {type(exc).__name__}"
            if result == "pushed" or str(result).startswith("pushed"):   # a dry run records nothing
                entry.update(last_push=now, idle_since=None, counted_fail=False, pushes_today=int(entry.get("pushes_today", 0)) + 1)
            line = f"{label}: كان {status} — " + ("كانت ستُدفع نسخة جديدة (وضع تجريبي)" if result == "dry-run" else f"دُفعت نسخة جديدة ({result})")
        elif action == "blocked":
            line = f"{label}: ⚠ توقّف المراقب عن دفعه (فشل مرتين بسرعة بعد الدفع — افتحي الدفتر وتأكدي أن الأسرار والمسرّع كما كانا)"
        elif action == "wait":
            line = f"{label}: {status} — مهلة قبل إعادة التشغيل"
        else:
            line = f"{label}: {status} — يعمل، لا إجراء"
        log(line)
        notes.append(line)
    return notes


def resolve_tracks(api, tracks: list[str], workdir: Path, log=print) -> dict[str, str]:
    """{track: real ref} of each track's primary notebook, found by sham_registry's content markers. Prints aliases only."""
    import sham_registry as reg
    rl = reg.RateLimitedApi(api, min_interval=4.0, retries=8)
    kernels, _ds = reg.discover(rl, workdir, with_logs=False)
    reg.assign_roles(kernels)
    out = {}
    for t in tracks:
        mine = [k for k in kernels if k.track == t]
        prim = [k for k in mine if k.role == "primary"]
        if not prim:
            log(f"{t}: لا دفتر أساسي على الحساب ({len(mine)} دفتر بهذا المسار) — يُتخطى")
            continue
        k = prim[0]
        out[t] = k.ref
        log(f"{t}: دفتر أساسي واحد من {len(mine)} (آخر تشغيل {(k.last_run or '')[:10]}، {'GPU' if k.gpu else 'CPU'}، الحالة {k.status})")
    return out


def main() -> int:
    slugs = [s.strip() for s in os.environ.get("SHAM_RESTART_KERNELS", "").split(",") if s.strip()]
    tracks = [s.strip() for s in os.environ.get("SHAM_RESTART_TRACKS", "").split(",") if s.strip()]
    flag = Path(__file__).with_name("RESTARTER_LIVE")       # a file in the repository (owner's decision recorded in git); SHAM_RESTART_LIVE=1 also works
    live = os.environ.get("SHAM_RESTART_LIVE") == "1" or (flag.exists() and flag.read_text(encoding="utf-8").strip() == "1")
    if not live and os.environ.get("GITHUB_EVENT_NAME") == "schedule":
        print("الوضع التجريبي: التشغيلات المجدولة لا تفعل شيئاً (المسح بطيء ويرهق حدود كاكل). شغّليه يدوياً لترَي ما سيراقبه، أو فعّلي الملف RESTARTER_LIVE.")
        return 0
    if not slugs and not tracks:
        print("لا مسارات في SHAM_RESTART_TRACKS ولا دفاتر في SHAM_RESTART_KERNELS — لا شيء يُراقَب.")
        return 0
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "colab" / "sham_small"))
    from kaggle_auto_resume import _load_kaggle_api, resume_kernel
    from sham_inputs import fetch_dataset, publish_dataset

    api = _load_kaggle_api()
    root = fetch_dataset(STATE_DATASET)
    files = sorted(root.rglob(STATE_FILE)) if root else []
    state = json.loads(files[0].read_text(encoding="utf-8")) if files else {}
    work = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "restarter"
    work.mkdir(parents=True, exist_ok=True)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    resolved = state.get("resolved", {})
    if tracks and (resolved.get("day") != today or set(resolved.get("refs", {})) != set(tracks)):
        resolved = {"day": today, "refs": resolve_tracks(api, tracks, work / "scan")}   # once a day: the scan reads every notebook (slow, rate-limited)
        state["resolved"] = resolved
    else:
        print(f"المسارات محلولة اليوم: {len(resolved.get('refs', {}))} دفتراً")
    watch = list(dict.fromkeys(list(resolved.get("refs", {}).values()) + slugs))
    print(f"عدد الدفاتر المراقَبة: {len(watch)} | الوضع: {'حي' if live else 'تجريبي (لا دفع)'}")

    def resume(slug, accel):
        if not live:
            return "dry-run"
        return resume_kernel(slug, None, work_dir=work / _key(slug), api=api, auto_accelerator=True, state=accel,
                             runtime_fixes=True)  # SHAM_SECRETS_FALLBACK (2026-10-15)

    # One-time breaker reset after a deliberate fix of the failure that tripped it (2026-10-15: the
    # first-cell HTTP 400 on Kaggle Secrets). Bump FIX_EPOCH only together with such a fix.
    if state.get("fix_epoch") != FIX_EPOCH:
        for _entry in state.setdefault("notebooks", {}).values():
            if isinstance(_entry, dict):
                _entry.update(blocked=False, quick_fails=0, counted_fail=False, idle_since=None)
        state["fix_epoch"] = FIX_EPOCH
        print(f"إعادة ضبط قاطع الحماية مرة واحدة بعد الإصلاح: {FIX_EPOCH}")
    notes = run(watch, api, state, resume)
    if live or not files:
        up = work / "upload"
        up.mkdir(exist_ok=True)
        (up / STATE_FILE).write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        for old in (root.rglob("accelerator_state.json") if root else []):
            (up / old.name).write_bytes(old.read_bytes())          # the keeper notebook's own file in the same dataset stays
        publish_dataset(up, STATE_DATASET, "restarter state")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        Path(summary).write_text("## مراقب إعادة التشغيل\n" + "\n".join(f"- {n}" for n in notes) + "\n", encoding="utf-8")
    return 0


def _self_test() -> None:
    class Status:
        def __init__(self, name): self.status = type("S", (), {"name": name})()

    class Api:
        def __init__(self, names): self.names = names
        def kernels_status(self, slug): return Status(self.names[slug])

    t0 = 1_800_000_000.0
    st: dict = {}
    pushed = []
    def resume(slug, accel):
        accel.setdefault(slug, {})["x"] = 1
        pushed.append(slug)
        return "pushed"
    api = Api({"a/b": "COMPLETE"})
    # first sight: a grace period, no push
    run(["a/b"], api, st, resume, now=t0, log=lambda *_: None, grace_s=15 * 60)
    assert not pushed
    run(["a/b"], api, st, resume, now=t0 + 10 * 60, log=lambda *_: None, grace_s=15 * 60)
    assert not pushed                                                  # still inside the grace
    run(["a/b"], api, st, resume, now=t0 + 40 * 60, log=lambda *_: None, grace_s=15 * 60)
    assert pushed == ["a/b"]                                           # grace over: pushed
    assert all("a/b" not in k for k in st["accelerator"]) and len(st["accelerator"]) == 1   # keys are hashed
    # running: nothing
    api.names["a/b"] = "RUNNING"
    run(["a/b"], api, st, resume, now=t0 + 50 * 60, log=lambda *_: None, grace_s=15 * 60)
    assert pushed == ["a/b"]
    # two quick failures after pushes -> blocked, no third push
    st2: dict = {}
    pushed.clear()
    api2 = Api({"c/d": "COMPLETE"})
    now = t0
    run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)
    now += 40 * 60
    run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)
    assert len(pushed) == 1
    api2.names["c/d"] = "ERROR"
    now += 20 * 60
    run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)      # first quick failure counted, grace starts
    now += 40 * 60
    run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)
    assert len(pushed) == 2
    now += 20 * 60
    notes = run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)   # second quick failure -> breaker
    now += 60 * 60
    notes += run(["c/d"], api2, st2, resume, now=now, log=lambda *_: None, grace_s=15 * 60)
    assert len(pushed) == 2 and any("توقّف المراقب" in n for n in notes), (pushed, notes)
    assert "c/d" not in json.dumps(st2)                                # no real name in the saved state
    # grace 0 (the default): a stopped notebook is pushed on its first sighting
    st3: dict = {}
    pushed.clear()
    run(["e/f"], Api({"e/f": "COMPLETE"}), st3, resume, now=t0, log=lambda *_: None, grace_s=0)
    assert pushed == ["e/f"]
    assert decide("RUNNING", {}, t0, 0) == "skip"
    print("sham_restarter self-test OK")


if __name__ == "__main__":
    if not (os.environ.get("SHAM_RESTART_KERNELS") or os.environ.get("SHAM_RESTART_TRACKS")) or "--selftest" in sys.argv:
        _self_test()
        sys.exit(0)
    sys.exit(main())
