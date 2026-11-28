"""Real executors for the tool registry, and an honest coverage table. A registry entry is only a NAME and a type check; this module is where tools actually run:
confined to one workspace, programs as argument lists (never a shell), scrubbed environment (no secrets leak into a command), time and size caps, public-internet
fetches through `netguard`, and connector-backed tools (GitHub, mail, search, brokers) through credentials the OWNER supplies at run time (never stored in code).

`coverage()` classifies EVERY registry tool: `executor` (runs here, tested), `agent` (handled by the agent loop), `connector` (runs when the owner has connected the service),
`model` (needs the trained model or a media codec) or `runtime` (needs a browser/desktop the host provides). Nothing is left unclassified, and nothing is described as
working unless its class says so."""
from __future__ import annotations

import html
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import finance, netguard, tools
from .audit import AuditLog, EmergencyStop
from .fileops import FileError, Workspace, run_file_tool

ALLOWED_PROGRAMS = {"python", "python3", "pip", "pip3", "pytest", "ruff", "black", "mypy", "node", "npm", "npx", "yarn", "pnpm", "tsc", "git", "make", "cargo", "go", "rustc",
                    "ls", "cat", "head", "tail", "wc", "grep", "rg", "sort", "uniq", "diff", "echo", "pwd", "mkdir", "cp", "mv", "touch", "rm", "tar", "unzip", "zip",
                    "jq", "tree", "du", "df", "which", "date"}
# Deliberately absent: curl / wget (the internet goes through `netguard`), awk / sed / find / xargs / env / sh (they can run other programs). This list is a convenience filter, NOT the
# security boundary: `python` can do anything inside its container. The boundary is the container the host runs this in (no secrets inside, no private network, resource limits).
MAX_OUT = 20_000
SAFE_ENV = ("PATH", "LANG", "LC_ALL", "TZ", "TMPDIR")


@dataclass
class Limits:
    command_seconds: int = 90
    job_seconds: int = 3600
    download_bytes: int = 64 * 1024 * 1024
    steps_per_task: int = 200


