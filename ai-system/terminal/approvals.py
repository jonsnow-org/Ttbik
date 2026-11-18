"""Owner decision of 2026-11-18 on the terminal's safety policy (T-LDM, Sham's computer):

  default when SHAM_TLDM is on = `model_computer_approvals`:
    * the base is the model's own computer exactly as it is (`model_computer`: unrestricted, shell expansion, pipes, python, everything Sham's computer allows today);
    * PLUS: a SENSITIVE command does not run until the owner approves it (allow / deny). The question goes through the app's existing confirmation path
      (the same yes-before-it-runs rule as shamNeedsOk / SHAM_NEEDS_OK in src/lib/shamExec.ts, asked with the app's own ask_user / confirm; no new UI);
    * what the book's strict policy REFUSED (forbidden list, rm -r/-f, pip, git, curl, ...) is NOT blocked here: it becomes "needs approval". The strict
      policy stays available (`policy="strict"`) and is no longer the default anywhere.
  A denied or unanswered request never reaches the computer; the model gets a clear result ("denied by the owner ...") and continues.

`sensitive(command, home)` -> '' (runs directly) or the reason the owner is asked. It reads the command as a shell would split it (every segment of
`;`, `&&`, `||`, `|`, `$(...)`, backticks), so `ls; git push` is caught as well. Honest limit: this is a gate for recognisable commands on an
unrestricted base, not a sandbox: a program the model writes itself (e.g. a python script) can still do anything the computer allows, by the owner's choice.
Stdlib only.
"""
from __future__ import annotations

import os
import re
import shlex

from sandbox_terminal import CONFIRM, REFUSED

try:
    from app_port import find_secret
except Exception:                                                   # pragma: no cover
    def find_secret(value, path="arguments"):
        return ""

POLICIES = ("model_computer", "model_computer_approvals", "strict")
DEFAULT_TLDM_POLICY = "model_computer_approvals"
# the book's refused list and its confirm list, plus the few the book's sandbox never had to name because it had no shell
SENSITIVE = (REFUSED | CONFIRM | {"rmdir", "truncate", "shred", "ln", "npm", "pnpm", "yarn", "pip3", "python3 -m pip", "apt-get", "gh", "rsync", "sftp", "nohup", "setsid", "xargs", "find -delete"}) - {"mkdir"}
WRAPPERS = {"sudo", "env", "nohup", "time", "nice", "timeout", "command", "builtin", "exec", "xargs", "setsid"}
SPLIT = re.compile(r"\|\||&&|;|\||\n|`|\$\(|\)|&")
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def default_policy() -> str:
    """SHAM_TLDM_POLICY overrides; otherwise the owner's default."""
    p = os.environ.get("SHAM_TLDM_POLICY", "").strip() or DEFAULT_TLDM_POLICY
    return p if p in POLICIES else DEFAULT_TLDM_POLICY


def _words(segment: str) -> list:
    try:
        return shlex.split(segment, comments=False)
    except ValueError:
        return segment.split()


def _outside(path: str, home: str) -> bool:
    if not path or path.startswith(("<", "-")):
        return False
    p = os.path.expanduser(path)
    if not os.path.isabs(p):
        return ".." in p.split("/")
    h = os.path.realpath(home or "/nonexistent")
    return not (os.path.realpath(p) + "/").startswith(h.rstrip("/") + "/")


def sensitive(command: str, home: str = "") -> str:
    """'' = run it; else the reason the owner must approve it first."""
    cmd = command.strip()
    if not cmd:
        return ""
    where = find_secret({"command": cmd}, "command")
    if where:
        return "the command contains what looks like a credential"
    for seg in SPLIT.split(cmd):
        w = _words(seg.strip())
        while w and (ASSIGN.match(w[0]) or os.path.basename(w[0]) in WRAPPERS):
            if os.path.basename(w[0]) in REFUSED | CONFIRM:              # sudo, env, exec are themselves sensitive
                return f"`{os.path.basename(w[0])}` changes who or how the command runs"
            w = w[1:]
            while w and w[0].startswith("-"):                           # options of the wrapper (timeout 5, nice -n 5 ...)
                w = w[1:]
            while w and re.fullmatch(r"[\d.]+[smhd]?", w[0]):
                w = w[1:]
        if not w:
            continue
        name = os.path.basename(w[0])
        two = f"{name} {w[1]}" if len(w) > 1 else name
        if name in ("python3", "python") and w[1:3] == ["-m", "pip"]:
            return "installs packages (pip)"
        if name in SENSITIVE or two in SENSITIVE:
            return f"`{name}` is on the list that needs the owner's approval (network, packages, git, deleting/moving files, system or permission changes)"
        if name == "find" and any(a in ("-delete", "-exec", "-execdir") for a in w[1:]):
            return "`find` that deletes or runs other commands"
        if name == "mkdir" and any(_outside(a, home) for a in w[1:]):
            return "creates a folder outside the model's workspace"
        if name in ("python3", "python") and len(w) > 2 and w[1] == "-c" and re.search(r"\b(shutil\.rmtree|os\.remove|os\.unlink|os\.system|subprocess|socket|urllib|requests)\b", w[2]):
            return "inline python that deletes files, runs commands or uses the network"
    for target in re.findall(r"(?:^|[^>&0-9])>>?\s*([^\s;&|]+)", cmd):
        if _outside(target, home):
            return f"writes to {target!r}, outside the model's workspace"
    return ""


def question(command: str, reason: str) -> str:
    """The text of the owner's allow/deny request (shown by the app's existing confirmation)."""
    return f"Sham wants to run on its computer:\n$ {command}\nWhy this needs your approval: {reason}.\nAllow?"


def app_confirm(port):
    """confirm(question) -> bool through the app's existing path: the port's own confirm (the «نفّذ» tap) if the app gave one, else the app's ask_user
    tool read with the coordinator's YES rule. No port / no answer = deny."""
    def confirm(q: str) -> bool:
        try:
            if getattr(port, "confirm", None) is not None:
                return bool(port.confirm(q))
            if "ask_user" in getattr(port, "tools", ()):
                from tasks import YES
                return bool(YES.match(str(port.ask(q))))
        except Exception:
            return False
        return False
    return confirm
