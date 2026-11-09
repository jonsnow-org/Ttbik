"""A lightweight, real Linux desktop exposed through the computer hub's Gradio API.

This is deliberately not VNC and does not need Docker, a public port, or a paid
desktop provider. The private 16 GB computer Studio starts one Xvfb + Openbox
session at a time, then returns bounded JPEG frames and accepts bounded
mouse/keyboard events through Gradio. The home directory and Unix UID are the
same as that user+model's persistent computer_box session.

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
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import computer_box as box

MIN_AVAILABLE_MB = max(3072, int(os.environ.get("DESKTOP_MIN_AVAILABLE_MB", "3072")))
IDLE_SECONDS = max(120, int(os.environ.get("DESKTOP_IDLE_SECONDS", "900")))
WIDTH = max(800, min(1600, int(os.environ.get("DESKTOP_WIDTH", "1344"))))
HEIGHT = max(600, min(1000, int(os.environ.get("DESKTOP_HEIGHT", "840"))))
MAX_TYPE = 1200
PANEL_HEIGHT = 44          # the taskbar inside the desktop (tint2)
MAX_FRAME_BYTES = 560_000
INPUT_ACTIONS = {"click", "dblclick", "move", "drag", "mousedown", "mouseup", "type", "key", "scroll", "clipboard_get", "clipboard_set"}
PACKAGES = ("xvfb", "xauth", "openbox", "xterm", "xdotool", "pcmanfm", "xclip")   # xclip: copy / paste between the Mini App and the desktop (optional)

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
DISPLAY_BASE = 91      # each desktop slot (a separate copy of this module, see computer_studio_app.py) gets its own range of X display numbers
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


def _install_panel_package() -> None:
    """tint2 draws the taskbar INSIDE the desktop (owner 2026-11-09: the apps must be on the computer's own screen, not buttons in the page). Best effort: a failed install leaves the desktop without a panel, never without a desktop."""
    if shutil.which("tint2") or not box.is_root() or not shutil.which("apt-get"):
        return
    try:
        box.apt_install(["tint2"], timeout=420)
    except Exception:  # noqa: BLE001
        pass


def _install_packages() -> None:
    missing = [name for name in PACKAGES if not shutil.which(name)]
    if not missing:
        _install_panel_package()
        return
    if not box.is_root() or not shutil.which("apt-get"):
        raise RuntimeError("This Studio image has no X11 desktop packages and cannot install them without root.")
    # Use the same repaired Ubuntu repositories as the terminal toolchain. APT
    # needs the system /tmp and root HOME, not clean_env()'s per-session TMPDIR.
    update = box.apt_update(timeout=420)
    if update.returncode != 0:
        detail = (update.stderr or update.stdout or "APT returned no diagnostic").strip()
        raise RuntimeError("Desktop package index update failed: " + detail[-700:])
    result = box.apt_install(missing, timeout=900)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "APT returned no diagnostic").strip()
        raise RuntimeError("Desktop packages could not be installed: " + detail[-900:])
    still_missing = [name for name in ("Xvfb", "xauth", "openbox", "xterm", "xdotool") if not shutil.which(name)]
    if still_missing:
        raise RuntimeError("Desktop packages remain unavailable: " + ", ".join(still_missing))
    _install_panel_package()


def _display_number() -> int:
    # Single display per Studio; choose a free high display number and avoid
    # the platform's own X sockets.
    for number in range(DISPLAY_BASE, DISPLAY_BASE + 30):
        if not Path(f"/tmp/.X11-unix/X{number}").exists() and not Path(f"/tmp/.X{number}-lock").exists():
            return number
    raise RuntimeError("No free X display number is available in this Studio.")


def _remove_xauthority(auth: Path | None) -> None:
    """Remove only this desktop's ephemeral Xauthority directory and lock files."""
    if auth is None:
        return
    try:
        parent = auth.parent.resolve()
        tmp_root = Path("/tmp").resolve()
        if parent.parent == tmp_root and parent.name.startswith("sham-desktop-xauth-"):
            shutil.rmtree(parent, ignore_errors=True)
        else:
            auth.unlink(missing_ok=True)
            for suffix in ("-c", "-l", "-n"):
                Path(str(auth) + suffix).unlink(missing_ok=True)
    except OSError:
        pass


