"""Dedicated 16 GB CPU computer hub for all supported user+model sessions.

This Studio is computer-only: no LLM, image/audio/video weights or MiniCPM
runtime. Inference and media remain in the selected model's own Studios.
"""
from __future__ import annotations
import json, os, shutil, threading
from pathlib import Path

os.environ.setdefault("BOX_STORE", "/mnt/workspace/computer")
os.environ.setdefault("BROWSER_STORE", "/mnt/workspace/browser")
os.environ.setdefault("COMPUTER_MAX_GLOBAL_JOBS", "1")  # 2 vCPU
os.environ.setdefault("COMPUTER_MIN_AVAILABLE_MB", "2048")
os.environ.setdefault("COMPUTER_MEMORY_KILL_MB", "8192")
os.environ.setdefault("COMPUTER_QUOTA_GB", "8")
os.environ.setdefault("DESKTOP_MIN_AVAILABLE_MB", "3072")
os.environ.setdefault("DESKTOP_WIDTH", "1280")
os.environ.setdefault("DESKTOP_HEIGHT", "800")

APP_REVISION = "computer-hub-16gb-2026-11-02-r2"
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
        "computer":computer,"desktop":desktop_computer._package_status(),"browser":browser,
        "legacy_minicpm_cache_cleanup":LEGACY_CACHE_CLEANUP
    },ensure_ascii=False)

def api_browser_do(body):
    if desktop_computer.any_active():
        return json.dumps({"ok":False,"error":"the graphical desktop is active; stop it before using the headless browser"})
    return browser_computer.api_browser_do(body)

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

def api_desktop_do(body):
    return desktop_computer.api_desktop_do(body)

def main():
    global LEGACY_CACHE_CLEANUP
    LEGACY_CACHE_CLEANUP=remove_abandoned_minicpm_cache()
    print("Computer-only Studio "+APP_REVISION,flush=True)
    print("MiniCPM cache cleanup: "+json.dumps(LEGACY_CACHE_CLEANUP),flush=True)
    threading.Thread(target=_bootstrap_core,daemon=True,name="computer-core-bootstrap").start()
    import gradio as gr
    with gr.Blocks() as demo:
        gr.Markdown("Dedicated 16 GB Linux computer — terminal, persistent files, background jobs, Chromium and graphical desktop.")
        body=gr.Textbox(visible=False)
        out=gr.Textbox(visible=False)
        gr.Button("status",visible=False).click(api_status,None,out,api_name="status")
        gr.Button("box_do",visible=False).click(computer_box.api_box_do,body,out,api_name="box_do")
        gr.Button("box_status",visible=False).click(computer_box.api_box_status,body,out,api_name="box_status")
        gr.Button("desktop_do",visible=False).click(api_desktop_do,body,out,api_name="desktop_do")
        gr.Button("browser_do",visible=False).click(api_browser_do,body,out,api_name="browser_do")
        gr.Button("browser_status",visible=False).click(api_browser_status,None,out,api_name="browser_status")
        gr.Button("browser_bootstrap",visible=False).click(api_browser_bootstrap,None,out,api_name="browser_bootstrap")
    demo.queue(default_concurrency_limit=4).launch(server_name="0.0.0.0",server_port=int(os.environ.get("PORT","7860")),show_error=True)

LEGACY_CACHE_CLEANUP={"removed":[],"preserved":["/mnt/workspace/computer","/mnt/workspace/browser"]}
if __name__ == "__main__":
    main()
