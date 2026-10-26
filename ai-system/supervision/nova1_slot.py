"""
Sharing the owner's Kaggle account between Sham and Nova 1 (owner decision 2026-10-21, additive hook called by sham_restarter.py).

Weekly cycle, counted from Kaggle's GPU-quota reset (Saturday 00:00 UTC):
  1. Sham's GPU notebook (the SHAM_GPU_TRACKS notebook, all_in_one) gets ONE GPU session after the reset. When that session has ended, its later
     restarts in the same week run on the free CPU, through kaggle_auto_resume's existing CPU fallback (the same path it already takes when the
     quota is out). Its run is never stopped: the switch only applies to the next push, i.e. at the end of a session.
  2. Nova 1 (the private notebook jonsnowjonsnow/nova1-coder, source on branch training/nova1) uses the rest of the weekly GPU quota, one session at
     a time. Each push carries MAX_MINUTES = the GPU time that is left (capped below the 12 h session limit), and the notebook saves a checkpoint every
     50 steps and stops by itself at that limit, so it never runs the quota dry mid-step; the next session resumes from the checkpoints.
  3. Kaggle runs at most 5 sessions at once and Sham has 5 notebooks, so while Nova 1 runs, ONE Sham notebook is held: the primary notebook of the
     track in run_request.json "hold_track" (chat_image_in_one). It is never stopped. Nova 1 is pushed only once that notebook has finished its own
     run (COMPLETE/ERROR, never RUNNING/QUEUED); while Nova 1 runs it is simply not restarted, and it goes back to normal restarts in the first
     restarter run after Nova 1's session has ended.

Switch: training/nova1/kaggle/run_request.json on branch training/nova1 (read over HTTPS from the public repository). Missing, unreadable,
"enabled": false, or before "not_before" -> this hook changes nothing. Any error inside the hook -> sham_restarter carries on unchanged.
Logs name no Sham notebook. Offline self-test: python nova1_slot.py
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.request
from datetime import datetime
from pathlib import Path

NOVA = "jonsnowjonsnow/nova1-coder"
RAW = "https://raw.githubusercontent.com/jonsnow-org/Ttbik/training/nova1/training/nova1/kaggle/"
RUNNING = {"RUNNING", "QUEUED"}
WEEKLY_QUOTA_H = 30.0          # Kaggle's stated weekly GPU quota (sometimes more; 30 is the safe figure)
SESSION_H = 12.0               # Kaggle's GPU session limit: what a running Sham GPU session may still use
MARGIN_MIN = 30                # kept unused at the end of the week
QUOTA_RE = re.compile(r"(gpu|accelerator).*(quota|exceed|limit)|(quota|limit).*(gpu|accelerator)", re.IGNORECASE)


def _key(slug: str) -> str:    # same hashing as sham_restarter._key (state keys never hold a real name)
    return hashlib.sha1(slug.encode()).hexdigest()[:10]


def week_start(now: float) -> float:
    """Unix time of the last Saturday 00:00 UTC at or before `now` (Kaggle's GPU-quota reset)."""
    t = time.gmtime(now)
    midnight = now - (t.tm_hour * 3600 + t.tm_min * 60 + t.tm_sec)
    return midnight - ((t.tm_wday - 5) % 7) * 86400


def _fetch(name: str) -> bytes:
    with urllib.request.urlopen(RAW + name, timeout=20) as r:
        return r.read()


def _status(api, slug: str) -> str | None:
    try:
        s = api.kernels_status(slug).status
        return getattr(s, "name", str(s)).split(".")[-1].upper()
    except Exception:
        return None


def _run_seconds(api, slug: str, work: Path) -> float | None:
    try:
        from sham_kaggle_runs import last_run_seconds
        return last_run_seconds(api, slug, work / "nova1_runs")
    except Exception:
        return None


def _nova_done(api, work: Path) -> bool:
    """True when the last session's output says training has finished (nova1_status.json, a few bytes)."""
    d = work / "nova1_status"
    d.mkdir(parents=True, exist_ok=True)
    try:
        api.kernels_output(NOVA, str(d), file_pattern=r"nova1_status\.json$", force=True, quiet=True)
        return any(json.loads(f.read_text()).get("done") for f in d.rglob("nova1_status.json"))
    except Exception:
        return False


def _push_nova(api, work: Path, minutes: int, has_prev: bool, fetch) -> tuple[bool, str]:
    d = work / "nova1_push"
    d.mkdir(parents=True, exist_ok=True)
    meta = json.loads(fetch("kernel-metadata.json"))
    nb = fetch(meta["code_file"]).decode("utf-8")
    nb = re.sub(r"MAX_MINUTES = \d+", f"MAX_MINUTES = {int(minutes)}", nb, count=1)
    (d / meta["code_file"]).write_text(nb, encoding="utf-8")
    tries = [[NOVA], []] if has_prev else [[]]          # the previous session's output (checkpoints + mix) as this session's input
    err = ""
    for sources in tries:
        meta["kernel_sources"] = sources
        (d / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        try:
            resp = api.kernels_push(str(d))
            err = str(getattr(resp, "error", "") or "")
        except Exception as exc:
            err = f"{type(exc).__name__}: {exc}"
        if not err.strip():
            return True, ""
        if QUOTA_RE.search(err):
            break
    return False, err


def coordinate(api, watch: list[str], refs: dict, gpu_slugs: set, state: dict, live: bool, resume, work: Path,
               now: float | None = None, fetch=_fetch, runsec=_run_seconds, log=print, done_check=_nova_done):
    """Returns (watch, resume, notes). `gpu_slugs` is changed in place (a Sham GPU notebook past its weekly GPU session is taken out)."""
    now = now or time.time()
    notes: list[str] = []

    def say(line):
        log(line)
        notes.append(line)

    try:
        req = json.loads(fetch("run_request.json"))
    except Exception:
        req = None
    if not req or not req.get("enabled"):
        return watch, resume, notes
    nb = req.get("not_before")
    if nb and now < datetime.fromisoformat(nb.replace("Z", "+00:00")).timestamp():
        say(f"Nova 1: لا شيء قبل موعد البدء {nb}")
        return watch, resume, notes

    S = state.setdefault("nova1", {})
    accel = state.setdefault("accelerator", {})
    wk = week_start(now)
    if S.get("week") != wk:
        # a new quota week: Sham's GPU notebook may take its one GPU session at once (drop any CPU-fallback memory)
        for slug in gpu_slugs:
            accel.get(_key(slug), {}).pop("gpu_fallback_since", None)
        S.update(week=wk, sham={}, nova_used_s=0.0, quota_wait_until=0)
    sham = S.setdefault("sham", {})

    # 1. Sham's GPU notebook: one GPU session a week, then CPU
    for slug in list(gpu_slugs):
        e = sham.setdefault(_key(slug), {"gpu_sessions": 0, "used_s": 0.0})
        st = _status(api, slug)
        if e.get("gpu_since") and st is not None and st not in RUNNING:
            secs = runsec(api, slug, work) or min(now - e["gpu_since"], SESSION_H * 3600)
            e["used_s"] = float(e.get("used_s", 0)) + secs
            e["gpu_since"] = None
            say(f"Nova 1: جلسة GPU الأسبوعية لدفتر شام انتهت ({secs / 3600:.1f} س) — تشغيلاته التالية هذا الأسبوع على CPU")
        if e.get("gpu_sessions", 0) >= 1 and not e.get("gpu_since"):
            gpu_slugs.discard(slug)
            accel.setdefault(_key(slug), {})["gpu_fallback_since"] = now     # kaggle_auto_resume then pushes it on CPU
            e["forced_cpu"] = True

    def tracked_resume(slug, acc):
        res = resume(slug, acc)
        if slug in gpu_slugs and str(res).startswith("pushed") and not acc.get(_key(slug), {}).get("gpu_fallback_since"):
            e = sham.setdefault(_key(slug), {"gpu_sessions": 0, "used_s": 0.0})
            e["gpu_sessions"] = int(e.get("gpu_sessions", 0)) + 1
            e["gpu_since"] = now                                     # the coordinator's own clock (the self-test passes a fixed one)
        return res

    # 2. Nova 1
    N = S.setdefault("nova", {})
    held = refs.get(req.get("hold_track", "chat_image_in_one"))
    hold = [w for w in watch if w != held]
    ns = _status(api, NOVA)
    if ns in RUNNING:
        N["since"] = N.get("since") or now
        say("Nova 1: يعمل — دفتر شام المحجوز لا يُعاد تشغيله حتى ينتهي")
        return hold, tracked_resume, notes
    if N.get("since"):
        if ns is None:                                   # status unreadable right now: keep the hold, push nothing
            say("Nova 1: تعذّرت قراءة حالته — يبقى الحجز ولا دفع")
            return hold, tracked_resume, notes
        cap = (float(N.get("max_minutes", SESSION_H * 60)) + 20) * 60
        secs = runsec(api, NOVA, work) or min(now - N["since"], cap)
        S["nova_used_s"] = float(S.get("nova_used_s", 0)) + secs
        N["since"] = None
        N["fails"] = int(N.get("fails", 0)) + 1 if ns == "ERROR" else 0
        say(f"Nova 1: انتهت جلسته ({ns}، {secs / 3600:.1f} س) — دفتر شام المحجوز يعود إلى إعادة التشغيل العادية")
        if ns == "COMPLETE" and done_check(api, work):
            N["done"] = True
            say("Nova 1: اكتمل التدريب — لا جلسات أخرى")
    if req.get("done") or N.get("done"):
        return watch, tracked_resume, notes
    if int(N.get("fails", 0)) >= int(req.get("max_quick_fails", 2)):
        say("Nova 1: ⚠ فشل مرتين متتاليتين — لا دفع حتى يُصلح")
        return watch, tracked_resume, notes
    if not live or S.get("quota_wait_until", 0) > now:
        return watch, tracked_resume, notes
    sham_used = sum(float(e.get("used_s", 0)) for e in sham.values())
    sham_reserve = sum(max(0.0, SESSION_H * 3600 - (now - e["gpu_since"])) for e in sham.values() if e.get("gpu_since"))
    left_min = (float(req.get("weekly_quota_hours", WEEKLY_QUOTA_H)) * 3600 - sham_used - sham_reserve - float(S.get("nova_used_s", 0))) / 60 - MARGIN_MIN
    minutes = int(min(float(req.get("session_cap_minutes", 660)), left_min))
    if minutes < int(req.get("min_session_minutes", 60)):
        say(f"Nova 1: الباقي من حصة GPU هذا الأسبوع لا يكفي جلسة ({max(left_min, 0):.0f} د)")
        return watch, tracked_resume, notes
    if held is None:
        say("Nova 1: لم يُعرف دفتر شام الذي يُحجز — لا دفع")
        return watch, tracked_resume, notes
    hs = _status(api, held)
    if hs is None or hs in RUNNING:
        say("Nova 1: ينتظر انتهاء دفتر شام المحجوز من جلسته (لا يُوقف) — ثم يبدأ")
        return hold, tracked_resume, notes
    ok, err = _push_nova(api, work, minutes, ns is not None, fetch)
    if ok:
        N.update(since=now, max_minutes=minutes, pushes=int(N.get("pushes", 0)) + 1)
        say(f"Nova 1: بدأت جلسة GPU ({minutes} د كحد أقصى) — دفتر شام المحجوز ينتظر انتهاءها")
        return hold, tracked_resume, notes
    if QUOTA_RE.search(err):
        S["quota_wait_until"] = wk + 7 * 86400
        say("Nova 1: رفض كاكل GPU (الحصة نفدت) — المحاولة بعد إعادة الضبط القادمة")
    else:
        N["fails"] = int(N.get("fails", 0)) + 1
        say(f"Nova 1: فشل الدفع ({err[:120]})")
    return watch, tracked_resume, notes


def _self_test() -> None:
    import tempfile

    class St:
        def __init__(self, n): self.status = type("S", (), {"name": n})()

    class Api:
        def __init__(self, names): self.names, self.pushed = names, []
        def kernels_status(self, slug):
            if slug not in self.names:
                raise RuntimeError("404")
            return St(self.names[slug])
        def kernels_push(self, d):
            self.pushed.append(json.loads((Path(d) / "kernel-metadata.json").read_text())["kernel_sources"])
            self.names[NOVA] = "RUNNING"
            return type("R", (), {"error": None})()

    work = Path(tempfile.mkdtemp())
    files = {"run_request.json": json.dumps({"enabled": True, "not_before": "2026-10-24T00:15:00Z", "hold_track": "chat"}).encode(),
             "kernel-metadata.json": json.dumps({"code_file": "nb.ipynb", "kernel_sources": []}).encode(),
             "nb.ipynb": b'{"source": "MAX_MINUTES = 600   # x"}'}
    fetch = files.__getitem__
    quiet = lambda *_: None
    sat = datetime.fromisoformat("2026-10-24T01:00:00+00:00").timestamp()
    assert week_start(sat) == datetime.fromisoformat("2026-10-24T00:00:00+00:00").timestamp()
    assert week_start(sat - 2 * 3600) == datetime.fromisoformat("2026-10-17T00:00:00+00:00").timestamp()
    refs = {"all_in_one": "o/a", "chat": "o/c"}
    watch = ["o/a", "o/b", "o/c", "o/d", "o/e"]
    resume = lambda slug, acc: "pushed"
    none = lambda *a: None
    # before not_before: nothing at all
    api = Api({"o/a": "RUNNING", "o/c": "RUNNING"})
    w, r, _ = coordinate(api, watch, refs, {"o/a"}, {}, True, resume, work, now=sat - 86400, fetch=fetch, log=quiet)
    assert w == watch and r is resume and not api.pushed
    # the chat notebook is still running: held (never stopped), Nova waits
    st: dict = {"accelerator": {_key("o/a"): {"gpu_fallback_since": sat - 3600}}}
    gpu = {"o/a"}
    w, r, _ = coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat, fetch=fetch, runsec=none, log=quiet)
    assert "o/c" not in w and not api.pushed and gpu == {"o/a"}
    assert "gpu_fallback_since" not in st["accelerator"][_key("o/a")]          # new week: Sham's GPU notebook may use the GPU again
    r("o/a", {})                                                                 # the restarter pushes it on GPU: its one GPU session
    assert st["nova1"]["sham"][_key("o/a")]["gpu_sessions"] == 1
    # chat finished its run: Nova pushed (no own output yet); 30 h - 12 h reserve - 30 min -> capped at 660 min
    api.names["o/a"], api.names["o/c"] = "RUNNING", "COMPLETE"
    w, r, _ = coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat + 600, fetch=fetch, runsec=none, log=quiet)
    assert api.pushed == [[]] and "o/c" not in w and st["nova1"]["nova"]["max_minutes"] == 660
    w, r, _ = coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat + 3600, fetch=fetch, runsec=none, log=quiet)
    assert "o/c" not in w and len(api.pushed) == 1                                # Nova running: hold kept, no second push
    # Sham's GPU session ended (5 h): later pushes on CPU. Nova ended (11 h): next session with its own output as input
    api.names.update({"o/a": "COMPLETE", NOVA: "COMPLETE", "o/c": "COMPLETE"})
    runs = {"o/a": 5 * 3600, NOVA: 11 * 3600}
    rs = lambda a, s, w: runs[s]
    w, r, _ = coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat + 12 * 3600, fetch=fetch, runsec=rs, log=quiet)
    assert gpu == set() and st["accelerator"][_key("o/a")]["gpu_fallback_since"]
    assert api.pushed[-1] == [NOVA] and st["nova1"]["nova"]["max_minutes"] == 660
    api.names[NOVA] = "COMPLETE"
    coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat + 24 * 3600, fetch=fetch, runsec=rs, log=quiet)
    assert st["nova1"]["nova"]["max_minutes"] == int((30 - 5 - 22) * 60 - MARGIN_MIN)   # the rest of the week's quota
    api.names[NOVA] = "COMPLETE"
    runs[NOVA] = 2.5 * 3600
    w, r, notes = coordinate(api, watch, refs, gpu, st, True, resume, work, now=sat + 30 * 3600, fetch=fetch, runsec=rs, log=quiet)
    assert len(api.pushed) == 3 and w == watch and any("لا يكفي" in n for n in notes)      # quota used: no push, chat released
    # the notebook reports training finished: no more sessions
    st_done = json.loads(json.dumps(st))
    api.names[NOVA] = "RUNNING"
    coordinate(api, watch, refs, set(), st_done, True, resume, work, now=sat + 31 * 3600, fetch=fetch, runsec=rs, log=quiet)
    api.names[NOVA] = "COMPLETE"
    n_before = len(api.pushed)
    coordinate(api, watch, refs, set(), st_done, True, resume, work, now=sat + 32 * 3600, fetch=fetch, runsec=rs, log=quiet, done_check=lambda *a: True)
    assert st_done["nova1"]["nova"]["done"] and len(api.pushed) == n_before
    # next week: Sham's GPU notebook gets its GPU session again
    gpu2 = {"o/a"}
    coordinate(api, watch, refs, gpu2, st, True, resume, work, now=sat + 7 * 86400, fetch=fetch, runsec=none, log=quiet)
    assert gpu2 == {"o/a"} and "gpu_fallback_since" not in st["accelerator"][_key("o/a")]
    assert "o/a" not in json.dumps(st) and "o/c" not in json.dumps(st)            # no real name in the saved state
    # switch off or unreadable: nothing changes
    off = dict(files, **{"run_request.json": b'{"enabled": false}'})
    assert coordinate(api, watch, refs, {"o/a"}, {}, True, resume, work, fetch=off.__getitem__, log=quiet)[0] == watch
    def broken(name):
        raise OSError("offline")
    assert coordinate(api, watch, refs, {"o/a"}, {}, True, resume, work, fetch=broken, log=quiet)[0] == watch
    print("nova1_slot self-test OK")


if __name__ == "__main__":
    _self_test()