def _write_xauthority(session: str, number: int) -> tuple[Path, str]:
    """Create the short-lived X11 cookie on local /tmp, not the persistent Studio volume.

    xauth uses lock files beside its authority database. The persistent computer
    home may be backed by a mounted volume with slow or stale lock semantics;
    putting this ephemeral file on /tmp avoids that failure mode and lets every
    start attempt receive a clean, private lock namespace.
    """
    uid = box.session_uid(session)
    runtime = Path(tempfile.mkdtemp(prefix="sham-desktop-xauth-", dir="/tmp"))
    auth = runtime / "Xauthority"
    try:
        os.chmod(runtime, 0o700)
        if box.is_root():
            os.chown(runtime, uid, uid)
        cookie = secrets.token_hex(16)
        env = box.clean_env(session)
        env["HOME"] = str(runtime)
        env["TMPDIR"] = str(runtime)
        try:
            result = subprocess.run(
                ["xauth", "-b", "-f", str(auth), "add", f":{number}", "MIT-MAGIC-COOKIE-1", cookie],
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
                preexec_fn=box._child_setup(uid, box.is_root(), 30),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("xauth timed out after 30 seconds while creating the private X11 cookie on local /tmp.") from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "xauth returned no diagnostic").strip()
            detail = detail.replace(cookie, "[redacted]").splitlines()[-1][:160]
            raise RuntimeError(f"xauth failed with exit code {result.returncode}: {detail}")
        if not auth.is_file() or auth.stat().st_size < 1:
            raise RuntimeError("xauth completed without creating a usable Xauthority file.")
        if box.is_root():
            os.chown(auth, uid, uid)
        os.chmod(auth, 0o600)
        return auth, str(runtime)
    except Exception:
        shutil.rmtree(runtime, ignore_errors=True)
        raise


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



