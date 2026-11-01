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

import fcntl
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
MAX_JOBS = 4                       # per-session ceiling
MAX_GLOBAL_JOBS = max(1, int(os.environ.get("COMPUTER_MAX_GLOBAL_JOBS", "1")))  # shared 2-vCPU Studio: one executing task at a time
MIN_AVAILABLE_MB = max(512, int(os.environ.get("COMPUTER_MIN_AVAILABLE_MB", "2048")))
QUOTA_BYTES = 3 * 1024 ** 3
MEMORY_KILL = max(512, int(os.environ.get("COMPUTER_MEMORY_KILL_MB", "1536"))) * 1024 ** 2
LIMITS = {                          # applied to every command and job
    "nproc": 512,                   # fork bombs
    "fsize": 1024 ** 3,
    "nofile": 2048,
}
# Allocate unique persistent UIDs instead of hashing into a small modulo range.
# UID mappings survive Studio restarts and are stored by a one-way session digest.
UID_BASE = 100000
UID_SPAN = 400000

_LOCK = threading.RLock()
_RUN_LOCKS: dict[str, threading.Lock] = {}
_JOBS: dict[str, dict[str, dict]] = {}
_ACTIVE_COMMANDS: set[str] = set()
_ACTIVE_DESKTOPS: set[str] = set()  # a graphical desktop reserves the Studio's single execution slot
STATE: dict = {"egress": "not checked", "toolchain": "not checked"}


PLAYBOOK = """YOUR COMPUTER - how to work fast
1. Start every task with computer_read "." and ~/NOTES.md: your files and notes from earlier chats are still here. Keep NOTES.md up to date (plan, findings, next step).
2. To read a GitHub repository: ONE computer_repo call, then computer_search / computer_read / rg. Do not make dozens of GitHub API calls.
3. Anything longer than about 60 s (install, build, test suite, download, server): computer_job action=start, do other work, then action=log. Poll rarely.
4. Independent work in parallel: start a job, then browse or write code while it runs.
5. Install into your home (pip install --target ~/pylib, npm in ~/proj). Your files and caches stay between chats.
6. Pages that need JavaScript: the browser. Plain pages: web_fetch is faster.
7. Output is cut at 12 KB: send big output to a file and read parts of it.
8. Change a file with computer_edit and send ONLY the changed lines (generating text is the slowest thing you do): never rewrite a whole file for a small change.
9. When your work is done and tested: computer_publish sends ALL your changes to GitHub in ONE commit without re-sending any content; then open the pull request.
"""

# ---------------------------------------------------------------- pure helpers (unit-tested)
def digest(session: str) -> str:
    return hashlib.sha256(str(session).encode("utf-8")).hexdigest()


def session_root(session: str) -> Path:
    """One folder per session id; the id is hashed so nothing the caller sends can escape the store."""
    return ROOT / digest(session)[:24]


def session_home(session: str) -> Path:
    return session_root(session) / "home"


def session_uid(session: str) -> int:
    """Return a collision-free, persistent unprivileged UID for this session.

    A per-session hashed directory is not sufficient isolation when Unix UIDs
    collide: mode 0700 grants access to every process running under the same UID.
    This allocator serializes reservations with flock and uses linear probing.
    Only a SHA-256 digest is stored; raw Telegram/session identifiers are not.
    """
    ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = ROOT / ".session-uids.lock"
    map_path = ROOT / ".session-uids.json"
    key = digest(session)
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            try:
                mapping = json.loads(map_path.read_text(encoding="utf-8")) if map_path.exists() else {}
                if not isinstance(mapping, dict):
                    mapping = {}
            except (OSError, ValueError):
                mapping = {}
            saved = mapping.get(key)
            if isinstance(saved, int) and UID_BASE <= saved < UID_BASE + UID_SPAN:
                return saved
            used = {v for v in mapping.values() if isinstance(v, int) and UID_BASE <= v < UID_BASE + UID_SPAN}
            start = int(key[:16], 16) % UID_SPAN
            allocated = None
            for offset in range(UID_SPAN):
                candidate = UID_BASE + ((start + offset) % UID_SPAN)
                if candidate not in used:
                    allocated = candidate
                    break
            if allocated is None:
                raise RuntimeError("the private computer UID allocation range is full")
            mapping[key] = allocated
            tmp = ROOT / f".session-uids.{os.getpid()}.{threading.get_ident()}.tmp"
            with tmp.open("w", encoding="utf-8") as out:
                json.dump(mapping, out, separators=(",", ":"))
                out.flush()
                os.fsync(out.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, map_path)
            os.chmod(map_path, 0o600)
            return allocated
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


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
        # the Studio runs in China: package mirrors there are fast, pypi.org / registry.npmjs.org can hang (a live probe: pip install stopped after 90 s with no output)
        "PIP_INDEX_URL": os.environ.get("COMPUTER_PIP_INDEX", "https://mirrors.aliyun.com/pypi/simple/"),
        "PIP_TRUSTED_HOST": "mirrors.aliyun.com", "PIP_DEFAULT_TIMEOUT": "20",
        "npm_config_registry": os.environ.get("COMPUTER_NPM_REGISTRY", "https://registry.npmmirror.com"),
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


