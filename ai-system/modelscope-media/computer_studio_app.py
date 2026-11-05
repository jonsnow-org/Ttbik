"""Dedicated 16 GB CPU computer hub for all supported user+model sessions.

This Studio is computer-only: no LLM, image/audio/video weights or MiniCPM
runtime. Inference and media remain in the selected model's own Studios.
"""
from __future__ import annotations
import json, os, shutil, threading, time
from pathlib import Path

os.environ.setdefault("BOX_STORE", "/mnt/workspace/computer")
os.environ.setdefault("BROWSER_STORE", "/mnt/workspace/browser")
os.environ.setdefault("COMPUTER_MAX_GLOBAL_JOBS", "6")  # several users at once, each private; the free-memory gate protects the Studio
os.environ.setdefault("COMPUTER_MIN_AVAILABLE_MB", "2048")
os.environ.setdefault("COMPUTER_MEMORY_KILL_MB", "8192")
os.environ.setdefault("COMPUTER_QUOTA_GB", "8")
os.environ.setdefault("COMPUTER_MIN_FREE_DISK_MB", "1024")
os.environ.setdefault("DESKTOP_MIN_AVAILABLE_MB", "3072")
os.environ.setdefault("DESKTOP_WIDTH", "1344")
os.environ.setdefault("DESKTOP_HEIGHT", "840")

APP_REVISION = "computer-hub-16gb-2026-11-05-r9-apps"
LEGACY_MINICPM_CACHE_RELATIVE = "donor-bakeoff/minicpmo45-big/model_cache"
BOOTSTRAP = {"phase":"queued","toolchain":"not checked","desktop":"not checked","error":""}
_BOOTSTRAP_LOCK = threading.Lock()
_BROWSER_LOCK = threading.Lock()
_BROWSER_THREAD = None

def _remove_exact_cache(path: Path, expected_parent: Path) -> bool:
    """Delete only the named MiniCPM model_cache path; never follow a symlink target."""
    try:
        if path.parent.resolve() != expected_parent.resolve():
            return False
        if path.is_symlink():
            path.unlink(missing_ok=True)
            return True
        if path.is_dir():
            shutil.rmtree(path)
            return True
        if path.is_file():
            path.unlink()
            return True
    except OSError as exc:
        print("Legacy MiniCPM cache cleanup warning: " + type(exc).__name__, flush=True)
    return False

def remove_abandoned_minicpm_cache() -> dict:
    """Remove only the old minicpm-o45-big download cache; preserve computer/browser homes."""
    workspace = Path("/mnt/workspace")
    target = workspace / LEGACY_MINICPM_CACHE_RELATIVE
    parent = target.parent
    local_parent = Path(__file__).resolve().parent
    removed = []
    if parent.exists() and _remove_exact_cache(target, parent):
        removed.append(str(target))
    if _remove_exact_cache(local_parent / "model_cache", local_parent):
        removed.append(str(local_parent / "model_cache"))
    return {"removed":removed,"preserved":["/mnt/workspace/computer","/mnt/workspace/browser"]}

# No language model, candidate runner, transformers, llama.cpp or media pipeline.
import computer_box
import desktop_computer
import browser_computer

def _mem_total_mb():
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None

def _json_obj(raw):
    try:
        obj = json.loads(raw or "{}")
        return obj if isinstance(obj, dict) else {}
    except (TypeError, ValueError):
        return {}

