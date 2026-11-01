"""A free headless browser for one model: the part of "the computer" that Daytona's desktop used to give (real pages with JavaScript, clicking, typing).

Runs inside the model's OWN media Studio (free 2 vCPU / 8 GB CPU): nothing is shared with another model, nothing is paid, nothing leaves the account.
The app server calls it through the Studio's Gradio API (`browser_do`, `browser_status`); a session is one user of one model (the app derives the id).

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
VIEWPORT = {"width": 1024, "height": 700}
MAX_TEXT = 6000
MAX_ELEMENTS = 40
IDLE_SECONDS = 600
MAX_SESSIONS = 6                 # contexts of ONE shared Chromium cost ~25 MB each (a process per session cost ~500 MB), so several fit in 8 GB
ARIA_LIMIT = 5000

# Debian/Ubuntu packages Chromium needs; fetched (not installed) only when it fails to start for a missing library.
CHROMIUM_LIBS = [
    "libnss3", "libnspr4", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0", "libxcomposite1", "libxdamage1",
    "libxfixes3", "libxrandr2", "libgbm1", "libpango-1.0-0", "libcairo2", "libasound2", "libx11-6", "libxcb1", "libxext6", "libdbus-1-3",
    "libglib2.0-0", "libatspi2.0-0", "libx11-xcb1", "libxrender1", "libfontconfig1", "libfreetype6", "fonts-liberation",
]

STATE: dict = {"phase": "not started", "steps": [], "error": "", "chromium": ""}
_LOCK = threading.RLock()


def _note(step: str) -> None:
    with _LOCK:
        STATE["steps"] = (STATE["steps"] + [step[:240]])[-30:]


# ---------------------------------------------------------------- pure helpers (unit-tested)
def safe_url(raw: str) -> str:
    """http(s) only, and never a private / loopback / link-local address (the Studio must not be used to reach its own network)."""
    url = str(raw or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("only http(s) addresses are allowed")
    host = parsed.hostname
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError("cannot resolve " + host) from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
            raise ValueError("address not allowed: " + host)
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


def save_meta(session: str, url: str) -> None:
    """Remember where the session was, so a hibernated session comes back to the same page."""
    folder = session_dir(session)
    folder.mkdir(parents=True, exist_ok=True)
    meta_file(session).write_text(json.dumps({"url": str(url)[:2000], "saved": int(time.time())}), encoding="utf-8")


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


def _launch_test() -> tuple[bool, str]:
    """Start Chromium once in a child process (so a missing library cannot crash the Studio) and report why it failed."""
    code, out = _run(["python3", "-c",
                      "from playwright.sync_api import sync_playwright\n"
                      "with sync_playwright() as p:\n"
                      "    b = p.chromium.launch(args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])\n"
                      "    pg = b.new_page(); pg.set_content('<h1>ok</h1>'); print('LAUNCH_OK', pg.inner_text('h1')); b.close()\n"], 120)
    return "LAUNCH_OK" in out, out


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
        ok, out = _launch_test()
        if not ok:
            _note("first launch failed: " + out[-300:])
            if have_chromium():
                fixed = install_libs_as_root() or fetch_libs_without_root()
                if fixed:
                    os.environ["LD_LIBRARY_PATH"] = _env_with_libs().get("LD_LIBRARY_PATH", "")
                    ok, out = _launch_test()
                    _note(("second launch ok" if ok else "second launch failed: " + out[-300:]))
        _probe_sandbox()
        with _LOCK:
            STATE["phase"] = "ready" if ok else "unavailable"
            STATE["error"] = "" if ok else out[-300:]
            STATE["chromium"] = "playwright chromium" if ok else ""
        return ok
    except Exception as exc:  # noqa: BLE001
        with _LOCK:
            STATE["phase"] = "unavailable"
            STATE["error"] = f"{type(exc).__name__}: {exc}"[:300]
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
                    reply.put({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"})
                self._reap()

    def _browser(self, p):
        if self.browser is not None:
            try:
                if self.browser.is_connected():
                    return self.browser
            except Exception:  # noqa: BLE001
                pass
            self.pages.clear()                          # the browser died: its contexts are gone, sessions restore from disk on the next call
        self.browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
        return self.browser

    def _save(self, session: str, ctx, page) -> None:
        try:
            ctx.storage_state(path=str(state_file(session)))
            save_meta(session, page.url)
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
        ctx.route("**/*", _guard_route)
        page = ctx.new_page()
        page.set_default_timeout(25000)
        self.pages[session] = (ctx, page, time.time())
        last = load_meta(session).get("url")
        if last and state.exists():
            try:
                page.goto(safe_url(last), wait_until="domcontentloaded", timeout=20000)
                self.resumed.add(session)
            except Exception:  # noqa: BLE001
                pass
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
            out["screenshot_b64"] = base64.b64encode(page.screenshot(type="jpeg", quality=55)).decode()
        return out

    def _do(self, p, job: dict) -> dict:
        action = str(job.get("action") or "")
        session = str(job.get("session") or "default")
        page = self._page(p, session)
        mutating = True
        if action == "open":
            page.goto(safe_url(job.get("url", "")), wait_until="domcontentloaded", timeout=30000)
        elif action == "click":
            if job.get("id"):
                page.click(f'[data-bid="{int(job["id"])}"]', timeout=10000)
            else:
                page.mouse.click(int(job.get("x", 0)), int(job.get("y", 0)))
        elif action == "type":
            target = f'[data-bid="{int(job["id"])}"]' if job.get("id") else None
            if target:
                page.fill(target, str(job.get("text", ""))[:2000], timeout=10000)
            else:
                page.keyboard.type(str(job.get("text", ""))[:2000])
            if job.get("enter"):
                page.keyboard.press("Enter")
        elif action == "press":
            page.keyboard.press(str(job.get("key", "Enter"))[:30])
        elif action == "scroll":
            page.mouse.wheel(0, max(-4000, min(4000, int(job.get("dy", 600)))))
            page.wait_for_timeout(300)
            mutating = False
        elif action == "back":
            page.go_back(wait_until="domcontentloaded", timeout=15000)
        elif action == "wait":
            # single-page apps render after the load event: wait until some text shows up (or a time passes), then read the page
            wanted = str(job.get("text", ""))[:200]
            seconds = max(1, min(20, int(job.get("seconds", 8) or 8)))
            if wanted:
                page.get_by_text(wanted).first.wait_for(timeout=seconds * 1000)
            else:
                page.wait_for_timeout(seconds * 1000)
            mutating = False
        elif action == "aria":
            # the page as the browser's accessibility outline (roles + names), for pages whose numbered list is not enough
            snapshot = clip_text(page.locator("body").aria_snapshot(timeout=8000), ARIA_LIMIT)
            reply = self._snapshot(page, False)
            reply["outline"] = snapshot
            return reply
        elif action not in ("look", ""):
            return {"ok": False, "error": "unknown action " + action[:30]}
        else:
            mutating = False
        reply = self._snapshot(page, bool(job.get("screenshot")))
        if session in self.resumed:
            self.resumed.discard(session)
            reply["resumed"] = True
        if mutating:
            ctx = self.pages[session][0]
            self._save(session, ctx, page)
        return reply


def _guard_route(route) -> None:
    """Every request the page makes (not only the first address) is checked: no private network, http(s) only."""
    try:
        safe_url(route.request.url)
    except Exception:  # noqa: BLE001
        route.abort()
        return
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
        return json.dumps({"browser": {k: STATE[k] for k in ("phase", "error", "chromium", "steps")},
                           "sessions": len(_WORKER.pages) if _WORKER else 0, "root": os.geteuid() == 0 if hasattr(os, "geteuid") else None}, ensure_ascii=False)


def api_browser_do(body: str) -> str:
    try:
        job = json.loads(body or "{}")
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