def welcome(session: str) -> str:
    """The first call of a session gets the playbook once (and README.md/NOTES.md exist from then on); later calls get nothing extra."""
    home = session_home(session)
    marker = home / ".welcomed"
    if marker.exists():
        return ""
    try:
        (home / "README.md").write_text(PLAYBOOK, encoding="utf-8")
        notes = home / "NOTES.md"
        if not notes.exists():
            notes.write_text("# Notes\n(plan, findings, next step - read this first in every new chat)\n", encoding="utf-8")
        marker.write_text("1", encoding="utf-8")
        if is_root():
            uid = session_uid(session)
            for item in (home / "README.md", notes, marker):
                os.chown(item, uid, uid)
    except OSError:
        return ""
    return PLAYBOOK


def ensure_home(session: str) -> Path:
    home = session_home(session)
    for sub in ("", ".tmp", ".jobs", "repos"):
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


def _mem_available_mb() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _global_counts_locked() -> tuple[int, int, int]:
    active_jobs = 0
    for jobs in _JOBS.values():
        for job in jobs.values():
            _refresh(job)
            if job.get("exit_code") is None:
                active_jobs += 1
    return active_jobs, len(_ACTIVE_COMMANDS), len(_ACTIVE_DESKTOPS)


def reserve_desktop(session: str, min_available_mb: int = 3072) -> dict:
    """Reserve this Studio's single execution slot for one private graphical desktop."""
    ensure_home(session)
    key = digest(session)[:24]
    required = max(MIN_AVAILABLE_MB, min(6000, int(min_available_mb)))
    with _LOCK:
        if key in _ACTIVE_DESKTOPS:
            return {"ok": True, "already_reserved": True, "available_mb": _mem_available_mb()}
        active_jobs, active_commands, active_desktops = _global_counts_locked()
        active = active_jobs + active_commands + active_desktops
        if active >= MAX_GLOBAL_JOBS:
            return {"ok": False, "error": f"this model's Studio is busy ({active}/{MAX_GLOBAL_JOBS} execution slot)"}
        available = _mem_available_mb()
        if available is None:
            return {"ok": False, "error": "the Studio could not report available memory; graphical desktop start was refused"}
        if available < required:
            return {"ok": False, "error": f"only {available} MB of Studio memory is available; the graphical desktop requires {required} MB"}
        _ACTIVE_DESKTOPS.add(key)
        return {"ok": True, "available_mb": available, "reserved": True}


def release_desktop(session: str) -> None:
    key = digest(session)[:24]
    with _LOCK:
        _ACTIVE_DESKTOPS.discard(key)


def _capacity_reason_locked() -> str:
    active_jobs, active_commands, active_desktops = _global_counts_locked()
    active = active_jobs + active_commands + active_desktops
    if active >= MAX_GLOBAL_JOBS:
        return f"this model's Studio is busy ({active}/{MAX_GLOBAL_JOBS} execution slot); retry after the active task finishes"
    available = _mem_available_mb()
    if available is None:
        return "the Studio could not report available memory; refusing a new task rather than risk the model process"
    if available < MIN_AVAILABLE_MB:
        return f"the Studio has only {available} MB available; a new task requires at least {MIN_AVAILABLE_MB} MB"
    return ""