def _bootstrap_core():
    with _BOOTSTRAP_LOCK:
        if BOOTSTRAP["phase"] in ("installing","ready"):
            return
        BOOTSTRAP["phase"] = "installing"
    try:
        BOOTSTRAP["toolchain"] = computer_box.ensure_toolchain()
        if BOOTSTRAP["toolchain"] != "ready":
            raise RuntimeError("Terminal prerequisites failed: " + str(BOOTSTRAP["toolchain"])[:500])
        desktop_computer._install_packages()
        BOOTSTRAP["desktop"] = "ready" if desktop_computer._package_status().get("ready") else "missing"
        if BOOTSTRAP["toolchain"] != "ready" or BOOTSTRAP["desktop"] != "ready":
            raise RuntimeError("computer toolchain or graphical desktop packages are incomplete")
        BOOTSTRAP["phase"] = "ready"
        BOOTSTRAP["error"] = ""
        threading.Thread(target=computer_box.ensure_computer_extras, daemon=True, name="computer-devtools-and-apps").start()      # restore base tools and only the optional app groups explicitly installed by a user
    except Exception as exc:  # noqa: BLE001
        BOOTSTRAP["phase"] = "failed"
        BOOTSTRAP["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
        print("Computer bootstrap failed: " + BOOTSTRAP["error"], flush=True)

def api_status():
    computer = computer_box.status()
    browser = _json_obj(browser_computer.api_browser_status())
    return json.dumps({
        "phase":"ready","app_revision":APP_REVISION,"role":"computer-only",
        "model_loaded":False,"model_downloads_enabled":False,"bootstrap":dict(BOOTSTRAP),
        "hardware":{
            "cpus":os.cpu_count(),
            "mem_available_gb":round(float(computer.get("capacity",{}).get("available_mb") or 0)/1024,2),
            "mem_total_gb":round(float(_mem_total_mb())/1024,2) if _mem_total_mb() else None
        },
        "computer":computer,"desktop":desktop_computer._package_status(),"devtools":computer_box.STATE.get("devtools","not started"),"browser":browser,
        "legacy_minicpm_cache_cleanup":LEGACY_CACHE_CLEANUP
    },ensure_ascii=False)

BROWSER_WITH_DESKTOP_MIN_MB=int(os.environ.get("BROWSER_WITH_DESKTOP_MIN_MB","2500"))
_VIEWERS={}            # session digest -> last time a live screen (Mini App) asked for this session: the model's browser pages are then captured for it

def _watched(session):
    return time.time()-_VIEWERS.get(computer_box.digest(session),0)<45

def api_browser_do(body):
    """The headless browser. It runs beside graphical desktops while memory allows (16 GB hub), and every action is recorded in the session's
    live activity feed; while someone watches this session's live screen, the page picture is captured for that screen too."""
    try:
        job=json.loads(computer_box.unwrap_body(body) or "{}")
        session=str(job.get("session") or "").strip(); action=str(job.get("action") or "")
    except Exception:
        job,session,action={}, "", ""
    if desktop_computer.any_active() or any(m.any_active() for m in SLOTS):
        free=computer_box._mem_available_mb()
        if free is not None and free<BROWSER_WITH_DESKTOP_MIN_MB:
            return json.dumps({"ok":False,"error":f"not enough free memory for the browser next to the running desktops ({free} MB free); try again shortly"})
    if not session or action in ("status",):
        return browser_computer.api_browser_do(body)
    entry=computer_box.note_activity(session,"browser",action,str(job.get("url") or job.get("selector") or "")[:240])
    asked=bool(job.get("screenshot")); capture=_watched(session) and not asked and action not in ("close","stop","text","content")
    send=body
    if capture:
        send="b64:"+__import__("base64").b64encode(json.dumps({**job,"screenshot":True},ensure_ascii=False).encode()).decode()
    raw=browser_computer.api_browser_do(send)
    reply=_json_obj(raw)
    shot=reply.get("screenshot_b64") if isinstance(reply,dict) else None
    computer_box.finish_activity(entry,{"ok":bool(reply.get("ok")) if isinstance(reply,dict) else False,"output":str(reply.get("title") or reply.get("url") or reply.get("error") or "")[:300] if isinstance(reply,dict) else ""})
    if shot and entry:
        with computer_box._LOCK:
            for e in computer_box._ACTIVITY.get(computer_box.digest(session),[]):
                e.pop("image_b64",None)
            entry["image_b64"]=shot
    if capture and isinstance(reply,dict):
        reply.pop("screenshot_b64",None)
        return json.dumps(reply,ensure_ascii=False)
    return raw

def api_browser_status():
    return browser_computer.api_browser_status()

def _run_browser_bootstrap():
    try:
        browser_computer.bootstrap()
    except Exception as exc:  # noqa: BLE001
        with browser_computer._LOCK:
            browser_computer.STATE["phase"]="failed"
            browser_computer.STATE["error"]=f"{type(exc).__name__}: {str(exc)[:280]}"

def api_browser_bootstrap():
    global _BROWSER_THREAD
    with _BROWSER_LOCK:
        state = _json_obj(browser_computer.api_browser_status())
        if state.get("phase") == "ready":
            return json.dumps({"ok":True,"phase":"ready","already_ready":True})
        if _BROWSER_THREAD is None or not _BROWSER_THREAD.is_alive():
            _BROWSER_THREAD=threading.Thread(target=_run_browser_bootstrap,daemon=True,name="computer-browser-bootstrap")
            _BROWSER_THREAD.start()
    return json.dumps({"ok":True,"phase":"installing"})

import importlib.util
DESKTOP_SLOTS=max(1,min(6,int(os.environ.get("DESKTOP_SLOTS") or ("5" if (_mem_total_mb() or 0)>12000 else "3"))))      # up to five independent desktop slots on this 16 GB hub, subject to the free-memory gate
computer_box.MAX_DESKTOPS=DESKTOP_SLOTS
_DISPATCH_LOCK=threading.Lock()

def _desktop_slot(i):
    if i==0: return desktop_computer
    spec=importlib.util.spec_from_file_location(f"desktop_computer_slot{i}",Path(desktop_computer.__file__))
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    mod.DISPLAY_BASE=91+30*i
    return mod

SLOTS=[_desktop_slot(i) for i in range(DESKTOP_SLOTS)]

def api_desktop_do(body):
    """Several users work on their own graphical desktops at the same time: each user+model session owns one slot (an independent copy of the desktop module with its own X displays)."""
    try:
        job=json.loads(computer_box.unwrap_body(body) or "{}")
        session=str(job.get("session") or "").strip(); action=str(job.get("action") or "").lower()
    except Exception:
        return desktop_computer.api_desktop_do(body)
    if not session: return desktop_computer.api_desktop_do(body)
    if action=="frame": _VIEWERS[computer_box.digest(session)]=time.time()
    with _DISPATCH_LOCK:
        own=[m for m in SLOTS if m.any_active() and m._same_session(session)]
        if own: return own[0].api_desktop_do(body)
        free=[m for m in SLOTS if not m.any_active()]
        if not free:
            if action=="start": return json.dumps({"ok":False,"phase":"busy","error":f"all {len(SLOTS)} desktop slots are in use; try again when another desktop is stopped"})
            return SLOTS[0].api_desktop_do(body)
        return free[0].api_desktop_do(body)

def _own_slot(session):
    own=[m for m in SLOTS if m.any_active() and m._same_session(session)]
    return own[0] if own else None

def api_live(body):
    """The live screen as a STREAM (one call, many frames): yields a JSON event whenever the desktop picture changed or the session's activity moved,
    for up to `seconds` (<= 25: the gateway ends long calls). Without a running desktop it still streams the activity (live terminal)."""
    try:
        job=json.loads(computer_box.unwrap_body(body) or "{}")
    except Exception:
        yield json.dumps({"ok":False,"error":"bad request"}); return
    session=str(job.get("session") or "").strip()
    if not session or len(session)>240:
        yield json.dumps({"ok":False,"error":"a valid session is required"}); return
    seconds=max(1.0,min(25.0,float(job.get("seconds") or 20)))
    interval=max(0.25,min(3.0,float(job.get("interval") or 0.5)))
    quality=int(job.get("quality") or 50); scale=float(job.get("scale") or 0.75)
    since=str(job.get("since") or "")[:40]; act=int(job.get("activity_since") or 0)
    t0=time.time(); sent=0; last_beat=0.0
    while time.time()-t0<seconds:
        _VIEWERS[computer_box.digest(session)]=time.time()
        ev={"ok":True,"t":round(time.time()-t0,2)}
        slot=_own_slot(session)
        if slot is not None and slot._PHASE=="running":
            try:
                with slot._LOCK:
                    shot=slot._screenshot(quality,scale,since)
                slot._touch()
                if not shot.get("unchanged"):
                    since=shot["hash"]; ev.update(shot)
                ev["phase"]="running"
            except Exception as exc:  # noqa: BLE001
                ev["frame_error"]=f"{type(exc).__name__}: {str(exc)[:120]}"
        else:
            ev["phase"]="stopped"
        a=computer_box.activity_since(session,act,12)
        if a.get("activity") or a.get("running_jobs"):
            ev["activity"]=a["activity"]; ev["running_jobs"]=a["running_jobs"]
        act=max(act,int(a.get("seq") or 0)); ev["activity_seq"]=act; ev["hash"]=since
        if "screenshot_b64" in ev or ev.get("activity") or ev.get("running_jobs") or time.time()-last_beat>5:
            last_beat=time.time(); sent+=1
            yield json.dumps(ev,ensure_ascii=False)
        time.sleep(interval)
    yield json.dumps({"ok":True,"end":True,"events":sent,"hash":since,"activity_seq":act})

def api_live_once(body):
    """The same as one stream event, as a plain call (for clients that cannot read the stream)."""
    last=None
    try:
        job=json.loads(computer_box.unwrap_body(body) or "{}")
        job["seconds"]=1
        for last in api_live("b64:"+__import__("base64").b64encode(json.dumps(job).encode()).decode()):
            break
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"ok":False,"error":str(exc)[:200]})
    return last or json.dumps({"ok":False,"error":"no frame"})

