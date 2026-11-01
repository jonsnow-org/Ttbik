"""A free persistent Linux computer for one model: what Daytona's paid sandbox gave (a shell, files that stay, long jobs), built on what the model's OWN Studio already has.

Measured on a real ModelScope Studio (2026-11-01): we are root, 2 vCPU / 8 GB, /mnt/workspace persists, apt and pip work through mirrors. So a "computer" is:
  - a home folder per session (a session = one user of one model) under /mnt/workspace/computer, kept between chats and Studio restarts;
  - commands run as a private unprivileged user of that session (uid derived from the session id): no root, no capabilities (no_new_privs), memory (a watcher stops a process group above 3 GB) / process / file-size
    limits, a clean environment (the Studio's tokens and secrets are NOT passed), low CPU priority so the model's own work is not starved;
  - another session's home is unreadable (mode 0700, different uid);
  - long work runs as background jobs (start / log / stop) that outlive the call;
  - best effort: the host's private network ranges and the Alibaba metadata address are blocked for these users with iptables when the Studio allows it, and the result is
    reported in `status` (never assumed).
Nothing here is shared between models: every model's Studio runs its own copy and its own folders.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import resource
import shutil
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(os.environ.get("BOX_STORE", "/mnt/workspace/computer"))
MAX_OUT = 12000                     # characters returned from one command
HEAD_OUT = 3000
DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 90                    # longer work belongs in a background job: the Studio gateway cuts long answers
MAX_READ = 60000
MAX_WRITE = 1_000_000
MAX_JOBS = 4
QUOTA_BYTES = 3 * 1024 ** 3
MEMORY_KILL = 3 * 1024 ** 3         # a command / job whose processes use more real memory than this is stopped (the model in this Studio needs the rest of the 8 GB)
LIMITS = {                          # applied to every command and job
    "nproc": 512,                   # fork bombs
    "fsize": 1024 ** 3,
    "nofile": 2048,
}
UID_BASE = 20000
UID_SPAN = 40000

_LOCK = threading.RLock()
_RUN_LOCKS: dict[str, threading.Lock] = {}
_JOBS: dict[str, dict[str, dict]] = {}
STATE: dict = {"egress": "not checked"}


# ---------------------------------------------------------------- pure helpers (unit-tested)
def digest(session: str) -> str:
    return hashlib.sha256(str(session).encode("utf-8")).hexdigest()


def session_root(session: str) -> Path:
    """One folder per session id; the id is hashed so nothing the caller sends can escape the store."""
    return ROOT / digest(session)[:24]


def session_home(session: str) -> Path:
    return session_root(session) / "home"


def session_uid(session: str) -> int:
    return UID_BASE + int(digest(session)[:8], 16) % UID_SPAN


def safe_path(session: str, rel: str) -> Path:
    """A path inside the session's home. Absolute paths are taken relative to the home; `..` and symlinks that leave the home are refused."""
    home = session_home(session)
    text = str(rel or ".").replace("\\", "/").strip()
    if "\x00" in text:
        raise ValueError("bad path")
    if text.startswith("~/"):
        text = text[2:]
    target = (home / text.lstrip("/")) if text.startswith("/") else (home / text)
    real_home = Path(os.path.realpath(home))
    real = Path(os.path.realpath(target))
    if real != real_home and real_home not in real.parents:
        raise ValueError("path leaves your computer's home folder")
    return target


def clean_env(session: str) -> dict:
    """Only what a shell needs. The Studio's own environment (tokens, secrets, API keys) never reaches a command."""
    home = str(session_home(session))
    return {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME": home, "USER": "model", "LOGNAME": "model", "SHELL": "/bin/bash",
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TERM": "xterm", "TMPDIR": home + "/.tmp",
        "PYTHONUNBUFFERED": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PIP_NO_INPUT": "1", "npm_config_cache": home + "/.npm",
        "DEBIAN_FRONTEND": "noninteractive",
    }