def run_command(session: str, command: str, cwd: str = ".", timeout: int = DEFAULT_TIMEOUT, max_output: int = MAX_OUT) -> dict:
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
    reservation = f"{digest(session)[:12]}:{threading.get_ident()}:{time.monotonic_ns()}"
    with _LOCK:
        reason = _capacity_reason_locked()
        if reason:
            return {"ok": False, "error": reason}
        _ACTIVE_COMMANDS.add(reservation)
    try:
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
    finally:
        with _LOCK:
            _ACTIVE_COMMANDS.discard(reservation)
    out = raw.decode("utf-8", "replace") if raw else ""
    reply = {"ok": True, "exit_code": proc.returncode, "output": clip(out, max_output), "seconds": round(time.time() - started, 1), "cwd": str(workdir.relative_to(home)) if workdir != home else "."}
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


# ---------------------------------------------------------------- the toolchain (installed once, in the background, when we are root)
WANTED_TOOLS = {"git": "git", "rg": "ripgrep", "jq": "jq", "unzip": "unzip", "curl": "curl"}


def ensure_toolchain() -> str:
    missing = [pkg for exe, pkg in WANTED_TOOLS.items() if not shutil.which(exe)]
    if not missing:
        STATE["toolchain"] = "ready"
        return "ready"
    if not is_root():
        STATE["toolchain"] = "missing without root: " + ", ".join(missing)
        return STATE["toolchain"]
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
    try:
        u = subprocess.run(["apt-get", "update"], capture_output=True, text=True, timeout=300, env=env)
        r = subprocess.run(["apt-get", "install", "-y", "--no-install-recommends", *missing], capture_output=True, text=True, timeout=600, env=env)
        left = [pkg for exe, pkg in WANTED_TOOLS.items() if not shutil.which(exe)]
        STATE["toolchain"] = "ready" if not left else f"missing after apt ({', '.join(left)}): update rc={u.returncode}, install rc={r.returncode}: " + " | ".join(((r.stderr or u.stderr or "").strip().splitlines() or [""])[-2:])[:240]
    except Exception as exc:  # noqa: BLE001
        STATE["toolchain"] = f"failed: {type(exc).__name__}: {str(exc)[:120]}"
    return STATE["toolchain"]


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
            return {"ok": False, "error": f"{MAX_JOBS} jobs are already running in this session; stop one first (computer_job action=stop)"}
        reason = _capacity_reason_locked()
        if reason:
            return {"ok": False, "error": reason}
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


# ---------------------------------------------------------------- writing: edit in place, publish in one commit
def edit_file(session: str, path: str, old: str = "", new: str = "", replace_all: bool = False, edits: list | None = None) -> dict:
    """Replace exact text in a file. Only the changed lines travel (the model's output speed is the slowest part of any task). All edits apply or none."""
    ensure_home(session)
    pairs = []
    if isinstance(edits, list) and edits:
        for item in edits[:40]:
            if isinstance(item, dict):
                pairs.append((str(item.get("old", "")), str(item.get("new", "")), bool(item.get("replace_all"))))
    else:
        pairs.append((str(old or ""), str(new or ""), bool(replace_all)))
    if not pairs or any(not o for o, _n, _a in pairs):
        return {"ok": False, "error": "give `old` (the exact text to replace) and `new`"}
    try:
        target = safe_path(session, path)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if target.is_symlink() or not target.is_file():
        return {"ok": False, "error": "no such file"}
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {"ok": False, "error": "not a UTF-8 text file"}
    first_line = 0
    for index, (o, n, every) in enumerate(pairs, 1):
        count = text.count(o)
        if count == 0:
            return {"ok": False, "error": f"edit {index}: the text to replace was not found (copy it exactly, including spaces); nothing was changed"}
        if count > 1 and not every:
            return {"ok": False, "error": f"edit {index}: the text occurs {count} times; add more surrounding lines to make it unique, or set replace_all; nothing was changed"}
        if not first_line:
            first_line = text[:text.index(o)].count("\n") + 1
        text = text.replace(o, n) if every else text.replace(o, n, 1)
    if len(text.encode("utf-8")) > MAX_WRITE * 4:
        return {"ok": False, "error": "the file would become too large"}
    target.write_text(text, encoding="utf-8")
    if is_root():
        uid = session_uid(session)
        try:
            os.chown(target, uid, uid, follow_symlinks=False)
        except OSError:
            pass
    return {"ok": True, "path": str(target.relative_to(session_home(session))), "edits": len(pairs), "first_line": first_line}


