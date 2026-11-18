"""studio_guard: keeps the training Studios on BOTH ModelScope sites awake and alive, from anywhere (owner's order 2026-11-18: training must never stop silently;
whatever stops must be found and restarted by itself).

The same file runs in four places, so no single sleeper or a dropped GitHub cron can stop the training:
  1. a background thread inside every trainer Studio (ai-system/modelscope-trainer/app.py): they watch each other and sham-runner-1,
  2. a background thread inside sham-runner-1 (ai-system/modelscope-runner/app.py): it watches every trainer,
  3. GitHub keep-trainer-studios-awake.yml (python studio_guard.py --once),
  4. the Cloudflare Worker cloudflare/studio-guard-worker.js (cron every 10 min) follows the same rules for the Studio states (it has no heartbeat check).
A sleeping Studio cannot wake itself and a plain HTTP request does not wake it: only ModelScope's deploy call (POST /openapi/v1/studios/<owner>/<name>/deploy) does,
from the code the Studio already holds. Building / starting Studios are never touched. Nova's Studios: only coder-inference-server-16 is listed, and only woken when Sleeping.

Tokens: MS_GUARD_TOKEN_CN / MS_GUARD_TOKEN_AI (Studio secrets) or T_CN / T_AI (GitHub). A Studio's own MODELSCOPE_API_TOKEN serves its own site. Nothing here prints a token.
Pure standard library. Offline self-test: python studio_guard.py --selftest
"""
from __future__ import annotations

import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HOSTS = {"cn": "www.modelscope.cn", "ai": "www.modelscope.ai"}
APP_DOMAIN = {"cn": "api-inference.modelscope.net", "ai": "api-inference.modelscope.ai"}

# policy: train  = woken when Sleeping / Stopped / Failed, and redeployed when Running but its app is dead or its training heartbeat is stale
#         runner = woken when Sleeping / Stopped / Failed, redeployed when Running but its app is dead (no training heartbeat)
#         warm   = only woken when Sleeping (what keep-awake did before; the donor test Studios and Nova 2)
STUDIOS = [
    ("cn", "novaai2026", "sham-trainer-1", "train"),
    ("cn", "novaai2026", "sham2-tldm", "train"),                     # 2026-11-18: Sham 2's T-LDM training on the cn account
    ("cn", "novaai2026", "sham-donor-qwen35-9b-test", "warm"),
    ("cn", "novaai2026", "sham-donor-gemma4-e4b-test", "warm"),
    ("cn", "novaai2026", "sham-donor-minicpmo45-test", "warm"),
    ("cn", "novaai2026", "sham-v2-server", "warm"),                  # chat Studios of keep-warm-chat-studios.yml: woken when Sleeping only
    ("cn", "novaai2026", "lfm25-inference-server", "warm"),
    ("ai", "Jonjithup", "sham-trainer-1", "train"),
    ("ai", "Jonjithup", "sham-trainer-2", "train"),
    ("ai", "Jonjithup", "sham-trainer-tools", "train"),
    ("ai", "Jonjithup", "sham-runner-1", "runner"),
    ("ai", "Jonjithup", "coder-inference-server-16", "warm"),     # Nova 2: keep-warm only, never redeployed for anything else
]
NEVER = ("nova-inference-server", "athar")                          # refused even if someone lists them

STALE_MIN = float(os.environ.get("SHAM_GUARD_STALE_MIN") or 180)    # a trainer whose cycle showed no progress this long (its own supervisor should have restarted it at 120) is redeployed
DEAD_CHECKS = int(os.environ.get("SHAM_GUARD_DEAD_CHECKS") or 3)    # a Running Studio whose app does not answer this many checks in a row is redeployed
COOLDOWN = {"wake": 15 * 60, "failed": 60 * 60, "redeploy": 60 * 60}


def norm(status) -> str:
    s = str(status or "").strip().lower()
    if s == "sleeping":
        return "sleeping"
    if "fail" in s or "error" in s:
        return "failed"
    if "stop" in s:
        return "stopped"
    if s == "running":
        return "running"
    return s or "unknown"


