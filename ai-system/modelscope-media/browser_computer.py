"""A free headless browser on the dedicated computer hub: JavaScript, clicking and typing.

Runs inside the private 2-vCPU / 16-GB computer-only Studio. Browser processes
are shared for efficiency, but every user+model gets a separate BrowserContext,
cookie store and persistent session directory. The app server calls it through
the Studio's Gradio API (`browser_do`, `browser_status`).

How it gets a browser on a Studio (measured on a real ModelScope Studio, 2026-11-01: we are root, apt works through the Aliyun mirror, but Playwright's own
download host did not answer in 900 s - the Studio is in China):
  1. Chromium is downloaded from a mirror first (PLAYWRIGHT_DOWNLOAD_HOST, then npmmirror), then from Playwright's own host, into the persistent folder (/mnt/workspace);
  2. if it cannot start for missing system libraries: when we are root they are installed with `apt-get install`; otherwise the .deb files are fetched with an
     unprivileged `apt-get` and unpacked into a local prefix on LD_LIBRARY_PATH.
One Chromium process serves every session (one BrowserContext each); idle sessions are saved to disk and closed.
The result of every step is kept in `status()` so a failing Studio explains itself.
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import queue
import re
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

STORE = Path(os.environ.get("BROWSER_STORE", "/mnt/workspace/browser"))
VIEWPORT = {"width": 1152, "height": 768}
MAX_TEXT = 6000
MAX_ELEMENTS = 40
IDLE_SECONDS = 600
MAX_SESSIONS = 6                 # contexts of ONE shared Chromium cost ~25 MB each (a process per session cost ~500 MB), so several fit comfortably in the reserved 16 GB hub
ARIA_LIMIT = 5000

# Debian/Ubuntu packages Chromium needs; fetched (not installed) only when it fails to start for a missing library.
CHROMIUM_LIBS = [
    "libnss3", "libnspr4", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0", "libxcomposite1", "libxdamage1",
    "libxfixes3", "libxrandr2", "libgbm1", "libpango-1.0-0", "libcairo2", "libasound2", "libx11-6", "libxcb1", "libxext6", "libdbus-1-3",
    "libglib2.0-0", "libatspi2.0-0", "libx11-xcb1", "libxrender1", "libfontconfig1", "libfreetype6", "fonts-liberation",
]

STATE: dict = {"phase": "not started", "steps": [], "error": "", "chromium": "", "channel": ""}
_LOCK = threading.RLock()


def _note(step: str) -> None:
    with _LOCK:
        STATE["steps"] = (STATE["steps"] + [step[:240]])[-30:]


# ---------------------------------------------------------------- pure helpers (unit-tested)
def _session_owns_loopback_port(session: str, port: int) -> bool:
    """A local preview is allowed only when its listening socket belongs to this exact user:model UID."""
    if not session or not (1024 <= int(port) <= 65535):
        return False
    try:
        import computer_box
        expected_uid = int(computer_box.session_uid(session))
        rows = Path("/proc/net/tcp").read_text(encoding="ascii", errors="ignore").splitlines()[1:]
    except (ImportError, OSError, ValueError, TypeError):
        return False
    inodes: set[str] = set()
    for row in rows:
        fields = row.split()
        if len(fields) < 10 or fields[3] != "0A":
            continue
        try:
            address_hex, port_hex = fields[1].split(":")
            address = ipaddress.ip_address(bytes.fromhex(address_hex)[::-1])
            if address == ipaddress.ip_address("127.0.0.1") and int(port_hex, 16) == int(port):
                inodes.add(fields[9])
        except (ValueError, IndexError):
            continue
    if not inodes:
        return False
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != expected_uid:
                continue
            for fd in (process / "fd").iterdir():
                try:
                    target = os.readlink(fd)
                except OSError:
                    continue
                if target.startswith("socket:[") and target[8:-1] in inodes:
                    return True
        except (OSError, PermissionError):
            continue
    return False


def safe_url(raw: str, session: str | None = None) -> str:
    """Allow public HTTP(S) pages; permit localhost only for a server owned by this user:model session.

    Private LAN, metadata and link-local destinations remain blocked on every
    navigation and redirect. Local previews must bind to 127.0.0.1 and run under
    the session UID (for example a Next/Vite/Jupyter dev server started by
    computer_job); knowing another session's port is not sufficient.
    """
    url = str(raw or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("only plain http(s) addresses are allowed")
    host = parsed.hostname.lower()
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if host == "localhost":
        if not session or not _session_owns_loopback_port(session, port):
            raise ValueError("localhost is allowed only for a server running in this model's own computer session")
        netloc = "127.0.0.1" + (f":{port}" if parsed.port else "")
        url = parsed._replace(netloc=netloc).geturl()
        host = "127.0.0.1"
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError("cannot resolve " + host) from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_loopback:
            if str(address) != "127.0.0.1" or not session or not _session_owns_loopback_port(session, port):
                raise ValueError("loopback is allowed only for a server owned by this model's computer session")
            continue
        if address.is_private or address.is_link_local or address.is_reserved or address.is_multicast or not address.is_global:
            raise ValueError("private or internal address not allowed: " + host)
    return url


def session_dir(session: str) -> Path:
    """One folder per session id; the id is hashed so nothing the caller sends can escape the store."""
    return STORE / hashlib.sha256(str(session).encode("utf-8")).hexdigest()[:24]


def format_elements(items: list[dict]) -> str:
    """The clickable things of the page as numbered lines a text-only model can act on: `[3] button "Sign in"`."""
    lines = []
    for item in items[:MAX_ELEMENTS]:
        label = re.sub(r"\s+", " ", str(item.get("label") or "")).strip()[:70]
        extra = (" -> " + str(item["href"])[:90]) if item.get("href") else ""
        lines.append(f'[{item.get("id")}] {item.get("role", "element")} "{label}"{extra}')
    return "\n".join(lines)


def clip_text(text: str, limit: int = MAX_TEXT) -> str:
    text = re.sub(r"\n{3,}", "\n\n", str(text or "")).strip()
    return text if len(text) <= limit else text[:limit] + "\n…(cut; scroll or ask for more)"


def format_visual(areas: list[dict], frames: int = 0) -> str:
    """Drawn areas (canvas / video / svg / iframe) hold no readable text: say where they are, so the model can click by x,y or ask for the outline."""
    lines = [f'{a.get("kind", "area")} at x={a.get("x")} y={a.get("y")} size {a.get("w")}x{a.get("h")}' for a in areas[:8]]
    if frames:
        lines.append(f"{frames} iframe(s) on the page: their content is not in the text above")
    return "\n".join(lines)


def meta_file(session: str) -> Path:
    return session_dir(session) / "meta.json"


def state_file(session: str) -> Path:
    return session_dir(session) / "state.json"


def save_meta(session: str, url: str, tabs: list[str] | None = None, active: int = 0) -> None:
    """Persist the active page and open tab URLs when a session hibernates."""
    folder = session_dir(session)
    folder.mkdir(parents=True, exist_ok=True)
    safe_tabs = [str(item)[:2000] for item in (tabs or [url]) if str(item).startswith(("http://", "https://", "about:"))][:12]
    meta_file(session).write_text(json.dumps({
        "url": str(url)[:2000], "tabs": safe_tabs or [str(url)[:2000]],
        "active": max(0, min(len(safe_tabs or [url]) - 1, int(active))), "saved": int(time.time()),
    }), encoding="utf-8")


def load_meta(session: str) -> dict:
    try:
        value = json.loads(meta_file(session).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


# JavaScript run in the page: number the interactive elements (also inside open shadow roots) and list the drawn areas that have no text to read.
INDEX_JS = """
() => {
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[onclick],[contenteditable=true]';
  const out = []; const visual = []; let id = 1; let frames = 0; let shadows = 0;
  const walk = (root) => {
    for (const el of root.querySelectorAll(sel)) {
      if (id > 60) break;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight * 3) continue;
      const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue;
      el.setAttribute('data-bid', String(id));
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'input:' + (el.type || 'text') : tag);
      const label = el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || '';
      out.push({ id: id++, role, label, href: tag === 'a' ? el.href : '', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
    for (const el of root.querySelectorAll('canvas,video,svg,iframe,embed,object')) {
      const r = el.getBoundingClientRect();
      if (el.tagName.toLowerCase() === 'iframe') frames++;
      if (r.width < 120 || r.height < 80 || r.bottom < 0 || r.top > innerHeight * 2 || visual.length >= 8) continue;
      visual.push({ kind: el.tagName.toLowerCase(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    for (const host of root.querySelectorAll('*')) if (host.shadowRoot) { shadows++; walk(host.shadowRoot); }
  };
  walk(document);
  return { items: out, visual, frames, shadows };
}
"""


# ---------------------------------------------------------------- getting a browser
def _env_with_libs() -> dict:
    env = dict(os.environ)
    libs = STORE / "libs" / "usr" / "lib" / "x86_64-linux-gnu"
    if libs.exists():
        env["LD_LIBRARY_PATH"] = str(libs) + ":" + str(STORE / "libs" / "lib" / "x86_64-linux-gnu") + ":" + env.get("LD_LIBRARY_PATH", "")
    env.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(STORE / "pw"))
    return env


def worker_launch_env() -> dict:
    """Environment for the worker's own Chromium: exactly what the launch test used (persistent library prefix + browsers path)."""
    return {k: v for k, v in _env_with_libs().items() if isinstance(v, str)}


def _run(cmd: list[str], timeout: int = 900, cwd: Path | None = None) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=_env_with_libs(), cwd=str(cwd) if cwd else None)
        return r.returncode, (r.stdout + r.stderr)[-1500:]
    except Exception as exc:  # noqa: BLE001
        return 1, f"{type(exc).__name__}: {exc}"


def fetch_libs_without_root() -> bool:
    """apt-get with private folders: update + download the .deb files, unpack them into STORE/libs. Works when we are not root."""
    work = STORE / "apt"
    for sub in ("lists/partial", "cache/archives/partial", "debs"):
        (work / sub).mkdir(parents=True, exist_ok=True)
    opts = [f"-oDir::State::Lists={work}/lists", f"-oDir::Cache={work}/cache", "-oDir::State::status=/var/lib/dpkg/status", "-oAPT::Sandbox::User=", "-oDebug::NoLocking=1"]
    code, out = _run(["apt-get", *opts, "update"], 300)
    _note(f"apt update rc={code} {out[-120:]}")
    fetched = 0
    for pkg in CHROMIUM_LIBS:
        code, out = _run(["apt-get", *opts, "download", pkg], 120, work / "debs")
        if code == 0:
            fetched += 1
        else:
            _note(f"download {pkg} rc={code}")
    for deb in sorted((work / "debs").glob("*.deb")):
        _run(["dpkg", "-x", str(deb), str(STORE / "libs")], 120)
        deb.unlink(missing_ok=True)
    _note(f"libs fetched: {fetched}/{len(CHROMIUM_LIBS)}")
    return fetched > 0


def _launch_test(channel: str | None = "chromium") -> tuple[bool, str]:
    """Test full Chromium first (new headless mode), then Playwright's headless-shell fallback."""
    launch = "    b = p.chromium.launch(" + (f"channel={channel!r}, " if channel else "") + "args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])\n"
    code, out = _run(["python3", "-c",
                      "from playwright.sync_api import sync_playwright\n"
                      "with sync_playwright() as p:\n"
                      + launch +
                      "    pg = b.new_page(); pg.set_content('<h1>ok</h1>'); print('LAUNCH_OK', pg.inner_text('h1')); b.close()\n"], 120)
    return "LAUNCH_OK" in out, out


def _launch_preferred() -> tuple[bool, str, str]:
    """Prefer the full Chromium executable; fall back to the headless-shell binary only if required."""
    ok, out = _launch_test("chromium")
    if ok:
        _note("browser launch mode: full Chromium channel")
        return True, out, "chromium"
    _note("full Chromium channel failed: " + re.sub(r"[╔╗╚╝║═]+", " ", out)[-300:])
    ok, out = _launch_test(None)
    if ok:
        _note("browser launch mode: Playwright headless-shell fallback")
        return True, out, "headless-shell"
    return False, out, ""

def _probe_sandbox() -> None:
    """Record (never rely on) whether Bubblewrap works here: it needs unprivileged user namespaces, which many container hosts forbid. Chromium keeps its own flags either way."""
    exe = shutil.which("bwrap")
    if not exe:
        _note("bwrap: not installed (Chromium runs with --no-sandbox inside the Studio container)")
        return
    code, out = _run([exe, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "true"], 20)
    _note("bwrap: " + ("works (user namespaces allowed)" if code == 0 else "present but refused: " + out[-120:]))


DOWNLOAD_HOSTS = ["https://cdn.npmmirror.com/binaries/playwright", ""]         # "" = Playwright's own host
PER_HOST_SECONDS = 420


def have_chromium() -> bool:
    return any((STORE / "pw").glob("chromium-*/chrome-linux*/chrome")) or any((STORE / "pw").glob("chromium_headless_shell-*/*/headless_shell"))


def download_chromium() -> bool:
    """`playwright install chromium` through each download host in turn; a host that does not answer costs PER_HOST_SECONDS, not 15 minutes."""
    chosen = os.environ.get("PLAYWRIGHT_DOWNLOAD_HOST", "").strip()
    hosts = ([chosen] if chosen else []) + list(DOWNLOAD_HOSTS)          # an explicit choice first, then the mirror, then Playwright's own host
    seen: set[str] = set()
    for host in hosts:
        if host in seen:
            continue
        seen.add(host)
        env_host = {"PLAYWRIGHT_DOWNLOAD_HOST": host} if host else {}
        os.environ.pop("PLAYWRIGHT_DOWNLOAD_HOST", None)
        os.environ.update(env_host)
        code, out = _run(["python3", "-m", "playwright", "install", "chromium"], PER_HOST_SECONDS)
        _note(f"chromium download via {host or 'playwright host'} rc={code} {out[-100:]}")
        if code == 0 and have_chromium():
            return True
    os.environ.pop("PLAYWRIGHT_DOWNLOAD_HOST", None)
    return have_chromium()


def install_libs_as_root() -> bool:
    """We are root inside the Studio container: install the libraries Chromium needs the normal way."""
    if not (hasattr(os, "geteuid") and os.geteuid() == 0):
        return False
    uc, uo = _run(["apt-get", "update"], 240)                  # the image's package lists are stale: without this every install 404s (live probe: rc=100, 404 Not Found)
    _note(f"apt-get update rc={uc} {uo[-80:]}")
    code, out = _run(["apt-get", "install", "-y", "--no-install-recommends", *CHROMIUM_LIBS], 600)
    _note(f"apt-get install libs rc={code} {out[-100:]}")
    if code != 0:                                    # one missing package name must not block the rest
        ok = 0
        for pkg in CHROMIUM_LIBS:
            c, _ = _run(["apt-get", "install", "-y", "--no-install-recommends", pkg], 180)
            ok += 1 if c == 0 else 0
        _note(f"apt-get install one by one: {ok}/{len(CHROMIUM_LIBS)}")
        return ok > 0
    return True


def bootstrap() -> bool:
    with _LOCK:
        if STATE["phase"] in ("ready", "installing"):
            return STATE["phase"] == "ready"
        STATE["phase"] = "installing"
    try:
        STORE.mkdir(parents=True, exist_ok=True)
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(STORE / "pw")
        if not have_chromium():
            download_chromium()
        else:
            _note("chromium already in the persistent folder")
        ok, out, channel = _launch_preferred()
        if not ok and re.search(r"playwright install|Executable doesn't exist", out):
            # a Chromium of another revision is in the persistent folder (the playwright package changed): fetch the one this package wants
            _note("playwright wants another chromium revision: downloading it")
            for old in list((STORE / "pw").glob("chromium*")):
                shutil.rmtree(old, ignore_errors=True)
            download_chromium()
            ok, out, channel = _launch_preferred()
        if not ok:
            _note("first launch failed: " + re.sub(r"[╔╗╚╝║═]+", " ", out)[-1000:])
            if have_chromium():
                fixed = install_libs_as_root() or fetch_libs_without_root()
                if fixed:
                    os.environ["LD_LIBRARY_PATH"] = _env_with_libs().get("LD_LIBRARY_PATH", "")
                    ok, out, channel = _launch_preferred()
                    _note(("second launch ok via " + channel if ok else "second launch failed: " + out[-1000:]))
        _probe_sandbox()
        if ok:
            lib_path = _env_with_libs().get("LD_LIBRARY_PATH", "")
            if lib_path:
                os.environ["LD_LIBRARY_PATH"] = lib_path      # every later in-process launch sees the same libraries the test saw
        with _LOCK:
            STATE["phase"] = "ready" if ok else "unavailable"
            STATE["error"] = "" if ok else out[-300:]
            STATE["chromium"] = "playwright chromium" if ok else ""
            STATE["channel"] = channel if ok else ""
        return ok
    except Exception as exc:  # noqa: BLE001
        with _LOCK:
            STATE["phase"] = "unavailable"
            STATE["error"] = f"{type(exc).__name__}: {exc}"[:1600]
        return False


# ---------------------------------------------------------------- the worker (Playwright's sync API is bound to one thread)
class _Worker(threading.Thread):
    """ONE Chromium process for the whole Studio; every user+model session is a separate BrowserContext (own cookies, storage, history) inside it.
    A session that is idle is hibernated: its cookies / localStorage and the page address are written to /mnt/workspace and the context is closed (0 MB while away);
    the next call restores it in a fresh context and goes back to the same page."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="browser-worker")
        self.jobs: "queue.Queue[tuple[dict, queue.Queue]]" = queue.Queue()
        self.pages: dict[str, tuple] = {}              # session -> (context, page, last_used)
        self.browser = None
        self.resumed: set[str] = set()
        self.console_logs: dict[str, list[str]] = {}
        self.network_logs: dict[str, list[str]] = {}

    def run(self) -> None:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            while True:
                try:
                    job, reply = self.jobs.get(timeout=30)
                except queue.Empty:
                    self._reap()
                    continue
                try:
                    reply.put(self._do(p, job))
                except Exception as exc:  # noqa: BLE001
                    reply.put({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:1800]}"})
                self._reap()

    def _browser(self, p):
        if self.browser is not None:
            try:
                if self.browser.is_connected():
                    return self.browser
            except Exception:  # noqa: BLE001
                pass
            self.pages.clear()                          # the browser died: its contexts are gone, sessions restore from disk on the next call
        # The same environment the bootstrap's launch test used (2026-11-04 fix): the libraries Chromium needs may live in the persistent
        # STORE/libs prefix from an earlier boot. The test subprocess saw them through _env_with_libs(), but this in-process launch used the
        # bare os.environ and Chromium died at start ("Target page, context or browser has been closed") although the status said ready.
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"], "env": worker_launch_env()}
        channel = STATE.get("channel")
        if channel == "chromium":
            launch_options["channel"] = "chromium"
        try:
            self.browser = p.chromium.launch(**launch_options)
        except Exception as exc:
            _note("worker browser launch failed (" + str(channel or "headless-shell") + "): " + str(exc)[-1400:])
            raise
        return self.browser

    def _watch_page(self, session: str, page) -> None:
        console_items = self.console_logs.setdefault(session, [])
        network_items = self.network_logs.setdefault(session, [])

        def safe_url_label(raw: str) -> str:
            parsed = urlparse(str(raw))
            return (parsed.scheme + "://" + parsed.netloc + parsed.path)[:300] if parsed.scheme and parsed.netloc else str(raw)[:300]

        def add_console(kind: str, message: str) -> None:
            cleaned = re.sub(r"(?i)(bearer\s+)[^\s]+", r"\1[redacted]", str(message))
            cleaned = re.sub(r"(?i)(token|key|secret|password)=([^&\s]+)", r"\1=[redacted]", cleaned)
            console_items.append(f"{kind}: {cleaned[:500]}")
            del console_items[:-40]

        def add_network(label: str) -> None:
            network_items.append(label[:500])
            del network_items[:-40]

        page.on("console", lambda msg: add_console("console", msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda error: add_console("pageerror", str(error)))
        page.on("requestfailed", lambda request: add_network("failed " + request.method + " " + safe_url_label(request.url)))
        page.on("response", lambda response: add_network(str(response.status) + " " + safe_url_label(response.url)) if response.status >= 400 else None)

    def _tabs(self, ctx, active) -> list[dict]:
        result = []
        for index, page in enumerate([item for item in ctx.pages if not item.is_closed()]):
            try:
                result.append({"index": index, "active": page == active, "url": page.url[:500], "title": page.title()[:120]})
            except Exception:
                result.append({"index": index, "active": page == active, "url": "", "title": ""})
        return result

    def _save(self, session: str, ctx, page) -> None:
        try:
            ctx.storage_state(path=str(state_file(session)))
            pages = [item for item in ctx.pages if not item.is_closed()]
            urls = [item.url for item in pages]
            active = pages.index(page) if page in pages else 0
            save_meta(session, page.url, urls, active)
        except Exception:  # noqa: BLE001
            pass

    def _hibernate(self, session: str) -> None:
        got = self.pages.pop(session, None)
        if not got:
            return
        self._save(session, got[0], got[1])
        try:
            got[0].close()
        except Exception:  # noqa: BLE001
            pass

    def _reap(self) -> None:
        now = time.time()
        for sid, (_ctx, _page, used) in list(self.pages.items()):
            if now - used > IDLE_SECONDS:
                self._hibernate(sid)

    def _page(self, p, session: str):
        got = self.pages.get(session)
        if got:
            self.pages[session] = (got[0], got[1], time.time())
            return got[1]
        if len(self.pages) >= MAX_SESSIONS:
            self._hibernate(min(self.pages, key=lambda s: self.pages[s][2]))
        browser = self._browser(p)
        state = state_file(session)
        options: dict = {"viewport": VIEWPORT}
        if state.exists():
            options["storage_state"] = str(state)
        ctx = browser.new_context(**options)
        ctx.route("**/*", lambda route: _guard_route(route, session))
        first = ctx.new_page()
        first.set_default_timeout(25000)
        self._watch_page(session, first)
        pages = [first]
        meta = load_meta(session)
        urls = meta.get("tabs") if isinstance(meta.get("tabs"), list) else []
        if not urls and meta.get("url"):
            urls = [meta.get("url")]
        if urls and str(urls[0]).startswith(("http://", "https://")):
            try:
                first.goto(safe_url(str(urls[0]), session), wait_until="domcontentloaded", timeout=20000)
            except Exception:  # noqa: BLE001
                pass
        for raw_url in urls[1:12]:
            try:
                tab = ctx.new_page()
                tab.set_default_timeout(25000)
                self._watch_page(session, tab)
                if str(raw_url).startswith(("http://", "https://")):
                    tab.goto(safe_url(str(raw_url), session), wait_until="domcontentloaded", timeout=20000)
                pages.append(tab)
            except Exception:  # noqa: BLE001
                continue
        active_index = max(0, min(len(pages) - 1, int(meta.get("active", 0) or 0)))
        page = pages[active_index]
        if state.exists() and urls:
            self.resumed.add(session)
        self.pages[session] = (ctx, page, time.time())
        return page

    def _snapshot(self, page, shot: bool) -> dict:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        found = page.evaluate(INDEX_JS)
        items = found.get("items", []) if isinstance(found, dict) else found
        out = {
            "ok": True, "url": page.url, "title": page.title()[:160],
            "text": clip_text(page.inner_text("body", timeout=5000)),
            "elements": format_elements(items),
        }
        if isinstance(found, dict):
            visual = format_visual(found.get("visual", []), int(found.get("frames", 0) or 0))
            if visual:
                out["visual"] = visual
        if shot:
            out["screenshot_b64"] = base64.b64encode(page.screenshot(type="jpeg", quality=60)).decode()
        return out

    def _do(self, p, job: dict) -> dict:
        action = str(job.get("action") or "")
        session = str(job.get("session") or "default")
        page = self._page(p, session)
        ctx = self.pages[session][0]
        mutating = True

        if action == "tabs":
            reply = self._snapshot(page, bool(job.get("screenshot")))
            reply["tabs"] = self._tabs(ctx, page)
            return reply
        if action == "console":
            return {"ok": True, "url": page.url, "console_errors": self.console_logs.get(session, [])[-30:]}
        if action == "network":
            return {"ok": True, "url": page.url, "network_errors": self.network_logs.get(session, [])[-30:]}
        if action == "new_tab":
            page = ctx.new_page()
            page.set_default_timeout(25000)
            self._watch_page(session, page)
            self.pages[session] = (ctx, page, time.time())
        elif action == "switch_tab":
            pages = [item for item in ctx.pages if not item.is_closed()]
            index = max(0, min(len(pages) - 1, int(job.get("index", 0) or 0)))
            if not pages:
                page = ctx.new_page()
                page.set_default_timeout(25000)
                self._watch_page(session, page)
            else:
                page = pages[index]
            self.pages[session] = (ctx, page, time.time())
        elif action == "close_tab":
            pages = [item for item in ctx.pages if not item.is_closed()]
            if len(pages) <= 1:
                page.goto("about:blank")
            else:
                page.close()
                remaining = [item for item in ctx.pages if not item.is_closed()]
                page = remaining[min(len(remaining) - 1, max(0, int(job.get("index", 0) or 0)))]
            self.pages[session] = (ctx, page, time.time())
        elif action == "open":
            page.goto(safe_url(job.get("url", ""), session), wait_until="domcontentloaded", timeout=30000)
        elif action == "click":
            if job.get("id"):
                page.click(f'[data-bid="{int(job["id"])}"]', timeout=10000)
            elif job.get("selector"):
                page.locator(str(job["selector"])[:300]).click(timeout=10000)
            else:
                page.mouse.click(int(job.get("x", 0)), int(job.get("y", 0)))
        elif action == "type":
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else (str(job["selector"])[:300] if job.get("selector") else None)
            if target:
                page.fill(target, str(job.get("text", ""))[:2000], timeout=10000)
            else:
                page.keyboard.type(str(job.get("text", ""))[:2000])
            if job.get("enter"):
                page.keyboard.press("Enter")
        elif action == "select":
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else str(job.get("selector") or "")[:300]
            if not target:
                return {"ok": False, "error": "select requires element id or selector"}
            page.locator(target).select_option(str(job.get("value", ""))[:200], timeout=10000)
        elif action in ("check", "uncheck", "hover"):
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else str(job.get("selector") or "")[:300]
            if not target:
                return {"ok": False, "error": action + " requires element id or selector"}
            if action == "check":
                page.locator(target).check(timeout=10000)
            elif action == "uncheck":
                page.locator(target).uncheck(timeout=10000)
            else:
                page.locator(target).hover(timeout=10000)
        elif action == "upload":
            import computer_box
            source = computer_box.safe_path(session, str(job.get("file_path") or ""))
            if source.is_symlink() or not source.is_file():
                return {"ok": False, "error": "upload source must be a regular file inside this computer session"}
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else str(job.get("selector") or "")[:300]
            if not target:
                return {"ok": False, "error": "upload requires a file-input element id or selector"}
            if source.stat().st_size > 128 * 1024 * 1024:
                return {"ok": False, "error": "upload is limited to 128 MB"}
            page.locator(target).set_input_files(str(source), timeout=20000)
        elif action == "download":
            import computer_box
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else str(job.get("selector") or "")[:300]
            if not target:
                return {"ok": False, "error": "download requires an element id or selector"}
            with page.expect_download(timeout=30000) as waiting:
                page.locator(target).click(timeout=10000)
            download = waiting.value
            temp_download = download.path()
            if temp_download and Path(temp_download).stat().st_size > 128 * 1024 * 1024:
                return {"ok": False, "error": "download is larger than the 128 MB per-file transfer limit"}
            relative = str(job.get("output_path") or ("Downloads/" + Path(download.suggested_filename or "download.bin").name))[:500]
            dest = computer_box.safe_path(session, relative)
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            parent = dest.parent
            home = computer_box.session_home(session).resolve()
            while parent != home and home in parent.parents:
                os.chown(parent, computer_box.session_uid(session), computer_box.session_uid(session))
                parent = parent.parent
            download.save_as(str(dest))
            try:
                os.chown(dest, computer_box.session_uid(session), computer_box.session_uid(session))
                os.chmod(dest, 0o600)
            except OSError:
                pass
            downloaded = {"path": str(dest.relative_to(computer_box.session_home(session))), "name": Path(download.suggested_filename or dest.name).name, "bytes": dest.stat().st_size}
        elif action == "press":
            page.keyboard.press(str(job.get("key", "Enter"))[:30])
        elif action == "scroll":
            page.mouse.wheel(0, max(-4000, min(4000, int(job.get("dy", 600)))))
            page.wait_for_timeout(300)
            mutating = False
        elif action == "back":
            page.go_back(wait_until="domcontentloaded", timeout=15000)
        elif action == "wait":
            wanted = str(job.get("text", ""))[:200]
            seconds = max(1, min(20, int(job.get("seconds", 8) or 8)))
            if wanted:
                page.get_by_text(wanted).first.wait_for(timeout=seconds * 1000)
            else:
                page.wait_for_timeout(seconds * 1000)
            mutating = False
        elif action == "aria":
            snapshot = clip_text(page.locator("body").aria_snapshot(timeout=8000), ARIA_LIMIT)
            reply = self._snapshot(page, False)
            reply["outline"] = snapshot
            reply["tabs"] = self._tabs(ctx, page)
            return reply
        elif action not in ("look", ""):
            return {"ok": False, "error": "unknown action " + action[:30]}
        else:
            mutating = False

        self.pages[session] = (ctx, page, time.time())
        reply = self._snapshot(page, bool(job.get("screenshot")))
        reply["tabs"] = self._tabs(ctx, page)
        if action == "download":
            reply["download"] = downloaded
        if action == "upload":
            reply["uploaded"] = str(job.get("file_path") or "")[:300]
        if session in self.resumed:
            self.resumed.discard(session)
            reply["resumed"] = True
        if mutating:
            self._save(session, ctx, page)
        return reply


def _guard_route(route, session: str = "") -> None:
    """Every request, redirect and subresource is checked against the owning session."""
    try:
        safe = safe_url(route.request.url, session)
    except Exception:  # noqa: BLE001
        route.abort()
        return
    if safe != route.request.url:
        route.continue_(url=safe)
    else:
        route.continue_()


_WORKER: _Worker | None = None


def _worker() -> _Worker:
    global _WORKER
    with _LOCK:
        if _WORKER is None or not _WORKER.is_alive():
            _WORKER = _Worker()
            _WORKER.start()
        return _WORKER


# ---------------------------------------------------------------- the two API entry points
def api_browser_status(_unused: str = "") -> str:
    with _LOCK:
        return json.dumps({"browser": {k: STATE[k] for k in ("phase", "error", "chromium", "channel", "steps")},
                           "sessions": len(_WORKER.pages) if _WORKER else 0, "root": os.geteuid() == 0 if hasattr(os, "geteuid") else None}, ensure_ascii=False)


def api_browser_do(body: str) -> str:
    try:
        text = str(body or "")
        if text.startswith("b64:"):                        # see computer_box.unwrap_body: the gateway's request filter rejects some plain text
            text = base64.b64decode(text[4:].encode("ascii"), validate=True).decode("utf-8")
        job = json.loads(text or "{}")
    except ValueError:
        return json.dumps({"ok": False, "error": "bad request"})
    if STATE["phase"] != "ready":
        if STATE["phase"] == "not started":
            threading.Thread(target=bootstrap, daemon=True, name="browser-bootstrap").start()
        return json.dumps({"ok": False, "error": f"the browser is {STATE['phase']}; try again in a few minutes", "phase": STATE["phase"]})
    reply: "queue.Queue" = queue.Queue()
    _worker().jobs.put((job, reply))
    try:
        return json.dumps(reply.get(timeout=75), ensure_ascii=False)
    except queue.Empty:
        return json.dumps({"ok": False, "error": "the browser took too long"})