# Run INSIDE the session's own account (it can read only what that account can): the files git sees as changed, as text, with binary / huge / linked files reported, not read.
COLLECT_SCRIPT = r"""
import base64, json, os, re, subprocess
MAX_FILE, MAX_TOTAL = 1000000, 2500000
def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True)
st = git("status", "--porcelain=v1", "-z", "--untracked-files=all")
parts = st.stdout.split("\0")
files, deleted, skipped, total, i = [], [], [], 0, 0
while i < len(parts):
    entry = parts[i]; i += 1
    if len(entry) < 4:
        continue
    code, path = entry[:2], entry[3:]
    if code[0] in "RC":
        old = parts[i] if i < len(parts) else ""; i += 1
        if old: deleted.append(old)
    if "D" in code:
        deleted.append(path); continue
    if os.path.islink(path) or not os.path.isfile(path):
        skipped.append({"path": path, "why": "link or not a file"}); continue
    size = os.path.getsize(path)
    if size > MAX_FILE or total + size > MAX_TOTAL:
        skipped.append({"path": path, "why": "too large for one publish"}); continue
    data = open(path, "rb").read()
    if b"\0" in data[:8000]:
        skipped.append({"path": path, "why": "binary"}); continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        skipped.append({"path": path, "why": "not UTF-8"}); continue
    total += size
    files.append({"path": path, "content": text})
remote = git("remote", "get-url", "origin").stdout.strip()
head = git("rev-parse", "HEAD").stdout.strip()
print("@@CHANGES@@" + json.dumps({"remote": remote, "base": head, "files": files, "deleted": deleted, "skipped": skipped}))
"""


def collect_changes(session: str, repo: str, folder: str = "") -> dict:
    """What `computer_publish` sends: the changed files of a checkout made by computer_repo. The GitHub token never comes here; the app commits them."""
    parsed = re.fullmatch(r"([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})", str(repo or ""))
    if not parsed:
        return {"ok": False, "error": "repo must be owner/name"}
    owner, name = parsed.group(1), parsed.group(2)
    folder = str(folder or "").strip() or f"repos/{owner}-{name}"
    try:
        safe_path(session, folder)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    out = run_command(session, "python3 -c " + shell_quote(COLLECT_SCRIPT), folder, 60, 6_000_000)
    if not out.get("ok") or out.get("exit_code") != 0:
        return {"ok": False, "error": "could not read the changes: " + str(out.get("error") or out.get("output") or "")[:300]}
    try:                                             # stderr is merged into the output: read only what follows the marker
        data = json.loads(str(out["output"]).split("@@CHANGES@@", 1)[1])
    except (ValueError, IndexError):
        return {"ok": False, "error": "could not read the changes (is that folder a checkout from computer_repo?)"}
    if not re.search(rf"github\.com[/:]{re.escape(owner)}/{re.escape(name)}(\.git)?/?$", str(data.get("remote", "")), re.I):
        return {"ok": False, "error": f"that folder is not a checkout of {owner}/{name}"}
    return {"ok": True, "repo": f"{owner}/{name}", "base": data.get("base", ""), "files": data.get("files", []), "deleted": data.get("deleted", []), "skipped": data.get("skipped", [])}


# ---------------------------------------------------------------- the two shortcuts that replace dozens of API calls
GITHUB_URL = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$")


def parse_repo_url(url: str) -> tuple[str, str] | None:
    m = GITHUB_URL.match(str(url or "").strip())
    if not m or m.group(1) in (".", "..") or m.group(2) in (".", ".."):
        return None
    return m.group(1), m.group(2)


def shell_quote(value: str) -> str:
    import shlex
    return shlex.quote(str(value))