def _terminal_command() -> list[str]:
    """A terminal that fills the whole screen and shows what the model runs on its computer (its commands and their output) above an interactive shell."""
    cols, rows = max(80, WIDTH // 7 - 1), max(24, (HEIGHT - PANEL_HEIGHT) // 15 - 1)
    script = 'touch "$HOME/.activity.log"; tail -n 60 -F "$HOME/.activity.log" 2>/dev/null & exec bash -i'
    return ["xterm", "-fa", "Monospace", "-fs", "12", "-geometry", f"{cols}x{rows}+0+0", "-title", "Model Computer", "-e", "bash", "-c", script]

def panel_config(buttons: list[tuple[str, str]]) -> str:
    """The tint2 configuration: a taskbar along the bottom of the desktop with one button per app (label, command) and the open windows."""
    lines = [
        "rounded = 0", "border_width = 0", "background_color = #111827 100", "border_color = #111827 0",
        "rounded = 6", "border_width = 1", "background_color = #1f2937 100", "border_color = #475569 100",
        "rounded = 6", "border_width = 1", "background_color = #0d9488 100", "border_color = #5eead4 100",
        "panel_items = " + "B" * len(buttons) + "TC",
        f"panel_size = 100% {PANEL_HEIGHT}", "panel_margin = 0 0", "panel_padding = 6 5 6",
        "panel_background_id = 1", "wm_menu = 0", "panel_dock = 0", "panel_position = bottom center horizontal",
        "panel_layer = top", "strut_policy = minimum", "autohide = 0",
        "taskbar_mode = single_desktop", "taskbar_padding = 2 0 2", "taskbar_background_id = 0",
        "task_text = 1", "task_maximum_size = 170 34", "task_padding = 6 3 6", "task_font = Sans 10",
        "task_font_color = #ffffff 100", "task_background_id = 2", "task_active_background_id = 3",
        "time1_format = %H:%M", "time1_font = Sans 11", "clock_font_color = #ffffff 100",
        "clock_padding = 8 0", "clock_background_id = 0",
    ]
    for label, command in buttons:
        lines += ["button = new", "button_text = " + label, "button_font = Sans 11", "button_font_color = #ffffff 100",
                  "button_padding = 12 4 8", "button_background_id = 2", "button_lclick_command = " + command]
    return "\n".join(lines) + "\n"


def _launcher_script(session: str, app: str) -> str | None:
    """The shell script a taskbar button runs: the same command the Mini App's launch action uses (the browser is looked up when clicked, because Chromium may be installed after the desktop started)."""
    if app == "browser":
        import browser_computer
        profile = box.session_home(session) / ".desktop" / "chrome-profile"
        find = f"find {shlex.quote(str(browser_computer.STORE))} -name chrome -type f ! -ipath '*headless*' 2>/dev/null | head -n 1"
        flags = " ".join(shlex.quote(f) for f in [
            "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-features=Translate,MediaRouter", f"--user-data-dir={profile}",
            f"--window-size={WIDTH - 24},{HEIGHT - PANEL_HEIGHT - 50}", "about:blank"])
        return f'#!/bin/sh\nmkdir -p {shlex.quote(str(profile))}\nC="$({find})"\n[ -n "$C" ] || {{ xmessage "Chromium is not installed in this computer yet." & exit 0; }}\nexec "$C" {flags}\n'
    if app == "terminal":
        return "#!/bin/sh\nexec " + " ".join(shlex.quote(c) for c in _terminal_command()) + "\n"
    if app == "files" and shutil.which("pcmanfm"):
        return "#!/bin/sh\nexec pcmanfm --no-desktop --new-window " + shlex.quote(str(box.session_home(session))) + "\n"
    return None


def _start_panel(session: str, env: dict[str, str], uid: int) -> subprocess.Popen | None:
    """Write the launcher scripts and the tint2 configuration into the session's home and start the taskbar. None when tint2 is not installed."""
    if not shutil.which("tint2"):
        return None
    folder = box.session_home(session) / ".desktop" / "panel"
    folder.mkdir(parents=True, exist_ok=True)
    buttons: list[tuple[str, str]] = []
    for app, label in (("browser", "Browser"), ("terminal", "Terminal"), ("files", "Files")):
        script = _launcher_script(session, app)
        if not script:
            continue
        path = folder / (app + ".sh")
        path.write_text(script, encoding="utf-8")
        os.chmod(path, 0o755)
        buttons.append((label, str(path)))
    config = folder / "tint2rc"
    config.write_text(panel_config(buttons), encoding="utf-8")
    if box.is_root():
        for item in [folder.parent, folder, config, *(folder / (a + ".sh") for a in ("browser", "terminal", "files") if (folder / (a + ".sh")).exists())]:
            os.chown(item, uid, uid)
    return _spawn(["tint2", "-c", str(config)], env, "tint2")


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
        _remove_xauthority(auth)
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

        # Best-effort private-network firewall; on ModelScope Studios (no root / no iptables) the platform's own sandbox handles isolation.
        egress = box.install_egress_rules()
        if egress.startswith("not available") or egress.startswith("partly blocked"):
            import logging as _lg
            _lg.getLogger(__name__).warning("desktop: egress firewall not applied (%s); relying on platform sandbox", egress)

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

        try:
            panel = _start_panel(session, env, uid)
        except Exception:  # noqa: BLE001 - the desktop is useful without its taskbar
            panel = None
        if panel is not None:
            processes.append(panel)
            time.sleep(0.4)

        terminal = _spawn(
            _terminal_command(),
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


_LAST_FRAME = {"hash": "", "raw": b""}


def _screenshot(quality: int = 62, scale: float = 1.0, since: str = "") -> dict:
    """One JPEG frame. quality / scale make it smaller for a faster live view; `since` = the hash the client already shows:
    an unchanged screen answers {unchanged: true} without the picture (most frames of an idle desktop)."""
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
    screen_w, screen_h = image.size
    digest_now = hashlib.blake2b(image.tobytes(), digest_size=10).hexdigest()
    if since and since == digest_now:
        return {"unchanged": True, "hash": digest_now, "width": screen_w, "height": screen_h}
    scale = max(0.35, min(1.0, float(scale or 1.0)))
    if scale < 0.999:
        image = image.resize((max(1, int(screen_w * scale)), max(1, int(screen_h * scale))), Image.BILINEAR)
    quality = max(25, min(85, int(quality or 62)))
    from io import BytesIO
    out = BytesIO()
    image.save(out, format="JPEG", quality=quality, optimize=False)
    raw = out.getvalue()
    if len(raw) > MAX_FRAME_BYTES:
        out = BytesIO()
        image.save(out, format="JPEG", quality=min(quality, 45), optimize=True)
        raw = out.getvalue()
    # width/height are the REAL screen size (click coordinates); the picture may be smaller (scale)
    return {
        "screenshot_b64": base64.b64encode(raw).decode("ascii"),
        "hash": digest_now,
        "width": screen_w,
        "height": screen_h,
        "frame_width": image.size[0],
        "frame_height": image.size[1],
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
        _remove_xauthority(Path(auth))
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
        # Match the computer_box wire contract: the Studio gateway rejects
        # some raw JSON payloads, so the app client sends b64:<JSON>.
        job = json.loads(box.unwrap_body(body) or "{}")
        if not isinstance(job, dict):
            raise ValueError("request must be an object")
        session = str(job.get("session") or "").strip()
        action = str(job.get("action") or "").lower()
        if not session or len(session) > 240:
            return json.dumps({"ok": False, "error": "a valid session is required"})
        if action not in INPUT_ACTIONS | {"status", "start", "stop", "frame", "launch", "pointer"}:
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
            shot = _screenshot(int(job.get("quality") or 62), float(job.get("scale") or 1.0), str(job.get("since") or "")[:40])
            extra = box.activity_since(session, int(job["activity_since"]), 12) if job.get("activity_since") is not None else {}
            return json.dumps({"ok": True, "phase": "running", **shot, **({"activity": extra.get("activity", []), "activity_seq": extra.get("seq", 0), "running_jobs": extra.get("running_jobs", [])} if extra else {})}, ensure_ascii=False)
        _check_live(session)
        _touch()
        if action == "pointer":                       # where the pointer is (the live view draws it; the smoke test checks clicks land exactly)
            got = subprocess.run(["xdotool", "getmouselocation", "--shell"], env=_ENV, capture_output=True, text=True, timeout=5,
                                 preexec_fn=box._child_setup(int(_UID or 0), box.is_root(), 10))
            vals = dict(line.split("=", 1) for line in (got.stdout or "").split() if "=" in line)
            return json.dumps({"ok": True, "phase": "running", "x": int(vals.get("X", -1)), "y": int(vals.get("Y", -1))})
        # typed text and clipboard contents are never written to the feed (they can be passwords): only their length
        detail = str(job.get("app") or job.get("key") or job.get("url") or "")
        if action in ("type", "clipboard_set"):
            detail = f"{len(str(job.get('text') or ''))} characters"
        elif job.get("x") is not None:
            detail = detail or f"{job.get('x')},{job.get('y')}"
        entry = box.note_activity(session, "desktop", action, detail[:240], "start")
        try:
            reply = _input_action(session, action, job)
        except Exception as exc:
            box.finish_activity(entry, {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
            raise
        box.finish_activity(entry, {"ok": bool(reply.get("ok", True))})
        return json.dumps(reply, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:280]}"}, ensure_ascii=False)


def _input_action(session: str, action: str, job: dict) -> dict:
    """The input / launch actions of a running desktop (called by api_desktop_do after the live check); returns the reply object."""
    if action == "launch":
        app = str(job.get("app") or "")
        if app == "terminal":
            cmd = _terminal_command()
        elif app == "files":
            if not shutil.which("pcmanfm"):
                return {"ok": False, "error": "The file manager is not installed in this Studio."}
            cmd = ["pcmanfm", "--no-desktop", "--new-window", str(box.session_home(session))]
        elif app == "browser":
            url = str(job.get("url") or "about:blank").strip()
            if url != "about:blank":
                import browser_computer
                url = browser_computer.safe_url(url)
            if box.STATE.get("egress", "").startswith("partly blocked"):
                raise RuntimeError("The browser is disabled because this Studio could not confirm its private-network egress block.")
            import browser_computer
            executable = next((p for p in browser_computer.STORE.rglob("chrome") if p.is_file() and "headless" not in str(p).lower()), None)
            if executable is None:
                raise RuntimeError("Chromium is not installed in this Studio yet. The model's headless browser can still be used in the Browser tab.")
            profile = box.session_home(session) / ".desktop" / "chrome-profile"
            profile.mkdir(parents=True, exist_ok=True, mode=0o700)
            if box.is_root():
                os.chown(profile.parent, box.session_uid(session), box.session_uid(session))
                os.chown(profile, box.session_uid(session), box.session_uid(session))
            os.chmod(profile, 0o700)
            cmd = [
                str(executable), "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                "--disable-features=Translate,MediaRouter", f"--user-data-dir={profile}",
                f"--window-size={WIDTH - 24},{HEIGHT - 90}", url,
            ]
        else:
            return {"ok": False, "error": "app must be terminal, files or browser"}
        proc = _spawn(cmd, _ENV, "app-" + app)
        _PROCESSES.append(proc)
        return {"ok": True, "phase": "running", "app": app}
    if action == "click":
        x, y = clamp_point(job.get("x"), job.get("y"))
        button = str(job.get("button") or "left").lower()
        button_id = {"left": "1", "middle": "2", "right": "3"}.get(button)
        if button_id is None:
            raise ValueError("button must be left, middle or right")
        _run_input(["xdotool", "mousemove", str(x), str(y), "click", button_id])
    elif action == "dblclick":
        x, y = clamp_point(job.get("x"), job.get("y"))
        _run_input(["xdotool", "mousemove", str(x), str(y), "click", "--repeat", "2", "--delay", "90", "1"])
    elif action == "move":
        x, y = clamp_point(job.get("x"), job.get("y"))
        _run_input(["xdotool", "mousemove", str(x), str(y)])
    elif action in ("mousedown", "mouseup"):
        x, y = clamp_point(job.get("x"), job.get("y"))
        button_id = {"left": "1", "middle": "2", "right": "3"}.get(str(job.get("button") or "left").lower(), "1")
        _run_input(["xdotool", "mousemove", str(x), str(y), action, button_id])
    elif action == "drag":
        x, y = clamp_point(job.get("x"), job.get("y"))
        x2, y2 = clamp_point(job.get("x2"), job.get("y2"))
        steps = 6
        path = []
        for i in range(1, steps + 1):
            path += ["mousemove", str(x + (x2 - x) * i // steps), str(y + (y2 - y) * i // steps), "sleep", "0.03"]
        _run_input(["xdotool", "mousemove", str(x), str(y), "mousedown", "1", *path, "mouseup", "1"])
    elif action == "clipboard_set":
        if not shutil.which("xclip"):
            raise RuntimeError("xclip is not installed in this Studio; type the text instead")
        value = str(job.get("text") or "")[:20000]
        subprocess.run(["xclip", "-selection", "clipboard"], input=value, env=_ENV, text=True, timeout=5, check=True,
                       preexec_fn=box._child_setup(int(_UID or 0), box.is_root(), 10))
    elif action == "clipboard_get":
        if not shutil.which("xclip"):
            raise RuntimeError("xclip is not installed in this Studio")
        got = subprocess.run(["xclip", "-selection", "clipboard", "-o"], env=_ENV, capture_output=True, text=True, timeout=5,
                             preexec_fn=box._child_setup(int(_UID or 0), box.is_root(), 10))
        return {"ok": True, "phase": "running", "text": (got.stdout or "")[:20000]}
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
        button_id = {"up": "4", "down": "5", "left": "6", "right": "7"}.get(direction, "")
        if not button_id:
            raise ValueError("direction must be up, down, left or right")
        if job.get("x") is not None and job.get("y") is not None:
            x, y = clamp_point(job.get("x"), job.get("y"))
            _run_input(["xdotool", "mousemove", str(x), str(y)])
        amount = max(1, min(8, int(job.get("amount", 3) or 3)))
        _run_input(["xdotool", "click", "--repeat", str(amount), "--delay", "80", button_id])
    else:
        raise ValueError("unknown desktop action")
    return {"ok": True, "phase": "running"}


threading.Thread(target=_reaper, daemon=True, name="desktop-idle-reaper").start()
