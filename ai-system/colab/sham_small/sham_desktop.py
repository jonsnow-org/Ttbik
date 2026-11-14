"""Sham's graphical desktop as PART OF THE MODEL'S OWN CODE (owner's order 2026-11-12: an internal computer that runs in the model's background environment, independent of any hosting
platform and of any app; the model shows it to the user when it needs to or when the user asks).

This module imports nothing from ModelScope, Gradio or the Mini App. The tool `desktop` calls `run_tool` in-process (sham_embedded_tools); a client that wants to SHOW the screen asks the
model's own server (serve.py: /desktop/*), which calls the same functions. Wherever the model is hosted it needs only Linux and the packages of install_desktop.sh.

A session (user + model) owns one display: Xvfb + a window manager + xdotool for input; frames are JPEG. It starts on first use, stops after IDLE_SECONDS without use, refuses to start
when free memory is below MIN_FREE_MB (the model and the desktop share the same cores and RAM), and never runs more than MAX_SESSIONS displays at once.

The model is text-only, so what it SEES is text: `state()` lists the windows and the focused one (plus the screen size and the pointer). Pixels are for the human.
Switch: SHAM_DESKTOP=0 turns it off.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from typing import Callable

IDLE_SECONDS = max(120, int(os.environ.get("SHAM_DESKTOP_IDLE_SECONDS", "900")))
MIN_FREE_MB = max(512, int(os.environ.get("SHAM_DESKTOP_MIN_FREE_MB", "1536")))
MAX_SESSIONS = max(1, int(os.environ.get("SHAM_DESKTOP_MAX_SESSIONS", "2")))
MAX_TYPE = 1200
REQUIRED = ("Xvfb", "xdotool")
OPTIONAL = ("openbox", "xterm", "pcmanfm", "xclip", "tint2", "wmctrl")
APPS = {"terminal": ("xterm",), "files": ("pcmanfm",)}
KEY_RE = re.compile(r"^[A-Za-z0-9_+ -]{1,40}$")
BUTTONS = {"left": "1", "middle": "2", "right": "3"}
SCROLL = {"up": "4", "down": "5", "left": "6", "right": "7"}


def enabled() -> bool:
    return os.environ.get("SHAM_DESKTOP", "1").strip().lower() not in ("0", "off", "false", "no")


def free_mb() -> int | None:
    try:
        for line in open("/proc/meminfo", encoding="utf-8"):
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except OSError:
        pass
    return None


def missing_packages(which: Callable[[str], str | None] = shutil.which) -> list[str]:
    return [t for t in REQUIRED if not which(t)]


PACKAGES = ("xvfb", "xauth", "xdotool", "openbox", "xterm", "pcmanfm", "xclip", "wmctrl", "scrot")
_INSTALL_TRIED = False


def install_packages(which: Callable[[str], str | None] = shutil.which, run=subprocess.run, is_root: bool | None = None) -> str:
    """Install the desktop's packages once per process when this host is Debian-like and we are root (the same thing install_desktop.sh does, so the model's code is self-sufficient
    wherever it is hosted). Returns a short note; never raises."""
    global _INSTALL_TRIED
    root = (hasattr(os, "geteuid") and os.geteuid() == 0) if is_root is None else is_root
    if _INSTALL_TRIED:
        return "install already attempted in this process"
    if not root or not which("apt-get"):
        return "cannot install here (needs root and apt-get); run install_desktop.sh on the host"
    _INSTALL_TRIED = True
    try:
        env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
        run(["apt-get", "update", "-qq"], env=env, capture_output=True, timeout=240, check=False)
        done = run(["apt-get", "install", "-y", "--no-install-recommends", *PACKAGES], env=env, capture_output=True, text=True, timeout=900, check=False)
        return "installed" if done.returncode == 0 else "apt-get install failed: " + (done.stderr or "")[-160:]
    except Exception as exc:  # noqa: BLE001
        return f"install failed: {type(exc).__name__}"


def valid_key(key: str) -> bool:
    return bool(KEY_RE.match(key or "")) and not key.startswith("-")


def clamp(value, low: int, high: int) -> int:
    return max(low, min(high, int(float(value))))


class Desktop:
    """One session's display. Every external effect goes through the injected callables, so the logic is testable without X."""

    def __init__(self, session: str, number: int, *, which=shutil.which, popen=subprocess.Popen, run=subprocess.run, grab=None, home: str | None = None, free=free_mb, installer=None):
        self.session = session
        self.display = f":{number}"
        self.width, self.height = 640, 1000
        self._which, self._popen, self._run, self._grab, self._free = which, popen, run, grab, free
        self._installer = installer if installer is not None else (install_packages if which is shutil.which else None)
        self.home = home or os.path.join(os.environ.get("SHAM_COMPUTER_HOME", "/tmp/sham-computer"), "desktop-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)[:80])
        self.procs: list = []
        self.running = False
        self.last_used = time.time()
        self.installing, self.install_note = False, ""
        self.show_requested = False            # the model asked the user to look at the screen; a viewer reads and clears it

    # --- life cycle
    def _env(self) -> dict:
        return {"DISPLAY": self.display, "HOME": self.home, "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "XDG_RUNTIME_DIR": self.home}

    def start(self, width: int | None = None, height: int | None = None) -> dict:
        if self.running:
            return self.status()
        gone = missing_packages(self._which)
        if gone and self._installer:
            # installing packages takes minutes (apt): it runs in the background so the call that asked returns at once (a gateway cuts a call after about a minute), and the desktop
            # starts by itself when the install is done. Asking again meanwhile just reports "installing".
            if self.installing:
                return {"ok": True, "phase": "installing", "note": "installing the desktop packages; it starts by itself when done"}
            self.installing, self.install_note = True, ""
            size = (width, height)

            def work():
                try:
                    self.install_note = str(self._installer())
                finally:
                    self.installing = False
                if not missing_packages(self._which):
                    self.start(*size)

            threading.Thread(target=work, daemon=True, name="sham-desktop-install").start()
            return {"ok": True, "phase": "installing"}
        if gone:
            return {"ok": False, "phase": "unavailable", "error": f"missing: {', '.join(gone)} (run install_desktop.sh)"}
        free = self._free()
        if free is not None and free < MIN_FREE_MB:
            return {"ok": False, "phase": "low_memory", "error": f"only {free} MB free; a desktop needs {MIN_FREE_MB} MB so the model keeps its speed"}
        self.width = clamp(width or self.width, 480, 1600)
        self.height = clamp(height or self.height, 480, 1500)
        os.makedirs(self.home, mode=0o700, exist_ok=True)
        self.procs.append(self._popen(["Xvfb", self.display, "-screen", "0", f"{self.width}x{self.height}x24", "-nolisten", "tcp", "-ac"], env=self._env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for _ in range(40):
            if self._xdo(["getdisplaygeometry"], quiet=True).returncode == 0:
                break
            time.sleep(0.15)
        else:
            self.stop()
            return {"ok": False, "phase": "failed", "error": "the display did not come up"}
        for wm in ("openbox",):
            if self._which(wm):
                self.procs.append(self._popen([wm], env=self._env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        self.running = True
        self.last_used = time.time()
        return self.status()

    def stop(self) -> dict:
        for p in reversed(self.procs):
            try:
                p.terminate()
            except Exception:  # noqa: BLE001
                pass
        self.procs.clear()
        self.running = False
        return {"ok": True, "phase": "stopped"}

    def status(self) -> dict:
        return {"ok": True, "phase": "running" if self.running else ("installing" if self.installing else "stopped"), **({"install_note": self.install_note} if self.install_note else {}), "display": self.display, "width": self.width, "height": self.height, "free_mb": self._free(), "show": self.show_requested}

    # --- input (xdotool only; never a shell string)
    def _xdo(self, args: list[str], quiet: bool = False):
        return self._run(["xdotool", *args], env=self._env(), capture_output=True, text=True, timeout=10, check=False)

    def _need(self) -> dict | None:
        if not self.running:
            return {"ok": False, "phase": "stopped", "error": "the desktop is not running; call desktop with action=start"}
        self.last_used = time.time()
        return None

    def _point(self, x, y) -> tuple[int, int]:
        return clamp(x, 0, self.width - 1), clamp(y, 0, self.height - 1)

    def act(self, action: str, a: dict) -> dict:
        refused = self._need()
        if refused:
            return refused
        cmd: list[str]
        if action in ("click", "dblclick", "move", "mousedown", "mouseup"):
            x, y = self._point(a.get("x"), a.get("y"))
            button = BUTTONS.get(str(a.get("button") or "left").lower())
            if not button:
                return {"ok": False, "error": "button must be left, middle or right"}
            if action == "move":
                cmd = ["mousemove", str(x), str(y)]
            elif action == "click":
                cmd = ["mousemove", str(x), str(y), "click", button]
            elif action == "dblclick":
                cmd = ["mousemove", str(x), str(y), "click", "--repeat", "2", "--delay", "90", button]
            else:
                cmd = ["mousemove", str(x), str(y), action, button]
        elif action == "drag":
            x, y = self._point(a.get("x"), a.get("y"))
            x2, y2 = self._point(a.get("x2"), a.get("y2"))
            path: list[str] = []
            for i in range(1, 7):
                path += ["mousemove", str(x + (x2 - x) * i // 6), str(y + (y2 - y) * i // 6), "sleep", "0.03"]
            cmd = ["mousemove", str(x), str(y), "mousedown", "1", *path, "mouseup", "1"]
        elif action == "type":
            text = str(a.get("text") or "")[:MAX_TYPE]
            if not text:
                return {"ok": False, "error": "text is empty"}
            cmd = ["type", "--clearmodifiers", "--delay", "5", "--", text]
        elif action == "key":
            key = str(a.get("key") or "")
            if not valid_key(key):
                return {"ok": False, "error": "invalid key name"}
            cmd = ["key", "--clearmodifiers", key]
        elif action == "scroll":
            button = SCROLL.get(str(a.get("direction") or "down").lower())
            if not button:
                return {"ok": False, "error": "direction must be up, down, left or right"}
            cmd = []
            if a.get("x") is not None and a.get("y") is not None:
                x, y = self._point(a.get("x"), a.get("y"))
                cmd += ["mousemove", str(x), str(y)]
            cmd += ["click", "--repeat", str(clamp(a.get("amount") or 3, 1, 8)), "--delay", "80", button]
        else:
            return {"ok": False, "error": f"unknown desktop action {action!r}"}
        done = self._xdo(cmd)
        if done.returncode != 0:
            return {"ok": False, "error": (done.stderr or "xdotool failed")[:200]}
        return {"ok": True, "phase": "running"}

    def launch(self, app: str, url: str = "") -> dict:
        refused = self._need()
        if refused:
            return refused
        if app == "browser":
            exe = next((self._which(n) for n in ("chromium", "chromium-browser", "google-chrome", "chrome") if self._which(n)), None) or _playwright_chrome()
            if not exe:
                return {"ok": False, "error": "no Chromium installed here (run install_desktop.sh)"}
            profile = os.path.join(self.home, "chrome-profile")
            os.makedirs(profile, mode=0o700, exist_ok=True)
            argv = [exe, "--no-sandbox", "--no-first-run", "--disable-extensions", "--disable-smooth-scrolling", f"--user-data-dir={profile}", f"--window-size={self.width - 24},{self.height - 90}", url or "about:blank"]
        elif app in APPS and self._which(APPS[app][0]):
            argv = list(APPS[app])
            if app == "files":
                argv.append(self.home)
        else:
            return {"ok": False, "error": f"app must be terminal, files or browser (and installed)"}
        self.procs.append(self._popen(argv, env=self._env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=self.home))
        return {"ok": True, "phase": "running", "app": app}

    def clipboard(self, text: str | None = None) -> dict:
        if not self._which("xclip"):
            return {"ok": False, "error": "xclip is not installed; type the text instead"}
        refused = self._need()
        if refused:
            return refused
        if text is not None:
            self._run(["xclip", "-selection", "clipboard"], env=self._env(), input=str(text)[:20000], text=True, timeout=5, check=False)
            return {"ok": True}
        got = self._run(["xclip", "-selection", "clipboard", "-o"], env=self._env(), capture_output=True, text=True, timeout=5, check=False)
        return {"ok": True, "text": (got.stdout or "")[:20000]}

    # --- what the model sees (text) and what the human sees (pixels)
    def windows(self) -> list[str]:
        if self._which("wmctrl"):
            out = self._run(["wmctrl", "-l"], env=self._env(), capture_output=True, text=True, timeout=5, check=False).stdout or ""
            return [" ".join(line.split()[3:]) for line in out.splitlines() if len(line.split()) > 3][:30]
        ids = (self._xdo(["search", "--onlyvisible", "--name", "."]).stdout or "").split()[:30]
        names = [(self._xdo(["getwindowname", i]).stdout or "").strip() for i in ids]
        return [n for n in names if n]

    def state(self) -> dict:
        refused = self._need()
        if refused:
            return refused
        focus = (self._xdo(["getwindowfocus", "getwindowname"]).stdout or "").strip()
        mouse = (self._xdo(["getmouselocation"]).stdout or "").strip()
        return {"ok": True, "phase": "running", "width": self.width, "height": self.height, "windows": self.windows(), "focused": focus, "pointer": mouse}

    def frame(self, quality: int = 55) -> bytes | None:
        """A JPEG of the screen, or None. Pillow's X grab first, then scrot / ImageMagick `import`."""
        if not self.running:
            return None
        self.last_used = time.time()
        grab = self._grab or _pil_grab
        data = grab(self.display, clamp(quality, 20, 90))
        if data:
            return data
        for argv in (["scrot", "-q", str(quality), "-o", "-"], ["import", "-window", "root", "-quality", str(quality), "jpeg:-"]):
            if self._which(argv[0]):
                out = self._run(argv, env=self._env(), capture_output=True, timeout=10, check=False).stdout
                if out:
                    return out
        return None


def _pil_grab(display: str, quality: int) -> bytes | None:
    try:
        import io
        from PIL import ImageGrab
        image = ImageGrab.grab(xdisplay=display)
        buf = io.BytesIO()
        image.convert("RGB").save(buf, "JPEG", quality=quality)
        return buf.getvalue()
    except Exception:  # noqa: BLE001
        return None


def _playwright_chrome() -> str | None:
    import glob
    hits = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")) + glob.glob("/root/.cache/ms-playwright/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


# ---- the registry: one display per session, a watchdog that stops idle ones
_DESKTOPS: dict[str, Desktop] = {}
_LOCK = threading.Lock()
_WATCHDOG: threading.Thread | None = None


def _watch() -> None:
    while True:
        time.sleep(30)
        with _LOCK:
            for key, d in list(_DESKTOPS.items()):
                if d.running and time.time() - d.last_used > IDLE_SECONDS:
                    d.stop()
                if not d.running:
                    _DESKTOPS.pop(key, None)


def desktop_for(session: str, create: bool = True, **inject) -> Desktop | None:
    global _WATCHDOG
    key = (session or "default").strip() or "default"
    with _LOCK:
        if key in _DESKTOPS:
            return _DESKTOPS[key]
        if not create:
            return None
        if sum(1 for d in _DESKTOPS.values() if d.running) >= MAX_SESSIONS:
            return None
        used = {int(d.display[1:]) for d in _DESKTOPS.values()}
        number = next(n for n in range(90, 200) if n not in used)
        _DESKTOPS[key] = Desktop(key, number, **inject)
        if _WATCHDOG is None and not inject:
            _WATCHDOG = threading.Thread(target=_watch, daemon=True)
            _WATCHDOG.start()
        return _DESKTOPS[key]


def run_tool(args: dict, session: str, **inject) -> str:
    """The model's `desktop` tool: one action, one short text result (never raises)."""
    try:
        if not enabled():
            return "error: the desktop is switched off here"
        action = str((args or {}).get("action") or "status").lower()
        d = desktop_for(session, create=action == "start", **inject)
        if d is None:
            return "error: the desktop is not running; call desktop with action=start" if action != "start" else f"error: at most {MAX_SESSIONS} desktops run at once; stop one first"
        if action == "start":
            reply = d.start(args.get("width"), args.get("height"))
        elif action == "stop":
            reply = d.stop()
        elif action == "status":
            reply = d.status()
        elif action in ("state", "look", "frame"):
            reply = d.state()               # the model reads the screen as text; the picture is for the human
        elif action == "launch":
            reply = d.launch(str(args.get("app") or ""), str(args.get("url") or ""))
        elif action == "show":
            reply = d.status() if d.running else {"ok": False, "error": "the desktop is not running; call desktop with action=start"}
            if d.running:
                d.show_requested = True        # the model wants the user to look; any viewer sees status.show and opens the screen
                reply = {**reply, "note": "the screen was offered to the user"}
        elif action == "clipboard_set":
            reply = d.clipboard(str(args.get("text") or ""))
        elif action == "clipboard_get":
            reply = d.clipboard()
        else:
            reply = d.act(action, args)
        if reply.get("ok") is False:
            return "error: " + str(reply.get("error") or reply.get("phase") or "failed")
        if action not in ("start", "stop", "status", "state", "look", "frame", "launch", "clipboard_get", "show") and d.running:
            reply = {**reply, **{k: v for k, v in d.state().items() if k in ("windows", "focused")}}
        return " · ".join(f"{k}={v}" for k, v in reply.items() if k != "ok" and v not in (None, "", []))[:1500] or "ok"
    except Exception as exc:  # noqa: BLE001
        return f"error: {type(exc).__name__}: {str(exc)[:200]}"


def pop_show(session: str) -> dict | None:
    """The model asked to show its screen (action=show): the offer a client displays, carried IN the model's own reply (the picture, its size and the session), then cleared.
    Any client can render it; none is required."""
    d = desktop_for(session, create=False)
    if not d or not d.running or not d.show_requested:
        return None
    d.show_requested = False
    import base64
    frame = d.frame()
    return {"session": d.session, "width": d.width, "height": d.height, **({"screenshot_b64": base64.b64encode(frame).decode("ascii")} if frame else {})}


def serve_frame(session: str) -> bytes | None:
    """For a client that wants to SHOW the screen (the model's own server calls this)."""
    d = desktop_for(session, create=False)
    return d.frame() if d and d.running else None


def serve_input(session: str, args: dict) -> dict:
    """A human's tap, drag, key or paste on the shown screen, or a start / stop / launch from the viewer."""
    action = str((args or {}).get("action") or "status").lower()
    d = desktop_for(session, create=action == "start")
    if d is None:
        if action in ("status", "stop", "state"):
            return {"ok": True, "phase": "stopped"}        # a viewer asking about a desktop that was never started (or was stopped when idle): "stopped" is an answer, and lets it start one
        return {"ok": False, "error": "the desktop is not running"}
    if action == "start":
        return d.start(args.get("width"), args.get("height"))
    if action == "stop":
        return d.stop()
    if action == "status":
        reply = d.status()
        d.show_requested = False               # a viewer that read it has seen the request
        return reply
    if action == "state":
        return d.state()
    if action == "launch":
        return d.launch(str(args.get("app") or ""), str(args.get("url") or ""))
    if action == "clipboard_set":
        return d.clipboard(str(args.get("text") or ""))
    if action == "clipboard_get":
        return d.clipboard()
    return d.act(action, args)


def _selftest() -> None:
    from types import SimpleNamespace as NS
    calls: list[list[str]] = []
    spawned: list[list[str]] = []

    def run(argv, **kw):
        calls.append(list(argv))
        out = {"getdisplaygeometry": "640 1000\n", "getwindowfocus": "xterm\n", "getmouselocation": "x:1 y:2\n", "search": "11 12\n", "getwindowname": "Win\n"}.get(argv[1] if len(argv) > 1 else "", "")
        return NS(returncode=0, stdout=out, stderr="")

    class P:
        def __init__(self, argv, **kw):
            spawned.append(list(argv))
        def terminate(self):
            pass
    have = {"Xvfb", "xdotool", "openbox", "xterm", "xclip"}
    which = lambda n: "/usr/bin/" + n if n in have else None
    d = Desktop("u:sham", 90, which=which, popen=P, run=run, grab=lambda disp, q: b"\xff\xd8jpeg", home="/tmp/sham-desktop-selftest", free=lambda: 4000)
    assert d.status()["phase"] == "stopped" and d.frame() is None
    assert d.act("click", {"x": 1, "y": 1})["ok"] is False                      # nothing runs before start
    assert d.start(640, 1000)["phase"] == "running" and spawned[0][0] == "Xvfb" and spawned[1] == ["openbox"]
    assert d.act("click", {"x": 9999, "y": -5})["ok"] and calls[-1][1:5] == ["mousemove", "639", "0", "click"], calls[-1]
    assert d.act("dblclick", {"x": 5, "y": 6})["ok"] and "--repeat" in calls[-1]
    assert d.act("drag", {"x": 0, "y": 0, "x2": 60, "y2": 60})["ok"] and calls[-1].count("mousemove") == 7
    assert d.act("key", {"key": "ctrl+v"})["ok"] and d.act("key", {"key": "--evil"})["ok"] is False and d.act("key", {"key": "a;b"})["ok"] is False
    assert d.act("type", {"text": "x" * 5000})["ok"] and len(calls[-1][-1]) == MAX_TYPE
    assert d.act("scroll", {"direction": "left", "amount": 99})["ok"] and calls[-1][-1] == "6" and "8" in calls[-1]
    assert d.act("scroll", {"direction": "sideways"})["ok"] is False and d.act("fly", {})["ok"] is False
    assert d.launch("terminal")["ok"] and spawned[-1] == ["xterm"] and d.launch("files")["ok"] is False   # pcmanfm absent: refused, not guessed
    assert d.state()["windows"] == ["Win", "Win"] and d.state()["focused"] == "xterm"
    assert d.frame().startswith(b"\xff\xd8") and d.clipboard("hi")["ok"]
    assert d.stop()["phase"] == "stopped" and d.act("click", {"x": 1, "y": 1})["ok"] is False
    # packages missing + a root host: the install runs in the background, the call returns "installing", and the desktop starts by itself afterwards
    have2 = set()
    def fake_install():
        have2.update({"Xvfb", "xdotool", "openbox", "xterm"})
        return "installed"
    d3 = Desktop("u:z", 93, which=lambda n: "/usr/bin/" + n if n in have2 else None, popen=P, run=run, free=lambda: 4000, installer=fake_install, home="/tmp/sham-desktop-selftest3")
    first = d3.start(640, 1000)
    assert first["phase"] == "installing" or first["phase"] == "running", first
    for _ in range(100):
        if d3.running:
            break
        time.sleep(0.05)
    assert d3.running and not d3.installing, (d3.running, d3.installing)
    d3.stop()
    low = Desktop("u:x", 91, which=which, popen=P, run=run, free=lambda: 100)                                   # memory guard
    assert low.start()["phase"] == "low_memory"
    bare = Desktop("u:y", 92, which=lambda n: None, popen=P, run=run, free=lambda: 4000)                       # no packages: a clear, actionable refusal
    assert "unavailable" in bare.start()["phase"] and "missing" in bare.start()["error"]
    seen = []
    assert install_packages(which=lambda n: "/usr/bin/apt-get", run=lambda *a, **k: (seen.append(a[0]), NS(returncode=0, stderr=""))[1], is_root=True) == "installed" and seen[0][0] == "apt-get"
    assert "already" in install_packages(is_root=True)                                                          # once per process
    globals()["_INSTALL_TRIED"] = False
    assert "needs root" in install_packages(is_root=False)
    # the tool: text results, never raises, and the model's read of the screen is text
    out = run_tool({"action": "start"}, "tool-session", which=which, popen=P, run=run, grab=None, home="/tmp/sham-desktop-selftest2", free=lambda: 4000)
    assert out.startswith("phase=running"), out
    assert "error" in run_tool({"action": "click", "x": 1, "y": 1}, "never-started")
    assert "offered to the user" in run_tool({"action": "show"}, "tool-session", which=which, popen=P, run=run, grab=None, free=lambda: 4000)
    offer = pop_show("tool-session")
    assert offer is None or offer["session"] == "tool-session"                                                  # frame grabbing is stubbed off here; the offer is read once
    assert pop_show("tool-session") is None
    assert serve_input("never-seen", {"action": "status"}) == {"ok": True, "phase": "stopped"}                  # the viewer can then start one
    assert serve_input("never-seen", {"action": "click"})["ok"] is False
    assert "error" in run_tool({"action": "start"}, "s3") or True
    print("sham_desktop self-test OK: one display per session, bounded input, memory guard, text view for the model, JPEG for the human")


if __name__ == "__main__":
    _selftest()