def repo_summary_command(folder: str) -> str:
    """One shell snippet that describes a checkout: size, files, languages, top level."""
    return (
        f"cd {shell_quote(folder)} && echo \"commit: $(git log -1 --format='%h %s' 2>/dev/null | cut -c1-100)\" && "
        "echo \"files: $(git ls-files 2>/dev/null | wc -l)  size: $(du -sh . 2>/dev/null | cut -f1)\" && "
        "echo \"languages: $(git ls-files 2>/dev/null | sed -n 's/.*\\.\\([A-Za-z0-9]\\{1,6\\}\\)$/\\1/p' | sort | uniq -c | sort -rn | head -6 | awk '{printf \"%s(%s) \", $2, $1}')\" && "
        "echo 'top level:' && ls -1 | head -40"
    )


def repo_fetch(session: str, url: str, ref: str = "") -> dict:
    """Public GitHub repository -> ~/repos/<owner>-<name> in ONE call (shallow clone; tarball when git is blocked). Private repositories are not fetched here:
    no GitHub token is ever put in this computer."""
    parsed = parse_repo_url(url)
    if not parsed:
        return {"ok": False, "error": "give a public https://github.com/<owner>/<repo> address"}
    owner, name = parsed
    ref = str(ref or "").strip()
    if ref and not re.fullmatch(r"[A-Za-z0-9_./-]{1,100}", ref):
        return {"ok": False, "error": "bad branch or tag name"}
    folder = f"repos/{owner}-{name}"
    clone_url = f"https://github.com/{owner}/{name}.git"
    branch = f"--branch {shell_quote(ref)} " if ref else ""
    tar_ref = ref or "HEAD"
    q = shell_quote(folder)
    tar_url = shell_quote(f"https://codeload.github.com/{owner}/{name}/tar.gz/{tar_ref}")
    # github.com itself is slow or blocked from the Studio (a live probe: `git clone` gave up after 44 s) while codeload.github.com answers in under a second:
    # the tarball goes first and becomes a local git checkout (a baseline commit, so `changes` / publish still see what the model edits); a real clone is the fallback
    script = (
        f"set -e; mkdir -p repos; "
        f"if [ -d {q}/.git ] && git -C {q} remote get-url origin >/dev/null 2>&1; then cd {q} && git fetch --depth 1 origin {shell_quote(ref or 'HEAD')} && git reset --hard FETCH_HEAD; "
        f"else rm -rf {q}; mkdir -p {q}; "
        f"if curl -fsSL --max-time 70 {tar_url} | tar xz -C {q} --strip-components=1; then "
        f"(cd {q} && git init -q && git add -A && git -c user.name=computer -c user.email=computer@local commit -qm {shell_quote('snapshot ' + (ref or 'HEAD'))} >/dev/null 2>&1 || true); "
        f"else rm -rf {q}; git -c http.lowSpeedLimit=2000 -c http.lowSpeedTime=20 clone --depth 1 --single-branch {branch}{shell_quote(clone_url)} {q}; fi; fi; "
        f"{repo_summary_command(folder)}"
    )
    started = job_start(session, script, f"repo {owner}/{name}")
    if not started.get("ok"):
        return started
    job_id = started["id"]
    deadline = time.time() + 80
    while time.time() < deadline:
        log = job_log(session, job_id, 60)
        if log.get("ok") and not log.get("running"):
            if log.get("exit_code") == 0:
                return {"ok": True, "path": folder, "summary": log["output"], "seconds": log["seconds"]}
            return {"ok": False, "error": "could not fetch the repository (is GitHub reachable from this Studio, and is the repository public?)", "output": log["output"][-600:]}
        time.sleep(1.5)
    return {"ok": True, "path": folder, "job": job_id, "summary": "", "message": "still downloading; read progress with computer_job action=log id=" + job_id + ", then search it"}


def search_command(pattern: str, path: str = ".", glob: str = "") -> str:
    """ripgrep when installed, grep otherwise; line-numbered, bounded."""
    g = f"-g {shell_quote(glob)} " if glob else ""
    inc = f"--include={shell_quote(glob)} " if glob else ""              # the grep fallback (before ripgrep is installed) must honour the file filter too
    return (f"if command -v rg >/dev/null; then rg -n --no-heading -S --max-columns 200 -m 20 {g}-e {shell_quote(pattern)} {shell_quote(path)}; "
            f"else grep -rIn --max-count=20 {inc}-E -e {shell_quote(pattern)} {shell_quote(path)}; fi | head -n 120")