def clip(text: str, limit: int = MAX_OUT) -> str:
    text = str(text or "")
    if len(text) <= limit:
        return text
    head = min(HEAD_OUT, limit // 4)
    tail = limit - head
    return text[:head] + f"\n…(cut {len(text) - limit} characters; redirect to a file and read part of it)…\n" + text[-tail:]


def valid_job_id(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9]{6,12}", str(value or "")))


def dir_size(path: Path, cap_files: int = 200000) -> int:
    total = 0
    seen = 0
    stack = [str(path)]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for entry in it:
                    seen += 1
                    if seen > cap_files:
                        return total
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


# ---------------------------------------------------------------- running as the session's own user
def is_root() -> bool:
    return hasattr(os, "geteuid") and os.geteuid() == 0


def _child_setup(uid: int, drop: bool, cpu_seconds: int):
    def setup() -> None:
        os.setsid()
        try:
            os.nice(10)
        except OSError:
            pass
        for name, value in (("RLIMIT_NPROC", LIMITS["nproc"]), ("RLIMIT_FSIZE", LIMITS["fsize"]),
                            ("RLIMIT_NOFILE", LIMITS["nofile"]), ("RLIMIT_CPU", cpu_seconds)):
            try:
                resource.setrlimit(getattr(resource, name), (value, value))
            except (ValueError, OSError):
                pass
        if drop:
            os.setgroups([])
            os.setgid(uid)
            os.setuid(uid)
            try:                                           # no setuid binary can give it privileges back
                import ctypes
                ctypes.CDLL(None).prctl(38, 1, 0, 0, 0)    # PR_SET_NO_NEW_PRIVS
            except Exception:                              # noqa: BLE001
                pass
    return setup


def ensure_home(session: str) -> Path:
    home = session_home(session)
    for sub in ("", ".tmp", ".jobs"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    if is_root():
        uid = session_uid(session)
        try:
            os.chmod(ROOT, 0o711)
            os.chmod(session_root(session), 0o711)         # others may traverse to their own home, nothing more
            for base, dirs, files in os.walk(home):        # only what is not already ours (cheap after the first call)
                if os.stat(base).st_uid != uid:
                    os.chown(base, uid, uid)
                for name in dirs + files:
                    p = os.path.join(base, name)
                    if os.lstat(p).st_uid != uid:
                        os.chown(p, uid, uid, follow_symlinks=False)
                if base == str(home):
                    os.chmod(home, 0o700)
                if len(files) > 5000:
                    break
        except OSError:
            pass
    return home


def install_egress_rules() -> str:
    """Best effort, once: refuse private / metadata destinations to the unprivileged users. Reported, never assumed."""
    with _LOCK:
        if STATE["egress"] != "not checked":
            return STATE["egress"]
        if not is_root() or not shutil.which("iptables"):
            STATE["egress"] = "not available (no iptables or not root): commands can reach the host's private network"
            return STATE["egress"]
        owner = f"{UID_BASE}-{UID_BASE + UID_SPAN}"
        failed = 0
        for dest in ("100.100.100.200", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"):
            r = subprocess.run(["iptables", "-w", "-A", "OUTPUT", "-m", "owner", "--uid-owner", owner, "-d", dest, "-j", "REJECT"],
                               capture_output=True, text=True, timeout=15)
            failed += 1 if r.returncode else 0
        STATE["egress"] = "private ranges and the metadata address are blocked for commands" if not failed else f"partly blocked ({failed} rules refused by the host)"
        return STATE["egress"]


# ---------------------------------------------------------------- memory watcher (rlimits cannot cap real memory)
_WATCHED: dict[int, str] = {}                  # process-group id -> what it is, for the message
_WATCH_THREAD: threading.Thread | None = None


def group_rss(pgid: int) -> int:
    """Real memory (bytes) of every process in the group, read from /proc."""
    total = 0
    page = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096
    try:
        names = os.listdir("/proc")
    except OSError:
        return 0
    for name in names:
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as fh:
                stat = fh.read().decode("utf-8", "replace")
            fields = stat[stat.rindex(")") + 2:].split()
            if int(fields[2]) != pgid:                       # field 5 of stat = pgrp (index 2 after the command)
                continue
            with open(f"/proc/{name}/statm", "rb") as fh:
                total += int(fh.read().split()[1]) * page
        except (OSError, ValueError, IndexError):
            continue
    return total


def _watch_loop() -> None:
    while True:
        time.sleep(2)
        for pgid in list(_WATCHED):
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                _WATCHED.pop(pgid, None)
                continue
            if group_rss(pgid) > MEMORY_KILL:
                _kill_group(pgid)
                _WATCHED.pop(pgid, None)


def watch(pgid: int, what: str) -> None:
    global _WATCH_THREAD
    with _LOCK:
        _WATCHED[pgid] = what
        if _WATCH_THREAD is None or not _WATCH_THREAD.is_alive():
            _WATCH_THREAD = threading.Thread(target=_watch_loop, daemon=True, name="box-memory-watch")
            _WATCH_THREAD.start()


def _run_lock(session: str) -> threading.Lock:
    with _LOCK:
        return _RUN_LOCKS.setdefault(session, threading.Lock())


def over_quota(session: str) -> bool:
    return dir_size(session_home(session)) > QUOTA_BYTES


def run_command(session: str, command: str, cwd: str = ".", timeout: int = DEFAULT_TIMEOUT) -> dict:
    command = str(command or "").strip()
    if not command:
        return {"ok": False, "error": "empty command"}
    timeout = max(1, min(MAX_TIMEOUT, int(timeout or DEFAULT_TIMEOUT)))
    home = ensure_home(session)
    if over_quota(session):
        return {"ok": False, "error": f"your computer's disk is full ({QUOTA_BYTES // 1024 ** 3} GB); delete files first"}
    install_egress_rules()
    try:
        workdir = safe_path(session, cwd)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    workdir.mkdir(parents=True, exist_ok=True)
    drop = is_root()
    uid = session_uid(session)
    if drop and workdir.stat().st_uid != uid:
        os.chown(workdir, uid, uid)
    started = time.time()
    with _run_lock(session):
        proc = subprocess.Popen(["/bin/bash", "-c", command], cwd=str(workdir), env=clean_env(session), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=_child_setup(uid, drop, timeout + 15))
        timed_out = False
        watch(proc.pid, "command")
        try:
            raw, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_group(proc.pid)
            try:
                raw, _ = proc.communicate(timeout=5)
            except Exception:                              # noqa: BLE001
                raw = b""
    out = raw.decode("utf-8", "replace") if raw else ""
    reply = {"ok": True, "exit_code": proc.returncode, "output": clip(out), "seconds": round(time.time() - started, 1), "cwd": str(workdir.relative_to(home)) if workdir != home else "."}
    if timed_out:
        reply["timed_out"] = True
        reply["hint"] = f"stopped after {timeout} s: run long work with computer_job (it keeps running between calls)"
    return reply


def _kill_group(pid: int) -> None:
    import signal
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(os.getpgid(pid), sig)
        except (ProcessLookupError, PermissionError, OSError):
            return
        time.sleep(0.4)


# ---------------------------------------------------------------- files
def write_file(session: str, path: str, content: str) -> dict:
    data = str(content or "")
    if len(data.encode("utf-8")) > MAX_WRITE:
        return {"ok": False, "error": f"a file written in one call is limited to {MAX_WRITE // 1000} KB; write it in parts with `cat >>`"}
    ensure_home(session)
    if over_quota(session):
        return {"ok": False, "error": "your computer's disk is full; delete files first"}
    try:
        target = safe_path(session, path)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if target.is_symlink() or target.is_dir():
        return {"ok": False, "error": "that path is a directory or a link"}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(data, encoding="utf-8")
    if is_root():
        uid = session_uid(session)
        for p in (target.parent, target):
            try:
                os.chown(p, uid, uid, follow_symlinks=False)
            except OSError:
                pass
    return {"ok": True, "path": str(target.relative_to(session_home(session))), "bytes": len(data.encode("utf-8"))}


def read_path(session: str, path: str) -> dict:
    ensure_home(session)
    try:
        target = safe_path(session, path)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if not target.exists():
        return {"ok": False, "error": "no such file or folder"}
    home = session_home(session)
    if target.is_dir():
        entries = []
        for child in sorted(target.iterdir(), key=lambda c: (not c.is_dir(), c.name))[:200]:
            if child.name in (".tmp", ".jobs") and target == home:
                continue
            entries.append(("d " if child.is_dir() else "f ") + child.name + ("" if child.is_dir() else f" ({child.stat().st_size} B)"))
        return {"ok": True, "kind": "folder", "path": str(target.relative_to(home)) if target != home else ".", "entries": entries}
    data = target.read_bytes()[:MAX_READ * 4]
    text = data.decode("utf-8", "replace")
    reply = {"ok": True, "kind": "file", "path": str(target.relative_to(home)), "bytes": target.stat().st_size, "text": text[:MAX_READ]}
    if len(text) > MAX_READ or target.stat().st_size > len(data):
        reply["cut"] = True
    return reply


# ---------------------------------------------------------------- background jobs
def _jobs(session: str) -> dict:
    return _JOBS.setdefault(session, {})


def _refresh(job: dict) -> None:
    if job.get("exit_code") is None:
        code = job["proc"].poll()
        if code is not None:
            job["exit_code"] = code
            job["ended"] = time.time()


def job_start(session: str, command: str, name: str = "") -> dict:
    command = str(command or "").strip()
    if not command:
        return {"ok": False, "error": "empty command"}
    home = ensure_home(session)
    if over_quota(session):
        return {"ok": False, "error": "your computer's disk is full; delete files first"}
    install_egress_rules()
    with _LOCK:
        jobs = _jobs(session)
        for job in jobs.values():
            _refresh(job)
        if sum(1 for j in jobs.values() if j.get("exit_code") is None) >= MAX_JOBS:
            return {"ok": False, "error": f"{MAX_JOBS} jobs are already running; stop one first (computer_job action=stop)"}
        job_id = hashlib.sha256(f"{time.time()}{command}".encode()).hexdigest()[:8]
        log = home / ".jobs" / f"{job_id}.log"
        drop = is_root()
        uid = session_uid(session)
        handle = open(log, "wb")
        try:
            if drop:
                os.chown(log, uid, uid)
            proc = subprocess.Popen(["/bin/bash", "-c", command], cwd=str(home), env=clean_env(session), stdin=subprocess.DEVNULL,
                                    stdout=handle, stderr=subprocess.STDOUT, preexec_fn=_child_setup(uid, drop, 6 * 3600))
        finally:
            handle.close()
        watch(proc.pid, "job")
        jobs[job_id] = {"proc": proc, "log": log, "command": command[:300], "name": str(name or "")[:60], "started": time.time(), "exit_code": None}
    return {"ok": True, "id": job_id, "message": "running in the background; read it with computer_job action=log"}


def _tail(path: Path, lines: int) -> str:
    try:
        size = path.stat().st_size
        with open(path, "rb") as fh:
            fh.seek(max(0, size - 60000))
            data = fh.read().decode("utf-8", "replace")
    except OSError:
        return ""
    return "\n".join(data.splitlines()[-max(1, min(400, lines)):])


def job_log(session: str, job_id: str, tail: int = 60) -> dict:
    if not valid_job_id(job_id):
        return {"ok": False, "error": "bad job id"}
    with _LOCK:
        job = _jobs(session).get(job_id)
        if not job:
            return {"ok": False, "error": "no such job (a restart of the Studio ends running jobs)"}
        _refresh(job)
    return {"ok": True, "id": job_id, "running": job["exit_code"] is None, "exit_code": job["exit_code"],
            "seconds": round((job.get("ended") or time.time()) - job["started"], 1), "output": clip(_tail(job["log"], tail))}


def job_stop(session: str, job_id: str) -> dict:
    if not valid_job_id(job_id):
        return {"ok": False, "error": "bad job id"}
    with _LOCK:
        job = _jobs(session).get(job_id)
        if not job:
            return {"ok": False, "error": "no such job"}
        _refresh(job)
        if job["exit_code"] is None:
            _kill_group(job["proc"].pid)
            _refresh(job)
    return {"ok": True, "id": job_id, "running": job["exit_code"] is None, "exit_code": job["exit_code"]}


def job_list(session: str) -> dict:
    with _LOCK:
        rows = []
        for job_id, job in _jobs(session).items():
            _refresh(job)
            rows.append({"id": job_id, "name": job["name"], "command": job["command"][:80], "running": job["exit_code"] is None, "exit_code": job["exit_code"]})
    return {"ok": True, "jobs": rows}


# ---------------------------------------------------------------- status and the API entry points
def status(session: str = "") -> dict:
    ROOT.mkdir(parents=True, exist_ok=True)
    try:
        usage = shutil.disk_usage(ROOT)
        disk = {"free_gb": round(usage.free / 1024 ** 3, 1), "total_gb": round(usage.total / 1024 ** 3, 1)}
    except OSError:
        disk = {}
    tools = {name: bool(shutil.which(name)) for name in ("python3", "pip", "node", "npm", "git", "gcc", "make", "curl", "unzip", "jq")}
    reply = {"ok": True, "isolation": "private unprivileged user, no new privileges, memory/process/file limits, clean environment" if is_root() else "same user as the Studio (not root): environment cleaned, limits applied",
             "persistent": str(ROOT).startswith("/mnt/workspace"), "store": str(ROOT), "disk": disk, "tools": tools,
             "limits": {"command_seconds": MAX_TIMEOUT, "jobs": MAX_JOBS, "disk_gb": QUOTA_BYTES // 1024 ** 3, "memory_gb": MEMORY_KILL // 1024 ** 3},
             "egress": STATE["egress"]}
    if session:
        home = session_home(session)
        reply["your_disk_mb"] = round(dir_size(home) / 1024 ** 2, 1) if home.exists() else 0
        reply["jobs_running"] = sum(1 for j in _jobs(session).values() if j.get("exit_code") is None)
    return reply


def api_box_status(_unused: str = "") -> str:
    return json.dumps(status(), ensure_ascii=False)


def api_box_do(body: str) -> str:
    try:
        job = json.loads(body or "{}")
        if not isinstance(job, dict):
            raise ValueError("not an object")
    except ValueError:
        return json.dumps({"ok": False, "error": "bad request"})
    session = str(job.get("session") or "").strip()
    if not session:
        return json.dumps({"ok": False, "error": "no session"})
    action = str(job.get("action") or "")
    try:
        if action == "run":
            out = run_command(session, job.get("command", ""), job.get("cwd", "."), int(job.get("timeout") or DEFAULT_TIMEOUT))
        elif action == "write":
            out = write_file(session, job.get("path", ""), job.get("content", ""))
        elif action == "read":
            out = read_path(session, job.get("path", "."))
        elif action == "job_start":
            out = job_start(session, job.get("command", ""), job.get("name", ""))
        elif action == "job_log":
            out = job_log(session, job.get("id", ""), int(job.get("tail") or 60))
        elif action == "job_stop":
            out = job_stop(session, job.get("id", ""))
        elif action == "job_list":
            out = job_list(session)
        elif action == "status":
            out = status(session)
        else:
            out = {"ok": False, "error": "unknown action " + action[:30]}
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:240]}"}
    return json.dumps(out, ensure_ascii=False)
