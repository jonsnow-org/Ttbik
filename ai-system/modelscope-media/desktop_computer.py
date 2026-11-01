"""A lightweight, real Linux desktop exposed through the existing Gradio API.

This is deliberately not VNC and does not need Docker, a public port, or a paid
desktop provider. One model's own ModelScope Studio starts one Xvfb + Openbox
session, then returns bounded JPEG frames and accepts bounded mouse/keyboard
events through Gradio. The home directory and Unix UID are the same as the
model's persistent computer_box session.

The display is intentionally low-rate (frame polling, not 60-fps streaming).
For low-latency streaming, Selkies remains a possible Oracle-hosted upgrade.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

import computer_box as box

MIN_AVAILABLE_MB = max(3072, int(os.environ.get("DESKTOP_MIN_AVAILABLE_MB", "3072")))
IDLE_SECONDS = max(120, int(os.environ.get("DESKTOP_IDLE_SECONDS", "900")))
WIDTH = max(800, min(1600, int(os.environ.get("DESKTOP_WIDTH", "1280"))))
HEIGHT = max(600, min(1000, int(os.environ.get("DESKTOP_HEIGHT", "800"))))
MAX_TYPE = 1200
MAX_FRAME_BYTES = 450_000
PACKAGES = ("xvfb", "xauth", "openbox", "xterm", "xdotool", "pcmanfm")

_LOCK = threading.RLock()
_INSTALL_LOCK = threading.Lock()
_PHASE = "stopped"
_ERROR = ""
_SESSION_HASH = ""
_SESSION_RAW = ""
_DISPLAY = ""
_AUTH_FILE = ""
_LAST_USED = 0.0
_PROCESSES: list[subprocess.Popen] = []
_ENV: dict[str, str] = {}
_UID: int | None = None
_INSTALL_THREAD: threading.Thread | None = None
_CANCEL_INSTALL = False


def session_hash(session: str) -> str:
    return hashlib.sha256(str(session).encode("utf-8")).hexdigest()[:24]


def any_active() -> bool:
    """True while a desktop is installing, starting, or occupying this Studio."""
    with _LOCK:
        return _PHASE in ("installing", "starting", "running")


def valid_key(value: str) -> bool:
    """Only xdotool key names and combinations; never a shell expression."""
    return bool(re.fullmatch(r"[A-Za-z0-9_+-]{1,40}", str(value or "")))


def clamp_point(x: object, y: object) -> tuple[int, int]:
    try:
        xx, yy = int(x), int(y)
    except (TypeError, ValueError):
        raise ValueError("mouse coordinates must be numbers")
    return max(0, min(WIDTH - 1, xx)), max(0, min(HEIGHT - 1, yy))


def _available_mb() -> int | None:
    return box._mem_available_mb()


def _package_status() -> dict:
    required = ("Xvfb", "xauth", "openbox", "xterm", "xdotool")
    return {
        "ready": all(shutil.which(name) for name in required),
        "missing": [name for name in required if not shutil.which(name)],
        "files": bool(shutil.which("pcmanfm")),
    }


def _install_packages() -> None:
    missing = [name for name in PACKAGES if not shutil.which(name)]
    if not missing:
        return
    if not box.is_root() or not shutil.which("apt-get"):
        raise RuntimeError("This Studio image has no X11 desktop packages and cannot install them without root.")
    # ModelScope Studio's existing package mirror is used by the computer_box
    # runtime; apt runs only after an owner explicitly starts the desktop.
    update = subprocess.run(
        ["apt-get", "update"],
        capture_output=True,
        text=True,
        timeout=120,
        env=box.clean_env("desktop-bootstrap"),
    )
    if update.returncode != 0:
        raise RuntimeError("Desktop package index update failed: " + (update.stderr or update.stdout)[-240:])
    packages = ["xvfb", "xauth", "openbox", "xterm", "xdotool", "pcmanfm"]
    result = subprocess.run(
        ["apt-get", "install", "-y", "--no-install-recommends", *packages],
        capture_output=True,
        text=True,
        timeout=180,
        env=box.clean_env("desktop-bootstrap"),
    )
    if result.returncode != 0:
        raise RuntimeError("Desktop packages could not be installed: " + (result.stderr or result.stdout)[-300:])
    still_missing = [name for name in ("Xvfb", "xauth", "openbox", "xterm", "xdotool") if not shutil.which(name)]
    if still_missing:
        raise RuntimeError("Desktop packages remain unavailable: " + ", ".join(still_missing))


def _display_number() -> int:
    # Single display per Studio; choose a free high display number and avoid
    # the platform's own X sockets.
    for number in range(91, 190):
        if not Path(f"/tmp/.X11-unix/X{number}").exists() and not Path(f"/tmp/.X{number}-lock").exists():
            return number
    raise RuntimeError("No free X display number is available in this Studio.")


def _write_xauthority(session: str, number: int) -> tuple[Path, str]:
    home = box.ensure_home(session)
    runtime = home / ".desktop"
    runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
    uid = box.session_uid(session)
    if box.is_root():
        os.chown(runtime, uid, uid)
        os.chmod(runtime, 0o700)
    auth = runtime / "Xauthority"
    cookie = secrets.token_hex(16)
    result = subprocess.run(
        ["xauth", "-f", str(auth), "add", f":{number}", "MIT-MAGIC-COOKIE-1", cookie],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError("Could not create a private X11 authentication cookie.")
    if box.is_root():
        os.chown(auth, uid, uid)
    os.chmod(auth, 0o600)
    return auth, str(runtime)


def _child_env(session: str, display: str, auth: Path) -> dict[str, str]:
    home = box.session_home(session)
    env = box.clean_env(session)
    env.update({
        "DISPLAY": display,
        "XAUTHORITY": str(auth),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
        "XDG_RUNTIME_DIR": str(home / ".tmp" / "runtime"),
        "DESKTOP_SESSION_ID": session_hash(session),
    })
    Path(env["XDG_RUNTIME_DIR"]).mkdir(parents=True, exist_ok=True)
    if box.is_root():
        uid = box.session_uid(session)
        for key in ("XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR"):
            path = Path(env[key])
            path.mkdir(parents=True, exist_ok=True)
            os.chown(path, uid, uid)
        os.chmod(Path(env["XDG_RUNTIME_DIR"]), 0o700)
    return env


def _spawn(command: list[str], env: dict[str, str], label: str, timeout_cpu: int = 7200) -> subprocess.Popen:
    log_dir = Path(env["HOME"]) / ".desktop"
    log_dir.mkdir(parents=True, exist_ok=True)
    log = (log_dir / (re.sub(r"[^a-z0-9_-]", "-", label.lower())[:24] + ".log")).open("ab")
    try:
        proc = subprocess.Popen(
            command,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            close_fds=True,
            preexec_fn=box._child_setup(int(env.get("DESKTOP_UID", "0")), box.is_root(), timeout_cpu),
        )
    finally:
        log.close()
    box.watch(proc.pid, "graphical desktop: " + label)
    return proc


def _wait_for_x(display_number: int, proc: subprocess.Popen, seconds: float = 12.0) -> None:
    socket_path = Path(f"/tmp/.X11-unix/X{display_number}")
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("Xvfb exited before the desktop display became ready.")
        if socket_path.exists():
            return
        time.sleep(0.2)
    raise RuntimeError("Xvfb did not create its display socket in time.")


def _kill_processes(processes: list[subprocess.Popen]) -> None:
    for proc in reversed(processes):
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            continue
    deadline = time.monotonic() + 2.0
    for proc in processes:
        try:
            proc.wait(timeout=max(0.1, deadline - time.monotonic()))
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass


def _same_session(session: str) -> bool:
    return bool(_SESSION_HASH) and _SESSION_HASH == session_hash(session)


def _reserve(session: str) -> None:
    global _SESSION_HASH, _SESSION_RAW
    with _LOCK:
        if _PHASE in ("installing", "starting", "running") and not _same_session(session):
            raise RuntimeError("This model's Studio already has a desktop session for another user. Stop it or wait for it to expire.")
        if _same_session(session) and _PHASE in ("installing", "starting", "running"):
            return
        result = box.reserve_desktop(session, min_available_mb=MIN_AVAILABLE_MB)
        if not result.get("ok"):
            raise RuntimeError(str(result.get("error") or "This Studio does not have enough free capacity for a graphical desktop."))
        _SESSION_HASH = session_hash(session)
        _SESSION_RAW = session


def _release_reservation(session: str) -> None:
    try:
        box.release_desktop(session)
    except Exception:
        pass


def _spawn_desktop(session: str) -> None:
    global _PHASE, _ERROR, _DISPLAY, _AUTH_FILE, _PROCESSES, _ENV, _UID, _LAST_USED, _SESSION_HASH, _SESSION_RAW
    processes: list[subprocess.Popen] = []
    auth: Path | None = None

    def cancelled() -> bool:
        with _LOCK:
            return _CANCEL_INSTALL or not _same_session(session)

    def cleanup_cancelled() -> None:
        _kill_processes(processes)
        if auth is not None:
            auth.unlink(missing_ok=True)
        _release_reservation(session)

    try:
        _install_packages()
        if cancelled():
            cleanup_cancelled()
            return

        number = _display_number()
        display = f":{number}"
        auth, _runtime = _write_xauthority(session, number)
        uid = box.session_uid(session)
        env = _child_env(session, display, auth)
        env["DESKTOP_UID"] = str(uid)

        # Never launch a network-capable desktop unless the Studio could apply
        # the UID-scoped private-network / metadata firewall rules.
        egress = box.install_egress_rules()
        if egress.startswith("not available") or egress.startswith("partly blocked"):
            raise RuntimeError("The Studio could not confirm its private-network egress firewall: " + egress)

        xvfb = _spawn(
            ["Xvfb", display, "-screen", "0", f"{WIDTH}x{HEIGHT}x24", "-nolisten", "tcp", "-auth", str(auth), "-noreset"],
            env,
            "xvfb",
        )
        processes.append(xvfb)
        _wait_for_x(number, xvfb)
        if cancelled():
            cleanup_cancelled()
            return

        wm = _spawn(["openbox", "--sm-disable"], env, "openbox")
        processes.append(wm)
        time.sleep(0.5)
        if cancelled():
            cleanup_cancelled()
            return

        terminal = _spawn(
            ["xterm", "-fa", "Monospace", "-fs", "12", "-geometry", "104x30+12+12", "-title", "Model Computer"],
            env,
            "terminal",
        )
        processes.append(terminal)
        if shutil.which("pcmanfm"):
            files = _spawn(["pcmanfm", "--no-desktop", "--new-window", str(box.session_home(session))], env, "files")
            processes.append(files)

        # A stop may arrive while packages or X11 are starting. Publish the
        # process handles only if the caller still owns this exact session.
        with _LOCK:
            if _CANCEL_INSTALL or not _same_session(session):
                was_cancelled = True
            else:
                was_cancelled = False
                _PROCESSES = processes
                _DISPLAY = display
                _AUTH_FILE = str(auth)
                _ENV = env
                _UID = uid
                _PHASE = "running"
                _ERROR = ""
                _LAST_USED = time.time()
        if was_cancelled:
            cleanup_cancelled()
            return

    except Exception as exc:
        cleanup_cancelled()
        with _LOCK:
            # Do not turn an intentional Stop into a failed startup.
            if _same_session(session) and not _CANCEL_INSTALL:
                _PROCESSES = []
                _DISPLAY = ""
                _AUTH_FILE = ""
                _ENV = {}
                _UID = None
                _PHASE = "failed"
                _ERROR = f"{type(exc).__name__}: {str(exc)[:280]}"
                _SESSION_HASH = ""
                _SESSION_RAW = ""


def _start_async(session: str) -> None:
    global _PHASE, _ERROR, _INSTALL_THREAD, _CANCEL_INSTALL
    with _LOCK:
        if _PHASE in ("installing", "starting", "running") and _same_session(session):
            return
        if _INSTALL_THREAD is not None and _INSTALL_THREAD.is_alive():
            raise RuntimeError("The previous desktop startup is still shutting down; retry after its cancellation completes.")
        _reserve(session)
        _CANCEL_INSTALL = False
        _PHASE = "installing"
        _ERROR = ""
        _INSTALL_THREAD = threading.Thread(target=_spawn_desktop, args=(session,), daemon=True, name="model-desktop-start")
        _INSTALL_THREAD.start()


def _desktop_status(session: str) -> dict:
    available = _available_mb()
    pkgs = _package_status()
    own = _same_session(session)
    if _PHASE in ("installing", "starting", "running") and not own:
        return {
            "ok": True,
            "phase": "busy",
            "error": "This Studio currently has a desktop session assigned to another user.",
            "can_start": False,
            "available_mb": available,
        }
    can_start = (
        available is not None
        and available >= MIN_AVAILABLE_MB
        and _PHASE in ("stopped", "failed")
    )
    return {
        "ok": True,
        "phase": _PHASE,
        "error": _ERROR,
        "display": _DISPLAY if own else "",
        "available_mb": available,
        "minimum_available_mb": MIN_AVAILABLE_MB,
        "can_start": can_start,
        "packages": pkgs,
        "width": WIDTH,
        "height": HEIGHT,
        "idle_seconds": max(0, int(time.time() - _LAST_USED)) if own and _LAST_USED else 0,
    }


def _check_live(session: str) -> None:
    if not _same_session(session) or _PHASE != "running" or not _DISPLAY:
        raise RuntimeError("The graphical desktop is not running for this model and user.")
    if not _PROCESSES or _PROCESSES[0].poll() is not None:
        _stop(session, failed=True)
        raise RuntimeError("The graphical desktop stopped unexpectedly. Start it again to restore your files.")


def _run_input(args: list[str]) -> None:
    if not _ENV:
        raise RuntimeError("Desktop input is not connected.")
    result = subprocess.run(
        args,
        env=_ENV,
        capture_output=True,
        text=True,
        timeout=8,
        preexec_fn=box._child_setup(int(_UID or 0), box.is_root(), 15),
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Desktop input failed.")[-180:])


def _screenshot() -> dict:
    from PIL import Image, ImageGrab

    old_display = os.environ.get("DISPLAY")
    old_auth = os.environ.get("XAUTHORITY")
    os.environ["DISPLAY"] = _DISPLAY
    os.environ["XAUTHORITY"] = _AUTH_FILE
    try:
        image = ImageGrab.grab(xdisplay=_DISPLAY)
    finally:
        if old_display is None:
            os.environ.pop("DISPLAY", None)
        else:
            os.environ["DISPLAY"] = old_display
        if old_auth is None:
            os.environ.pop("XAUTHORITY", None)
        else:
            os.environ["XAUTHORITY"] = old_auth
    if image.size[0] > WIDTH or image.size[1] > HEIGHT:
        image.thumbnail((WIDTH, HEIGHT))
    image = image.convert("RGB")
    from io import BytesIO
    out = BytesIO()
    image.save(out, format="JPEG", quality=56, optimize=True)
    raw = out.getvalue()
    if len(raw) > MAX_FRAME_BYTES:
        out = BytesIO()
        image.save(out, format="JPEG", quality=38, optimize=True)
        raw = out.getvalue()
    return {
        "screenshot_b64": base64.b64encode(raw).decode("ascii"),
        "width": image.size[0],
        "height": image.size[1],
    }


def _stop(session: str, failed: bool = False) -> dict:
    global _PHASE, _ERROR, _PROCESSES, _DISPLAY, _AUTH_FILE, _ENV, _UID, _LAST_USED, _SESSION_HASH, _SESSION_RAW, _CANCEL_INSTALL
    with _LOCK:
        if not _same_session(session):
            return {"ok": True, "phase": "stopped"}
        _CANCEL_INSTALL = True
        processes = list(_PROCESSES)
        _PROCESSES = []
        display = _DISPLAY
        auth = _AUTH_FILE
        _PHASE = "failed" if failed else "stopped"
        if not failed:
            _ERROR = ""
        _DISPLAY = ""
        _AUTH_FILE = ""
        _ENV = {}
        _UID = None
        _LAST_USED = 0.0
        _SESSION_HASH = ""
        _SESSION_RAW = ""
    _kill_processes(processes)
    if auth:
        Path(auth).unlink(missing_ok=True)
    if display:
        try:
            number = int(display.lstrip(":"))
            Path(f"/tmp/.X{number}-lock").unlink(missing_ok=True)
        except ValueError:
            pass
    _release_reservation(session)
    return {"ok": True, "phase": "failed" if failed else "stopped"}


def _touch() -> None:
    global _LAST_USED
    _LAST_USED = time.time()


def _reaper() -> None:
    while True:
        time.sleep(30)
        with _LOCK:
            session = _SESSION_RAW
            expired = _PHASE == "running" and bool(session) and _LAST_USED and (time.time() - _LAST_USED > IDLE_SECONDS)
        if expired:
            _stop(session)


def api_desktop_do(body: str) -> str:
    """Gradio entry point: start/status/frame/stop/launch/click/type/key/scroll."""
    try:
        job = json.loads(body or "{}")
        if not isinstance(job, dict):
            raise ValueError("request must be an object")
        session = str(job.get("session") or "").strip()
        action = str(job.get("action") or "").lower()
        if not session or len(session) > 240:
            return json.dumps({"ok": False, "error": "a valid session is required"})
        if action not in {"status", "start", "stop", "frame", "launch", "click", "move", "type", "key", "scroll"}:
            return json.dumps({"ok": False, "error": "unknown desktop action"})
        if action == "status":
            return json.dumps(_desktop_status(session), ensure_ascii=False)
        if action == "start":
            try:
                _start_async(session)
            except Exception as exc:
                return json.dumps({"ok": False, "phase": "stopped", "error": str(exc)[:280]}, ensure_ascii=False)
            return json.dumps(_desktop_status(session), ensure_ascii=False)
        if action == "stop":
            return json.dumps(_stop(session), ensure_ascii=False)
        if action == "frame":
            _check_live(session)
            _touch()
            return json.dumps({"ok": True, "phase": "running", **_screenshot()})
        _check_live(session)
        _touch()
        if action == "launch":
            app = str(job.get("app") or "")
            if app == "terminal":
                cmd = ["xterm", "-fa", "Monospace", "-fs", "12", "-geometry", "104x30+12+12", "-title", "Model Computer"]
            elif app == "files":
                if not shutil.which("pcmanfm"):
                    return json.dumps({"ok": False, "error": "The file manager is not installed in this Studio."})
                cmd = ["pcmanfm", "--no-desktop", "--new-window", str(box.session_home(session))]
            elif app == "browser":
                url = str(job.get("url") or "about:blank").strip()
                if url != "about:blank":
                    import browser_computer
                    url = browser_computer.safe_url(url)
                if box.STATE.get("egress", "").startswith("not available") or box.STATE.get("egress", "").startswith("partly blocked"):
                    raise RuntimeError("The browser is disabled because this Studio could not confirm its private-network egress block.")
                import browser_computer
                executable = next((p for p in browser_computer.STORE.rglob("chrome") if p.is_file() and "headless" not in str(p).lower()), None)
                if executable is None:
                    raise RuntimeError("Chromium is not installed in this Studio yet. The model's headless browser can still be used in the Browser tab.")
                profile = box.session_home(session) / ".desktop" / "chrome-profile"
                profile.mkdir(parents=True, exist_ok=True)
                cmd = [
                    str(executable), "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--disable-features=Translate,MediaRouter", f"--user-data-dir={profile}",
                    f"--window-size={WIDTH - 24},{HEIGHT - 90}", url,
                ]
            else:
                return json.dumps({"ok": False, "error": "app must be terminal, files or browser"})
            proc = _spawn(cmd, _ENV, "app-" + app)
            _PROCESSES.append(proc)
            return json.dumps({"ok": True, "phase": "running", "app": app})
        if action == "click":
            x, y = clamp_point(job.get("x"), job.get("y"))
            button = str(job.get("button") or "left").lower()
            button_id = {"left": "1", "middle": "2", "right": "3"}.get(button)
            if button_id is None:
                raise ValueError("button must be left, middle or right")
            _run_input(["xdotool", "mousemove", str(x), str(y), "click", button_id])
        elif action == "move":
            x, y = clamp_point(job.get("x"), job.get("y"))
            _run_input(["xdotool", "mousemove", str(x), str(y)])
        elif action == "type":
            value = str(job.get("text") or "")[:MAX_TYPE]
            if value:
                _run_input(["xdotool", "type", "--clearmodifiers", "--delay", "5", "--", value])
        elif action == "key":
            key = str(job.get("key") or "")
            if not valid_key(key):
                raise ValueError("invalid key name")
            _run_input(["xdotool", "key", "--clearmodifiers", key])
        elif action == "scroll":
            direction = str(job.get("direction") or "down").lower()
            button_id = "4" if direction == "up" else "5" if direction == "down" else ""
            if not button_id:
                raise ValueError("direction must be up or down")
            amount = max(1, min(8, int(job.get("amount", 3) or 3)))
            _run_input(["xdotool", "click", "--repeat", str(amount), "--delay", "80", button_id])
        else:
            raise ValueError("unknown desktop action")
        return json.dumps({"ok": True, "phase": "running"}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:280]}"}, ensure_ascii=False)


threading.Thread(target=_reaper, daemon=True, name="desktop-idle-reaper").start()
