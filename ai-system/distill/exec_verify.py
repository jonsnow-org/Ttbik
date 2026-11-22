"""Execution verifier: a teacher's code answer is accepted ONLY if it runs and the hidden tests pass (the "result of the command is the reward" idea of the terminal-model report).

Rules (safety first, because the code comes from a model):
  * the code runs in a child Python process with an EMPTY environment (no API key reaches it), a temp working directory, CPU / memory / file limits and a wall-clock timeout;
  * answers that import the filesystem, the network, subprocesses or dynamic execution are refused before anything runs (coding puzzles do not need them);
  * it is meant for the disposable GitHub runner of sham-distill.yml, never for a server that holds secrets.
Stdlib only.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

FENCE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.S | re.I)
FORBIDDEN = re.compile(
    r"\b(os|sys|socket|subprocess|ctypes|requests|urllib|http|ftplib|smtplib|shutil|pathlib|importlib|signal|threading|multiprocessing|pickle|builtins|inspect|gc)\b"
    r"|\b(open|exec|eval|compile|__import__|input|breakpoint|globals|locals|vars|getattr|setattr|delattr)\s*\(|__[a-z]+__",
    re.I,
)


def _limits() -> None:   # runs in the child before the code starts; the model's code never sees this module
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
    resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))


def extract_code(answer: str) -> str:
    """The first fenced python block, else the whole answer."""
    m = FENCE.search(answer or "")
    return (m.group(1) if m else (answer or "")).strip()


def run_python_tests(answer: str, tests: str, timeout: int = 10) -> tuple[bool, str]:
    code = extract_code(answer)
    if not code:
        return False, "no code"
    if FORBIDDEN.search(code):
        return False, "forbidden construct"
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "check.py")
        open(path, "w", encoding="utf-8").write(code + "\n\n" + tests + "\n")
        try:
            r = subprocess.run([sys.executable, "-I", path], cwd=tmp, env={}, capture_output=True, timeout=timeout, text=True, preexec_fn=_limits)
        except subprocess.TimeoutExpired:
            return False, "timeout"
        if r.returncode == 0:
            return True, "tests passed"
        return False, ((r.stderr or "").strip().splitlines() or ["failed"])[-1][:160]
