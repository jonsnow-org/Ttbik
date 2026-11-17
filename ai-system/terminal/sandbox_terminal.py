"""Sandboxed terminal: the "body" of the T-LDM project (phase 2 + 3 + the safety section of the SHAM T-LDM book).

  * default-deny: only commands in ALLOWED run; REFUSED ones never run; CONFIRM ones run only when the caller confirms (the human-confirmation rule);
  * a private working directory: every path argument must stay inside it (no absolute paths, no `..`), redirects too;
  * no shell at all (no expansion, no `;`, `&&`, backticks, `$()`): only `|`, `>` and `>>` are understood, by this module;
  * child processes get an empty environment, a timeout, resource limits and a capped output;
  * python3 runs under the same rules as ai-system/distill/exec_verify.py (no os / sys / network / file-opening constructs);
  * every call is written as one JSON line {task, command, result, success, refused, secs, ts} (the training-data format of phase 2).
Stdlib only.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "distill"))
from exec_verify import FORBIDDEN as PY_FORBIDDEN  # noqa: E402

ALLOWED = {"ls", "cat", "echo", "pwd", "head", "tail", "wc", "grep", "sort", "uniq", "mkdir", "touch", "date", "seq", "tr", "cut", "basename", "dirname", "stat", "python3", "true", "false"}
CONFIRM = {"rm", "mv", "cp"}
REFUSED = {"sudo", "su", "passwd", "shutdown", "reboot", "chmod", "chown", "dd", "mkfs", "kill", "pkill", "curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "ftp", "pip", "apt", "bash", "sh", "eval", "exec", "env", "export", "git", "docker", "mount", "crontab", "systemctl"}
FILE_CMDS = {"ls", "cat", "head", "tail", "wc", "grep", "sort", "uniq", "mkdir", "touch", "cp", "mv", "rm", "stat", "cut", "basename", "dirname"}
OPS_OK = {"|", ">", ">>"}
MAX_OUT = 2000


@dataclass
class Result:
    command: str
    ok: bool
    out: str
    code: int = 0
    secs: float = 0.0
    refused: str = ""             # why it did not run ("" = it ran)
    needs_confirmation: bool = False


def _limits() -> None:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))


class SandboxTerminal:
    def __init__(self, workdir: str | None = None, log_path: str | None = None, timeout: int = 8):
        self._own = workdir is None
        self.dir = os.path.realpath(workdir or tempfile.mkdtemp(prefix="tldm_term_"))
        os.makedirs(self.dir, exist_ok=True)
        self.log_path, self.timeout, self.task = log_path, timeout, ""

    def close(self) -> None:
        if self._own:
            shutil.rmtree(self.dir, ignore_errors=True)

    # -- path rule: inside the working directory, nothing else
    def _inside(self, arg: str) -> bool:
        if arg.startswith("~") or os.path.isabs(arg):
            return False
        return os.path.realpath(os.path.join(self.dir, arg)).startswith(self.dir + os.sep) or os.path.realpath(os.path.join(self.dir, arg)) == self.dir

    def _parse(self, command: str):
        """-> (stages, redirect) or an error string. stages = list of argv lists."""
        try:
            lex = shlex.shlex(command, posix=True, punctuation_chars=True)
            lex.whitespace_split = True
            toks = list(lex)
        except ValueError as exc:
            return f"unparsable command ({exc})"
        stages, cur, redirect, i = [], [], None, 0
        while i < len(toks):
            t = toks[i]
            if t and all(c in "();<>|&" for c in t):
                if t not in OPS_OK:
                    return f"operator {t!r} is not allowed"
                if t == "|":
                    if not cur:
                        return "empty pipe stage"
                    stages.append(cur); cur = []
                else:
                    if i + 1 >= len(toks) or redirect is not None:
                        return "bad redirect"
                    redirect = (t, toks[i + 1]); i += 1
            else:
                cur.append(t)
            i += 1
        if cur:
            stages.append(cur)
        if not stages:
            return "empty command"
        return stages, redirect

    def _check(self, argv: list[str]) -> str:
        name = argv[0]
        if name in REFUSED:
            return f"{name} is forbidden"
        if name not in ALLOWED and name not in CONFIRM:
            return f"{name} is not on the allowed list"
        if name in FILE_CMDS:
            args = [a for a in argv[1:] if not a.startswith("-")]
            if name == "grep" and args:
                args = args[1:]                                   # the first positional of grep is the pattern
            for a in args:
                if not self._inside(a):
                    return f"path {a!r} is outside the working directory"
        if name == "rm" and any(a.startswith("-") and ("r" in a or "f" in a) for a in argv[1:]):
            return "rm with -r / -f is forbidden"
        if name == "python3":
            if len(argv) >= 3 and argv[1] == "-c":
                code = argv[2]
            elif len(argv) == 2 and not argv[1].startswith("-"):
                if not self._inside(argv[1]):
                    return "script path is outside the working directory"
                try:
                    code = open(os.path.join(self.dir, argv[1]), encoding="utf-8").read()
                except OSError:
                    return "script not found"
            else:
                return "python3 is allowed only as `python3 FILE` or `python3 -c CODE`"
            if PY_FORBIDDEN.search(code):
                return "python code uses a forbidden construct"
        return ""

    def run(self, command: str, confirm: bool = False) -> Result:
        t0 = time.time()
        res = self._run(command, confirm)
        res.secs = round(time.time() - t0, 3)
        self._log(res)
        return res

    def _run(self, command: str, confirm: bool) -> Result:
        parsed = self._parse(command.strip())
        if isinstance(parsed, str):
            return Result(command, False, "", 126, refused=parsed)
        stages, redirect = parsed
        needs = False
        for argv in stages:
            why = self._check(argv)
            if why:
                return Result(command, False, "", 126, refused=why)
            needs = needs or argv[0] in CONFIRM
        if redirect and not self._inside(redirect[1]):
            return Result(command, False, "", 126, refused=f"redirect target {redirect[1]!r} is outside the working directory")
        if needs and not confirm:
            return Result(command, False, "", 0, refused="needs the user's confirmation", needs_confirmation=True)
        data, code = None, 0
        for argv in stages:
            exe = sys.executable if argv[0] == "python3" else shutil.which(argv[0], path="/usr/bin:/bin")
            if not exe:
                return Result(command, False, "", 127, refused=f"{argv[0]} is not installed")
            args = ([exe, "-I"] + argv[1:]) if argv[0] == "python3" else ([exe] + argv[1:])
            try:
                p = subprocess.run(args, input=data, cwd=self.dir, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}, capture_output=True, text=True, timeout=self.timeout, preexec_fn=_limits)
            except subprocess.TimeoutExpired:
                return Result(command, False, "timeout", 124)
            data, code = p.stdout, p.returncode
            if code != 0:
                return Result(command, False, (p.stderr or p.stdout).strip()[:MAX_OUT], code)
        out = data or ""
        if redirect:
            mode = "a" if redirect[0] == ">>" else "w"
            with open(os.path.join(self.dir, redirect[1]), mode, encoding="utf-8") as f:
                f.write(out)
            out = ""
        return Result(command, True, out.strip()[:MAX_OUT], 0)

    def _log(self, r: Result) -> None:
        if not self.log_path:
            return
        row = {"task": self.task, "command": r.command, "result": r.out if r.ok or not r.refused else r.refused, "success": r.ok, "refused": r.refused, "secs": r.secs, "ts": int(time.time())}
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