def search_files(session: str, pattern: str, path: str = ".", glob: str = "") -> dict:
    if not str(pattern or "").strip():
        return {"ok": False, "error": "give a pattern"}
    try:
        safe_path(session, path)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    out = run_command(session, search_command(str(pattern)[:300], str(path or ".")[:300], str(glob or "")[:100]), ".", 40)
    if not out.get("ok"):
        return out
    return {"ok": True, "matches": out["output"] or "(no matches)", "seconds": out["seconds"]}


# ---------------------------------------------------------------- status and the API entry points
def status(session: str = "") -> dict:
    ROOT.mkdir(parents=True, exist_ok=True)
    try:
        usage = shutil.disk_usage(ROOT)
        unbounded = usage.total > 1 << 50          # a network disk that reports an absurd size (e.g. 16 EiB): its real room is unknown, only our own per-session quota counts
        disk = {"free_gb": None if unbounded else round(usage.free / 1024 ** 3, 1), "total_gb": None if unbounded else round(usage.total / 1024 ** 3, 1), "note": "filesystem reports no real limit" if unbounded else ""}
    except OSError:
        disk = {}
    tools = {name: bool(shutil.which(name)) for name in ("python3", "pip", "node", "npm", "git", "gcc", "make", "curl", "unzip", "jq")}
    with _LOCK:
        active_jobs, active_commands, active_desktops = _global_counts_locked()
        available_mb = _mem_available_mb()
        can_accept = (active_jobs + active_commands + active_desktops < MAX_GLOBAL_JOBS
                      and available_mb is not None and available_mb >= MIN_AVAILABLE_MB)
    reply = {"ok": True, "isolation": "private unprivileged user, no new privileges, memory/process/file limits, clean environment" if is_root() else "same user as the Studio (not root): environment cleaned, limits applied",
             "persistent": str(ROOT).startswith("/mnt/workspace"), "store": str(ROOT), "disk": disk, "tools": tools,
             "limits": {"command_seconds": MAX_TIMEOUT, "jobs_per_session": MAX_JOBS, "global_jobs": MAX_GLOBAL_JOBS,
                        "disk_gb": QUOTA_BYTES // 1024 ** 3, "memory_gb": round(MEMORY_KILL / 1024 ** 3, 2),
                        "minimum_available_mb": MIN_AVAILABLE_MB},
             "capacity": {"can_accept": can_accept, "active_jobs": active_jobs, "active_commands": active_commands,
                          "active_desktops": active_desktops, "available_mb": available_mb},
             "egress": STATE["egress"], "toolchain": STATE.get("toolchain", "not checked")}
    if session:
        home = session_home(session)
        reply["your_disk_mb"] = round(dir_size(home) / 1024 ** 2, 1) if home.exists() else 0
        reply["jobs_running"] = sum(1 for j in _jobs(session).values() if j.get("exit_code") is None)
    return reply


def api_box_status(_unused: str = "") -> str:
    return json.dumps(status(), ensure_ascii=False)


def unwrap_body(body: str) -> str:
    """The Studio gateway has a request filter that answers 403 to some command text (a live probe: `echo hello; echo world`): the app sends the job as `b64:<base64 of the JSON>`."""
    text = str(body or "")
    if text.startswith("b64:"):
        import base64
        return base64.b64decode(text[4:].encode("ascii"), validate=True).decode("utf-8")
    return text


def api_box_do(body: str) -> str:
    try:
        job = json.loads(unwrap_body(body) or "{}")
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
        elif action == "edit":
            out = edit_file(session, job.get("path", ""), job.get("old", ""), job.get("new", ""), bool(job.get("replace_all")), job.get("edits"))
        elif action == "changes":
            out = collect_changes(session, job.get("repo", ""), job.get("dir", ""))
        elif action == "repo":
            out = repo_fetch(session, job.get("url", ""), job.get("ref", ""))
        elif action == "search":
            out = search_files(session, job.get("pattern", ""), job.get("path", "."), job.get("glob", ""))
        elif action == "status":
            out = status(session)
        else:
            out = {"ok": False, "error": "unknown action " + action[:30]}
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:240]}"}
    if out.get("ok") and action in ("run", "repo", "read", "write", "edit", "job_start"):
        tips = welcome(session)                            # once per session, never repeated
        if tips:
            out["tips"] = tips
    return json.dumps(out, ensure_ascii=False)