def decide(status: str, policy: str, dead: int = 0, hb: dict | None = None) -> tuple:
    """(action, why). action: '' | wake | redeploy. Pure: the same rules everywhere (tested below)."""
    st = norm(status)
    if st == "sleeping":
        return "wake", "Sleeping"
    if policy == "warm":
        return "", st
    if st in ("stopped", "failed"):
        return "wake", st
    if st != "running":
        return "", st                                               # building / starting / deploying / unknown: never touched
    if dead >= DEAD_CHECKS:
        return "redeploy", f"Running but the app did not answer {dead} checks in a row"
    if policy == "train" and isinstance(hb, dict):
        age = hb.get("progress_age_min")
        if isinstance(age, (int, float)) and age >= STALE_MIN and hb.get("phase") in ("training", "starting"):
            return "redeploy", f"training heartbeat stale: no progress for {age:.0f} min"
    return "", "running"


def token_for(site: str, env=None) -> str:
    env = os.environ if env is None else env
    t = env.get("MS_GUARD_TOKEN_" + site.upper()) or env.get("T_" + site.upper()) or ""
    if not t:
        own = "ai" if "modelscope.ai" in (env.get("MODELSCOPE_DOMAIN") or "") else "cn"
        if own == site:
            t = env.get("MODELSCOPE_API_TOKEN") or env.get("MODELSCOPE_TOKEN") or ""
    return t.strip()