def main():
    global LEGACY_CACHE_CLEANUP
    LEGACY_CACHE_CLEANUP=remove_abandoned_minicpm_cache()
    print("Computer-only Studio "+APP_REVISION,flush=True)
    print("MiniCPM cache cleanup: "+json.dumps(LEGACY_CACHE_CLEANUP),flush=True)
    threading.Thread(target=_bootstrap_core,daemon=True,name="computer-core-bootstrap").start()
    import gradio as gr
    with gr.Blocks() as demo:
        gr.Markdown("Dedicated 16 GB Linux computer hub — full developer toolchain, isolated user+model workspaces, terminal, persistent files, Chromium and graphical desktop.")
        body=gr.Textbox(visible=False)
        out=gr.Textbox(visible=False)
        gr.Button("status",visible=False).click(api_status,None,out,api_name="status")
        gr.Button("box_do",visible=False).click(computer_box.api_box_do,body,out,api_name="box_do")
        gr.Button("box_status",visible=False).click(computer_box.api_box_status,body,out,api_name="box_status")
        gr.Button("desktop_do",visible=False).click(api_desktop_do,body,out,api_name="desktop_do")
        gr.Button("browser_do",visible=False).click(api_browser_do,body,out,api_name="browser_do")
        gr.Button("browser_status",visible=False).click(api_browser_status,None,out,api_name="browser_status")
        gr.Button("browser_bootstrap",visible=False).click(api_browser_bootstrap,None,out,api_name="browser_bootstrap")
        gr.Button("live",visible=False).click(api_live,body,out,api_name="live",concurrency_limit=12)
        gr.Button("live_once",visible=False).click(api_live_once,body,out,api_name="live_once",concurrency_limit=12)
    demo.queue(default_concurrency_limit=4).launch(server_name="0.0.0.0",server_port=int(os.environ.get("PORT","7860")),show_error=True)

LEGACY_CACHE_CLEANUP={"removed":[],"preserved":["/mnt/workspace/computer","/mnt/workspace/browser"]}
if __name__ == "__main__":
    main()