@dataclass
class Runtime:
    root: Path
    audit: AuditLog | None = None
    stop: EmergencyStop | None = None
    limits: Limits = field(default_factory=Limits)
    secrets: Callable[[str], str | None] = lambda name: None          # name -> value, supplied by the owner's secret store at run time (the model never sees the value)
    connectors: dict[str, Callable[..., object]] = field(default_factory=dict)      # server -> callable(tool, arguments) for MCP-style connectors
    transport: Callable[..., tuple[int, dict, bytes, str]] = netguard.fetch         # swapped in tests
    dry_run_installs: bool = False
    jobs: dict = field(default_factory=dict)
    delegate: Callable[[str, list, int], str] | None = None          # (task, tool names, step budget) -> the sub-agent's summary; built on orchestrator.Orchestrator by the host

    def __post_init__(self) -> None:
        self.root = Path(self.root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.ws = Workspace(self.root)


# ------------------------------------------------------------------ helpers
def _cut(text: str, n: int = MAX_OUT) -> str:
    return text if len(text) <= n else text[: n // 2] + f"\n... [{len(text) - n} characters cut] ...\n" + text[-n // 2:]


def _env() -> dict:
    return {k: os.environ[k] for k in SAFE_ENV if k in os.environ} | {"HOME": str(Path.home()) if False else "/tmp", "PYTHONDONTWRITEBYTECODE": "1"}


def run_argv(rt: Runtime, argv: list[str], cwd: str = ".", timeout: int | None = None) -> tuple[bool, str]:
    if not argv:
        return False, "empty command"
    prog = Path(argv[0]).name
    if prog not in ALLOWED_PROGRAMS or ("/" in argv[0] and prog not in ("python", "python3") and Path(argv[0]).resolve() != Path(shutil.which(prog) or "/nonexistent").resolve()):
        return False, f"{prog}: this program is not on the allowed list"
    if prog in ("python", "python3"):
        argv = [sys.executable] + argv[1:]                            # the interpreter this runtime itself runs on (same installed libraries)
    if not shutil.which(argv[0]):
        return False, f"{prog}: not installed on this computer"
    work = rt.ws.path(cwd or ".")
    for a in argv[1:]:                                               # an argument that names a path must not leave the workspace
        if a.startswith("/") and not a.startswith(("/dev/null", "/tmp")) or re.search(r"(^|/)\.\.(/|$)", a):
            return False, f"argument {a!r} leaves the workspace"
    try:
        r = subprocess.run(argv, cwd=work, capture_output=True, text=True, timeout=timeout or rt.limits.command_seconds, env=_env(), stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return False, f"timed out after {timeout or rt.limits.command_seconds}s: run it as a background job (computer_job)"
    except OSError as exc:
        return False, str(exc)
    out = _cut((r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else ""))
    return r.returncode == 0, f"exit {r.returncode}\n{out}"


def _split(command: str) -> list[str]:
    """One program and its arguments. There is no shell, so `;`, `|`, `&&`, `$(...)` and redirections are inert text, never operators (chain steps with computer_batch)."""
    return shlex.split(command)


def _html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", html.unescape(raw))).strip()


# ------------------------------------------------------------------ computer / worker / dev
def _computer(rt: Runtime, name: str, a: dict) -> tuple[bool, str]:
    ws = rt.ws
    if name in ("computer_run", "sandbox_exec"):
        return run_argv(rt, _split(a["command"]), a.get("cwd", "."), a.get("timeout"))
    if name in ("computer_read", "sandbox_read_file"):
        return True, ws.read_text(a["path"], int(a.get("start", 1)), int(a.get("lines", 200)))
    if name in ("computer_write", "sandbox_write_file"):
        return True, ws.write_text(a["path"], a["content"])
    if name in ("computer_edit", "sandbox_edit_file"):
        return True, ws.edit_text(a["path"], a["old"], a["new"])
    if name in ("computer_search", "sandbox_search"):
        pat = re.compile(a["pattern"])
        base = ws.path(a.get("path", "."))
        hits = []
        for f in sorted(base.rglob(a.get("glob", "*")) if base.is_dir() else [base]):
            if f.is_file() and ".git" not in f.parts and f.stat().st_size < 2_000_000:
                try:
                    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                        if pat.search(line):
                            hits.append(f"{f.relative_to(ws.root)}:{i}: {line[:200]}")
                except (UnicodeDecodeError, OSError):
                    continue
            if len(hits) >= 200:
                break
        return True, "\n".join(hits) or "no matches"
    if name == "computer_patch":
        patch = ws.root / ".qalam_patch.diff"
        patch.write_text(a["diff"], encoding="utf-8")
        try:
            return run_argv(rt, ["git", "apply", "--unsafe-paths=false" if False else "--whitespace=nowarn", str(patch.relative_to(ws.root))], a.get("cwd", "."))
        finally:
            patch.unlink(missing_ok=True)
    if name in ("computer_tools", "computer_apps"):
        return True, json.dumps({p: bool(shutil.which(p)) for p in sorted(ALLOWED_PROGRAMS)})
    if name == "computer_job":
        act = a["action"]
        if act == "start":
            argv = _split(a["command"])
            log = ws.root / f".job_{len(rt.jobs) + 1}.log"
            ok, why = (True, "")
            if Path(argv[0]).name not in ALLOWED_PROGRAMS or not shutil.which(argv[0]):
                return False, f"{argv[0]}: not allowed or not installed"
            proc = subprocess.Popen(argv, cwd=ws.root, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=_env(), stdin=subprocess.DEVNULL)
            jid = f"job{len(rt.jobs) + 1}"
            rt.jobs[jid] = (proc, log, time.time())
            return True, jid
        if act == "list":
            return True, json.dumps({k: {"running": p.poll() is None, "exit": p.poll()} for k, (p, _, _) in rt.jobs.items()})
        jid = a.get("id", "")
        if jid not in rt.jobs:
            return False, "no such job"
        proc, log, _ = rt.jobs[jid]
        if act == "stop":
            proc.terminate()
        txt = log.read_text(encoding="utf-8", errors="replace").splitlines()[-int(a.get("tail", 80)):]
        return True, f"{'running' if proc.poll() is None else 'exit ' + str(proc.poll())}\n" + "\n".join(txt)
    if name == "computer_batch":
        out, ok = [], True
        for st in a["steps"]:
            ok, txt = run_tool(rt, st["tool"], st.get("args", {}))
            out.append(f"[{st['tool']}] {txt}")
            if not ok:
                break
        return ok, "\n".join(out)
    if name in ("build", "lint", "format", "run_tests", "computer_test"):
        default = {"build": "python -m compileall -q .", "lint": "ruff check .", "format": "ruff format --check .", "run_tests": "python -m pytest -q", "computer_test": "python -m pytest -q"}[name]
        return run_argv(rt, _split(a.get("command") or default), a.get("cwd", "."))
    if name == "install_packages":
        pk = a["packages"]
        if not isinstance(pk, list) or not 1 <= len(pk) <= 30 or not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9@/_.\-=<>~\[\],:]{1,100}", x) and not x.startswith("-") for x in pk):
            return False, "package names must be plain names (letters, digits, - _ . @ / and version specifiers), at most 30"
        mgr = a["manager"]
        cmd = {"pip": [sys.executable, "-m", "pip", "install", "--disable-pip-version-check"], "npm": ["npm", "install"], "cargo": ["cargo", "add"], "go": ["go", "get"], "apt": ["apt-get", "install", "-y"]}[mgr]
        if rt.audit:
            rt.audit.append("package_install", manager=mgr, packages=pk)
        if rt.dry_run_installs:
            return True, "dry run: " + " ".join(cmd + pk)
        if mgr == "apt":
            return False, "apt needs root: the host image installs system packages"
        try:
            r = subprocess.run(cmd + pk, cwd=rt.ws.root, capture_output=True, text=True, timeout=600, env={**_env(), "PATH": os.environ.get("PATH", "")})
        except (subprocess.TimeoutExpired, OSError) as exc:
            return False, str(exc)
        return r.returncode == 0, _cut(r.stdout + r.stderr, 4000)
    if name == "project_scaffold":
        return True, _scaffold(rt, a["kind"], a["name"], a.get("path", "."))
    if name == "package_release":
        fmt = a.get("format", "zip")
        if fmt not in ("zip", "tar.gz"):
            return False, f"{fmt} needs its own toolchain (apk / wheel / docker): not built here"
        return True, ws.archive_create([a["path"]], f"{Path(a['path']).name}.{fmt}", fmt)
    if name == "serve_preview":
        port = int(a.get("port", 8000))
        if not 1024 <= port <= 65535:
            return False, "port must be 1024..65535"
        proc = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ws.path(a.get("cwd", ".")), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rt.jobs[f"preview{port}"] = (proc, ws.root / ".preview.log", time.time())
        return True, f"serving on http://127.0.0.1:{port} (local only: it is not exposed to the internet)"
    return False, f"{name}: no executor"


def _scaffold(rt: Runtime, kind: str, name: str, path: str) -> str:
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_\-]{0,40}", name):
        raise FileError("project name: letters, digits, - _ (starting with a letter)")
    base = rt.ws.path(path) / name
    if base.exists():
        raise FileError(f"{name} already exists")
    pkg = name.replace("-", "_")
    files: dict[str, str]
    if kind in ("python", "library", "cli", "api", "bot"):
        files = {f"src/{pkg}/__init__.py": '__version__ = "0.1.0"\n', "tests/test_basic.py": f"from {pkg} import __version__\n\n\ndef test_version():\n    assert __version__\n",
                 "pyproject.toml": f'[project]\nname = "{name}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n\n[tool.pytest.ini_options]\npythonpath = ["src"]\n', "README.md": f"# {name}\n"}
        if kind == "cli":
            files[f"src/{pkg}/__main__.py"] = f'import sys\n\n\ndef main(argv=None):\n    print("{name}")\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n'
        if kind == "api":
            files[f"src/{pkg}/app.py"] = 'from http.server import BaseHTTPRequestHandler, HTTPServer\n\n\nclass H(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200)\n        self.end_headers()\n        self.wfile.write(b"ok")\n\n\nif __name__ == "__main__":\n    HTTPServer(("127.0.0.1", 8000), H).serve_forever()\n'
    elif kind == "node":
        files = {"package.json": json.dumps({"name": name, "version": "0.1.0", "scripts": {"test": "node --test"}}, indent=2) + "\n", "index.js": "console.log('hello');\n", "index.test.js": "const test = require('node:test');\nconst assert = require('node:assert');\ntest('ok', () => assert.ok(true));\n"}
    elif kind in ("web", "static"):
        files = {"index.html": f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title><link rel="stylesheet" href="style.css"><h1>{name}</h1><script src="app.js"></script></html>\n',
                 "style.css": "body{font-family:system-ui;margin:2rem}\n", "app.js": "console.log('ready');\n"}
    else:
        raise FileError(f"{kind} projects need their own SDK (Android Studio / Gradle): not scaffolded here")
    for rel, text in files.items():
        f = base / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    return f"created {kind} project {name} with {len(files)} files"


# ------------------------------------------------------------------ web
def _http(rt: Runtime, method: str, url: str, body: bytes | None = None, headers: dict | None = None) -> tuple[int, dict, bytes, str]:
    return rt.transport(url, method, body, headers)


def _web(rt: Runtime, name: str, a: dict) -> tuple[bool, str]:
    if name in ("fetch_page", "web_fetch"):
        st, hd, data, final = _http(rt, "GET", a["url"])
        text = data.decode("utf-8", "replace")
        if "html" in hd.get("Content-Type", hd.get("content-type", "")).lower() or text.lstrip().lower().startswith(("<!doctype", "<html")):
            text = _html_to_text(text)
        return 200 <= st < 400, f"[{st}] {final}\n" + text[: int(a.get("max_chars", 8000))]
    if name == "rss_read":
        st, _, data, _ = _http(rt, "GET", a["url"])
        root = ET.fromstring(data)
        items = [{"title": (i.findtext("title") or "").strip(), "link": (i.findtext("link") or i.find("{http://www.w3.org/2005/Atom}link").get("href") if i.find("{http://www.w3.org/2005/Atom}link") is not None else i.findtext("link") or "")}
                 for i in list(root.iter("item")) + list(root.iter("{http://www.w3.org/2005/Atom}entry"))][: int(a.get("limit", 20))]
        for i, it in zip(list(root.iter("item")) + list(root.iter("{http://www.w3.org/2005/Atom}entry")), items):
            if not it["title"]:
                it["title"] = (i.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
        return True, json.dumps(items, ensure_ascii=False)
    if name == "http_request":
        body = None if a.get("body") is None else json.dumps(a["body"]).encode()
        st, hd, data, final = _http(rt, a["method"], a["url"], body, {**(a.get("headers") or {}), **({"Content-Type": "application/json"} if body else {})})
        return 200 <= st < 400, f"[{st}] {final}\n" + _cut(data.decode("utf-8", "replace"), 8000)
    if name == "download_file":
        st, _, data, _ = rt.transport(a["url"], "GET", None, None, max_bytes=rt.limits.download_bytes)
        if not 200 <= st < 300:
            return False, f"HTTP {st}"
        dest = rt.ws.path(a["path"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True, f"saved {len(data)} bytes to {a['path']}"
    if name == "upload_file":
        data = rt.ws.path(a["path"], must_exist=True).read_bytes()
        st, _, resp, _ = _http(rt, "PUT", a["url"], data, {"Content-Type": "application/octet-stream"})
        return 200 <= st < 300, f"[{st}] " + resp[:500].decode("utf-8", "replace")
    if name == "form_submit":
        st, _, resp, _ = _http(rt, "POST", a["url"], urllib.parse.urlencode(a["fields"]).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
        return 200 <= st < 400, f"[{st}] " + _cut(resp.decode("utf-8", "replace"), 4000)
    if name == "send_email":
        import smtplib
        from email.message import EmailMessage
        host, user, pw = rt.secrets("smtp_host"), rt.secrets("smtp_user"), rt.secrets("smtp_password")
        if not (host and user and pw):
            return False, "no mail account is connected: the owner connects one (smtp_host, smtp_user, smtp_password) and the model never sees the password"
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = user, a["to"], a["subject"]
        msg.set_content(a["body"])
        for att in a.get("attachments") or []:
            p = rt.ws.path(att, must_exist=True)
            msg.add_attachment(p.read_bytes(), maintype="application", subtype="octet-stream", filename=p.name)
        with smtplib.SMTP(host, int(rt.secrets("smtp_port") or 587), timeout=30) as s:
            s.starttls()
            s.login(user, pw)
            s.send_message(msg)
        return True, f"sent to {a['to']}"
    return False, f"{name}: needs a connected search service or a browser (see coverage)"


# ------------------------------------------------------------------ github (REST, token supplied by the owner at run time)
_GH = "https://api.github.com"


def _gh(rt: Runtime, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    tok = rt.secrets("github_token")
    if not tok:
        raise FileError("GitHub is not connected: the owner supplies a token (github_token); the model never sees it")
    st, _, data, _ = rt.transport(_GH + path, method, None if body is None else json.dumps(body).encode(),
                                  {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
    try:
        return st, json.loads(data.decode("utf-8") or "null")
    except json.JSONDecodeError:
        return st, data.decode("utf-8", "replace")


def _github(rt: Runtime, name: str, a: dict) -> tuple[bool, str]:
    repo, q = a.get("repo", ""), urllib.parse.quote
    lim = int(a.get("limit", 50))
    ref = f"?ref={q(a['ref'])}" if a.get("ref") else ""
    table: dict[str, tuple[str, str, dict | None]] = {
        "github_whoami": ("GET", "/user", None), "github_list_repos": ("GET", f"/user/repos?per_page={min(lim, 100)}&sort=updated", None),
        "github_repo_info": ("GET", f"/repos/{repo}", None), "github_list_files": ("GET", f"/repos/{repo}/contents/{q(a.get('path', ''))}{ref}", None),
        "github_read_file": ("GET", f"/repos/{repo}/contents/{q(a.get('path', ''))}{ref}", None),
        "github_search_code": ("GET", f"/search/code?q={q(a.get('query', ''))}" + (f"+repo:{repo}" if repo else ""), None),
        "github_search_repos": ("GET", f"/search/repositories?q={q(a.get('query', ''))}", None),
        "github_list_branches": ("GET", f"/repos/{repo}/branches?per_page={min(lim, 100)}", None),
        "github_list_prs": ("GET", f"/repos/{repo}/pulls?state={a.get('state', 'open')}&per_page={min(lim, 100)}", None),
        "github_list_issues": ("GET", f"/repos/{repo}/issues?state={a.get('state', 'open')}&per_page={min(lim, 100)}", None),
        "github_pr_info": ("GET", f"/repos/{repo}/pulls/{a.get('number', 0)}", None),
        "github_ci_status": ("GET", f"/repos/{repo}/commits/{q(a.get('ref') or 'HEAD')}/check-runs", None),
        "github_commits": ("GET", f"/repos/{repo}/commits?per_page={min(lim, 100)}" + (f"&sha={q(a['ref'])}" if a.get("ref") else ""), None),
        "github_compare": ("GET", f"/repos/{repo}/compare/{q(a.get('ref', ''))}", None),
        "github_create_issue": ("POST", f"/repos/{repo}/issues", {"title": a.get("title"), "body": a.get("body", "")}),
        "github_comment": ("POST", f"/repos/{repo}/issues/{a.get('number', 0)}/comments", {"body": a.get("body", "")}),
        "github_create_pr": ("POST", f"/repos/{repo}/pulls", {"title": a.get("title"), "head": a.get("branch"), "base": a.get("ref") or "main", "body": a.get("body", "")}),
        "github_merge_pr": ("PUT", f"/repos/{repo}/pulls/{a.get('number', 0)}/merge", {"merge_method": "squash"}),
        "github_delete_branch": ("DELETE", f"/repos/{repo}/git/refs/heads/{q(a.get('branch', ''), safe='/')}", None),
        "github_run_workflow": ("POST", f"/repos/{repo}/actions/workflows/{q(a.get('workflow', ''))}/dispatches", {"ref": a.get("ref") or "main"}),
        "github_create_release": ("POST", f"/repos/{repo}/releases", {"tag_name": a.get("tag")}),
    }
    if name == "github_api":
        st, body = _gh(rt, a["method"], a["path"], a.get("body"))
    elif name in table:
        m, path, body_ = table[name]
        st, body = _gh(rt, m, path, body_)
    elif name == "github_read_files":
        st, body = _gh(rt, "GET", f"/repos/{repo}/contents/{q(a.get('path', ''))}{ref}")
    else:
        return False, f"{name}: not implemented in the REST client (use github_api)"
    if name == "github_read_file" and isinstance(body, dict) and body.get("encoding") == "base64":
        import base64
        return True, base64.b64decode(body["content"]).decode("utf-8", "replace")[: MAX_OUT]
    return 200 <= st < 300, f"[{st}] " + _cut(json.dumps(body, ensure_ascii=False)[:MAX_OUT])


# ------------------------------------------------------------------ memory notes and schedules (text stores the model can use and the owner can read)
def _memory(rt: Runtime, name: str, a: dict) -> tuple[bool, str]:
    f = rt.root / ".qalam" / "notes.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    notes = [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()] if f.exists() else []
    if name in ("memory_note", "memory_save"):
        nid = f"n{len(notes) + 1}-{int(time.time())}"
        with open(f, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"id": nid, "text": a["text"], "tags": a.get("tags", [])}, ensure_ascii=False) + "\n")
        return True, nid
    if name == "memory_forget":
        keep = [n for n in notes if n["id"] != a["id"]]
        f.write_text("".join(json.dumps(n, ensure_ascii=False) + "\n" for n in keep), encoding="utf-8")
        return len(keep) < len(notes), "forgotten" if len(keep) < len(notes) else "no such note"
    words = set(re.findall(r"\w+", a["query"].lower()))
    scored = sorted(((len(words & set(re.findall(r"\w+", (n["text"] + " " + " ".join(n["tags"])).lower()))), n) for n in notes), key=lambda x: -x[0])
    return True, json.dumps([n for s, n in scored if s][: int(a.get("limit", 8))], ensure_ascii=False)


def _schedule(rt: Runtime, name: str, a: dict) -> tuple[bool, str]:
    f = rt.root / ".qalam" / "schedule.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    if name == "schedule_list":
        return True, json.dumps(jobs, ensure_ascii=False)
    if name == "schedule_create":                                   # the caller reaches here only after the person approved (tools.validate marks it `write`; governance: schedule_create)
        jid = f"s{len(jobs) + 1}"
        jobs[jid] = {"when": a["when"], "task": a["task"], "repeat": a.get("repeat", "")}
        if rt.audit:
            rt.audit.append("schedule_create", id=jid, when=a["when"], task=a["task"][:200])
    else:
        if a["id"] not in jobs:
            return False, "no such schedule"
        jobs.pop(a["id"])
    f.write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
    return True, "ok"


# ------------------------------------------------------------------ dispatch and coverage
_COMPUTER = set("computer_run computer_read computer_search computer_write computer_edit computer_patch computer_test computer_job computer_tools computer_apps computer_batch "
                "sandbox_exec sandbox_read_file sandbox_search sandbox_write_file sandbox_edit_file build lint format run_tests install_packages project_scaffold package_release serve_preview".split())
_WEB = set("fetch_page web_fetch rss_read http_request download_file upload_file form_submit send_email".split())
_MEM = set("memory_note memory_save memory_forget recall memory_search knowledge_search".split())
_SCHED = {"schedule_list", "schedule_create", "schedule_delete"}
_AGENT = set("load_tools plan ask_user think skill request_secret delegate".split())
_RUNTIME = set("browser desktop screenshot_url computer_bank computer_repo computer_publish sandbox_clone sandbox_wait sandbox_push deploy web_search deep_research".split())
_MODEL = set("view_image view_video listen_audio generate_image generate_video generate_audio edit_image".split())
_CONNECTOR = {"mcp_list_tools", "mcp_call", "connector_api", "trade_live_positions", "trade_live_balance", "trade_live_cancel", "market_data"}
_FINANCE = {n for n, s in tools.REGISTRY.items() if s.group == "finance"} - _CONNECTOR


def coverage() -> dict[str, str]:
    """Every registry tool -> executor | agent | connector | model | runtime. `executor` means it runs in this repository and is tested; `connector` means it runs once the owner
    has connected the service (the REST/SMTP clients here are real; the credentials are the owner's); `model` needs the trained model or media codec; `runtime` needs a
    browser, a desktop, a git host checkout or a search provider supplied by the host."""
    out: dict[str, str] = {}
    for n, s in tools.REGISTRY.items():
        if s.group == "files" or n in _COMPUTER | _WEB | _MEM | _SCHED | _FINANCE or n.startswith("github_"):
            out[n] = "executor"
        elif n in _AGENT:
            out[n] = "agent"
        elif n in _CONNECTOR:
            out[n] = "connector"
        elif n in _MODEL:
            out[n] = "model"
        else:
            out[n] = "runtime"
    return out


def run_tool(rt: Runtime, name: str, args: dict, loaded: set[str] | None = None) -> tuple[bool, str]:
    """Validate, honour the emergency stop, run, and record. Approval and typed confirmation are the caller's job (agent loop); this never runs a call that fails validation."""
    v = tools.validate(name, args, loaded if loaded is not None else set(tools.GROUPS))
    if not v.ok:
        return False, v.reason
    if rt.stop is not None and rt.stop.engaged() and v.risk not in ("read",):
        return False, "the emergency stop is engaged: nothing but reading is allowed"
    try:
        spec = tools.REGISTRY[name]
        if spec.group == "files":
            ok, text = run_file_tool(rt.ws, name, args)
        elif name in _COMPUTER:
            ok, text = _computer(rt, name, args)
        elif name in _WEB:
            ok, text = _web(rt, name, args)
        elif name.startswith("github_"):
            ok, text = _github(rt, name, args)
        elif name in _MEM:
            ok, text = _memory(rt, name, args)
        elif name in _SCHED:
            ok, text = _schedule(rt, name, args)
        elif name == "delegate" and rt.delegate is not None:
            narrower = list(args.get("tools") or [])
            ok, text = True, rt.delegate(args["task"], narrower, int(args.get("budget", 8)))
        elif name in _FINANCE:
            ok, text = finance.run_finance_tool(rt.root, name, args, rt.audit, rt.stop)
        elif name in ("mcp_call", "connector_api") and args.get("server") in rt.connectors:
            ok, text = True, json.dumps(rt.connectors[args["server"]](args.get("tool") or args.get("path"), args.get("arguments") or args.get("body")), ensure_ascii=False, default=str)
        else:
            ok, text = False, f"{name}: class {coverage()[name]!r} - not available in this runtime"
    except (FileError, netguard.NetError, ValueError, KeyError, OSError, ET.ParseError) as exc:
        ok, text = False, f"{type(exc).__name__}: {str(exc)[:300]}"
    if rt.audit and v.risk not in ("read",):
        rt.audit.append("tool", name=name, risk=v.risk, ok=ok, args={k: (str(x)[:120]) for k, x in args.items() if "content" not in k and "body" not in k})
    return ok, tools.shape_result(text)