def _call(url: str, tok: str, method: str = "GET", body: bytes | None = None, timeout: int = 40) -> tuple:
    headers = {"Authorization": "Bearer " + tok}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, headers=headers, method=method, data=body if body is not None else (b"" if method == "POST" else None))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(400_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except Exception as exc:  # noqa: BLE001
        return 0, type(exc).__name__


def studio_status(site, owner, name, tok, call=_call) -> str:
    code, body = call(f"https://{HOSTS[site]}/openapi/v1/studios/{owner}/{name}", tok)
    if code != 200:
        return f"HTTP {code}"
    try:
        d = json.loads(body).get("data") or {}
        return str((d.get("runtime") or {}).get("status") or d.get("status") or "")
    except (ValueError, AttributeError):
        return ""


def app_url(site, owner, name) -> str:
    return f"https://studio-{owner.lower()}-{name}.{APP_DOMAIN[site]}"


def app_alive(site, owner, name, tok, call=_call) -> bool:
    """False only when ModelScope's gateway answers but the app behind it does not (5xx). A connection error says more about the watcher's own network
    (a cn Studio may not reach the .ai domain) than about the target, so it never counts as dead."""
    code, _ = call(app_url(site, owner, name) + "/", tok, timeout=30)
    return not code or code < 500


def heartbeat(site, owner, name, tok, call=_call) -> dict | None:
    """The trainer's own heartbeat (Gradio api_name=heartbeat): {"phase", "progress_age_min", ...}; None when the endpoint is missing (older app) or unreadable."""
    base = app_url(site, owner, name) + "/gradio_api/call/heartbeat"
    code, body = call(base, tok, "POST", b'{"data": []}', timeout=30)
    if code != 200:
        return None
    try:
        ev = json.loads(body).get("event_id")
    except ValueError:
        return None
    if not ev:
        return None
    code, body = call(f"{base}/{ev}", tok, timeout=40)
    if code != 200:
        return None
    data = [ln[5:].strip() for ln in body.splitlines() if ln.startswith("data:")]
    for raw in reversed(data):
        try:
            v = json.loads(raw)
            v = v[0] if isinstance(v, list) and v else v
            return json.loads(v) if isinstance(v, str) else (v if isinstance(v, dict) else None)
        except (ValueError, TypeError):
            continue
    return None


def deploy(site, owner, name, tok, call=_call) -> int:
    if any(n in name.lower() for n in NEVER):
        return -1
    code, _ = call(f"https://{HOSTS[site]}/openapi/v1/studios/{owner}/{name}/deploy", tok, "POST")
    return code


def state_path() -> Path:
    p = os.environ.get("SHAM_GUARD_STATE")
    if p:
        return Path(p)
    disk = Path("/mnt/workspace")
    return (disk if disk.is_dir() and os.access(disk, os.W_OK) else Path.home()) / ".studio_guard.json"


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(path: Path, st: dict) -> None:
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(st), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def studios(env=None) -> list:
    env = os.environ if env is None else env
    raw = (env.get("SHAM_GUARD_STUDIOS") or "").strip()
    if raw:
        try:
            return [tuple(x) for x in json.loads(raw)]
        except ValueError:
            pass
    return list(STUDIOS)


def guard_once(env=None, call=_call, now=None, state=None, log=print) -> list:
    """One pass over every Studio except this one (SHAM_GUARD_SELF = site/owner/name). Returns [(key, status, action, why, http)]."""
    env = os.environ if env is None else env
    now = time.time() if now is None else now
    path = None
    if state is None:
        path = state_path()
        state = _load(path)
    me = (env.get("SHAM_GUARD_SELF") or "").strip().lower()
    out = []
    for site, owner, name, policy in studios(env):
        key = f"{site}/{owner}/{name}"
        if key.lower() == me or any(n in name.lower() for n in NEVER):
            continue
        tok = token_for(site, env)
        if not tok:
            out.append((key, "no token", "", "", 0))
            continue
        status = studio_status(site, owner, name, tok, call)
        rec = state.setdefault(key, {"dead": 0, "last": 0})
        hb = None
        if norm(status) == "running" and policy in ("train", "runner"):
            alive = app_alive(site, owner, name, tok, call)
            rec["dead"] = 0 if alive else int(rec.get("dead", 0)) + 1
            if alive and policy == "train":
                hb = heartbeat(site, owner, name, tok, call)
        else:
            rec["dead"] = 0
        action, why = decide(status, policy, rec["dead"], hb)
        http = 0
        if action:
            kind = "redeploy" if action == "redeploy" else ("failed" if norm(status) == "failed" else "wake")
            if now - float(rec.get("last", 0)) < COOLDOWN[kind]:
                why += " (cool-down: acted recently)"
                action = ""
            else:
                http = deploy(site, owner, name, tok, call)
                rec["last"] = now
                rec["dead"] = 0
        out.append((key, status, action, why, http))
        log(f"[studio-guard] {key}: {status or '?'} -> {action or 'left alone'} ({why}){' deploy HTTP ' + str(http) if action else ''}")
    if path is not None:
        _save(path, state)
    return out


def guard_forever(interval_s: float = 600, first_delay_s: float = 120, env=None) -> None:
    """The background loop (Studio apps). Jitter keeps the watchers from all acting in the same second; an error never stops the loop."""
    time.sleep(first_delay_s + random.uniform(0, 60))
    while True:
        try:
            guard_once(env)
        except Exception as exc:  # noqa: BLE001
            print(f"[studio-guard] pass failed: {type(exc).__name__}: {str(exc)[:160]}", flush=True)
        time.sleep(interval_s + random.uniform(-60, 60))


def start_thread(interval_s: float | None = None) -> threading.Thread | None:
    if (os.environ.get("SHAM_GUARD") or "1").strip().lower() in ("0", "off", "false", "no"):
        return None
    iv = interval_s or float(os.environ.get("SHAM_GUARD_INTERVAL_S") or 600)
    t = threading.Thread(target=guard_forever, kwargs={"interval_s": iv}, daemon=True, name="studio-guard")
    t.start()
    return t


def _selftest() -> int:
    assert decide("Sleeping", "warm") == ("wake", "Sleeping") and decide("Running", "warm")[0] == ""
    assert decide("Stopped", "warm")[0] == "" and decide("BuildFailed", "train")[0] == "wake" and decide("Stopped", "runner")[0] == "wake"
    assert decide("Building", "train", dead=9)[0] == "" and decide("Running", "train", dead=3)[0] == "redeploy" and decide("Running", "runner", dead=2)[0] == ""
    assert decide("Running", "train", hb={"phase": "training", "progress_age_min": 200})[0] == "redeploy"
    assert decide("Running", "train", hb={"phase": "between-cycles", "progress_age_min": 999})[0] == ""
    assert decide("Running", "runner", hb={"phase": "training", "progress_age_min": 999})[0] == ""
    env = {"MS_GUARD_TOKEN_CN": "c", "MODELSCOPE_API_TOKEN": "own", "MODELSCOPE_DOMAIN": "www.modelscope.ai"}
    assert token_for("cn", env) == "c" and token_for("ai", env) == "own" and token_for("ai", {"MODELSCOPE_API_TOKEN": "x"}) == ""
    statuses = {"cn/novaai2026/sham-trainer-1": "Sleeping", "ai/Jonjithup/sham-trainer-2": "Running", "ai/Jonjithup/sham-runner-1": "Running",
                "ai/Jonjithup/coder-inference-server-16": "Stopped", "ai/Jonjithup/sham-trainer-tools": "Building"}
    calls = []

    def fake(url, tok, method="GET", body=None, timeout=40):
        calls.append((method, url))
        assert tok in ("c", "a")
        if url.endswith("/deploy"):
            return 200, "{}"
        if "/openapi/v1/studios/" in url:
            key = url.split("://")[1].split("/openapi/v1/studios/")[1]
            site = "cn" if ".cn/" in url else "ai"
            return 200, json.dumps({"data": {"runtime": {"status": statuses.get(f"{site}/{key}", "Running")}}})
        if "sham-runner-1" in url:
            return 502, ""                                         # the runner's app is dead behind the gateway
        if "sham-trainer-tools" in url and "/openapi/" not in url:
            return 0, "URLError"                                   # unreachable from here: never counted as dead
        if url.endswith("/gradio_api/call/heartbeat"):
            return 200, json.dumps({"event_id": "e1"})
        if "/gradio_api/call/heartbeat/" in url:
            age = 400 if "sham-trainer-2" in url else 5
            return 200, "event: complete\ndata: " + json.dumps([json.dumps({"phase": "training", "progress_age_min": age})]) + "\n"
        return 200, "<html>"
    env = {"MS_GUARD_TOKEN_CN": "c", "MS_GUARD_TOKEN_AI": "a", "SHAM_GUARD_SELF": "ai/Jonjithup/sham-trainer-1"}
    st: dict = {}
    logs: list = []
    r = {k: (a, h) for k, _, a, _, h in guard_once(env, fake, now=1e6, state=st, log=logs.append)}
    assert "ai/Jonjithup/sham-trainer-1" not in r, r                   # never itself
    assert r["cn/novaai2026/sham-trainer-1"] == ("wake", 200) and r["ai/Jonjithup/sham-trainer-2"] == ("redeploy", 200), r
    assert r["ai/Jonjithup/coder-inference-server-16"] == ("", 0) and r["ai/Jonjithup/sham-trainer-tools"] == ("", 0), r
    assert r["ai/Jonjithup/sham-runner-1"] == ("", 0) and st["ai/Jonjithup/sham-runner-1"]["dead"] == 1
    for i in range(2):
        r = {k: (a, h) for k, _, a, _, h in guard_once(env, fake, now=1e6 + 60 * (i + 1), state=st, log=logs.append)}
    assert r["ai/Jonjithup/sham-runner-1"] == ("redeploy", 200), r          # third dead check in a row
    assert r["cn/novaai2026/sham-trainer-1"] == ("", 0), r                   # cool-down: woken a minute ago
    assert not any("tok" in ln.lower() and ("=c" in ln or "=a" in ln) for ln in logs)
    assert deploy("cn", "novaai2026", "nova-inference-server", "c", fake) == -1
    print("studio_guard self-test OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if "--loop" in sys.argv:
        guard_forever(first_delay_s=0)
    res = guard_once()
    acted = [r for r in res if r[2]]
    print(f"[studio-guard] {len(res)} Studios checked, {len(acted)} acted on")
