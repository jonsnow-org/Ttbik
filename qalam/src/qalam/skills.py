"""A skill library the model grows by itself: it writes a small Python function WITH tests, the tests run in a throw-away process, and only a skill whose tests pass
becomes active. Versions are kept (rollback), names cannot shadow a built-in tool, and code that reaches for the operating system, the network or dynamic
execution is rejected before it runs.

HONEST LIMIT: the AST screen and the resource limits here are a development harness, NOT a security boundary. In production the tests must run through the caller's
real sandbox (`runner`), the isolated computer. Activating a skill that touches the outside world also needs approval (governance `skill_activate_external`)."""
from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from . import tools

NAME = re.compile(r"^[a-z][a-z0-9_]{2,40}$")
BANNED_IMPORTS = {"os", "sys", "subprocess", "socket", "shutil", "ctypes", "multiprocessing", "threading", "importlib", "pathlib", "urllib", "http", "requests", "pickle", "marshal", "signal", "resource", "builtins", "inspect", "gc"}
BANNED_CALLS = {"eval", "exec", "compile", "open", "__import__", "input", "getattr", "setattr", "delattr", "globals", "locals", "vars", "breakpoint"}


def screen(code: str) -> str | None:
    """None if acceptable, else why not."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return f"syntax error: {exc.msg}"
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                if a.name.split(".")[0] in BANNED_IMPORTS:
                    return f"import of {a.name} is not allowed"
        elif isinstance(n, ast.ImportFrom):
            if (n.module or "").split(".")[0] in BANNED_IMPORTS or n.level:
                return f"import from {n.module or '.'} is not allowed"
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in BANNED_CALLS:
            return f"call to {n.func.id} is not allowed"
        elif isinstance(n, ast.Attribute) and n.attr.startswith("__") and n.attr.endswith("__") and n.attr not in ("__name__", "__init__", "__len__", "__str__", "__repr__", "__eq__"):
            return f"access to {n.attr} is not allowed"
    return None


def local_runner(code: str, tests: str, timeout: int = 10) -> tuple[bool, str]:
    """Development harness: a fresh interpreter in an empty directory with CPU / memory limits. Replace with the real sandbox in production."""
    def limits() -> None:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout))
        resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "skill.py").write_text(code, encoding="utf-8")
        (Path(d) / "run_tests.py").write_text("from skill import *\n" + tests + "\nprint('SKILL_TESTS_OK')\n", encoding="utf-8")
        try:
            r = subprocess.run([sys.executable, "-E", "-s", "run_tests.py"], cwd=d, capture_output=True, text=True, timeout=timeout + 2, stdin=subprocess.DEVNULL,
                               env={"PATH": os.environ.get("PATH", "")}, preexec_fn=limits)
        except subprocess.TimeoutExpired:
            return False, "tests timed out"
    ok = r.returncode == 0 and "SKILL_TESTS_OK" in r.stdout
    return ok, (r.stdout + r.stderr).strip()[-600:]


class SkillLibrary:
    def __init__(self, root: str | Path, runner: Callable[[str, str], tuple[bool, str]] = local_runner) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.runner = runner

    def _dir(self, name: str) -> Path:
        return self.root / name

    def _meta(self, name: str) -> dict:
        f = self._dir(name) / "meta.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"active": 0, "versions": []}

    def propose(self, name: str, code: str, tests: str, description: str = "") -> tuple[bool, str]:
        """Register a new version ONLY if it screens clean and its tests pass. The previous active version stays until then."""
        if not NAME.match(name):
            return False, "name must be lowercase letters, digits, underscore (3-41 chars)"
        if name in tools.REGISTRY:
            return False, "a skill cannot shadow a built-in tool"
        if not tests.strip() or "assert" not in tests:
            return False, "a skill needs tests that assert something"
        for label, text in (("code", code), ("tests", tests)):
            why = screen(text)
            if why:
                return False, f"{label}: {why}"
        ok, out = self.runner(code, tests)
        if not ok:
            return False, f"tests failed: {out}"
        meta = self._meta(name)
        v = len(meta["versions"]) + 1
        d = self._dir(name)
        d.mkdir(parents=True, exist_ok=True)
        (d / f"v{v}.py").write_text(code, encoding="utf-8")
        (d / f"v{v}_tests.py").write_text(tests, encoding="utf-8")
        meta["versions"].append({"v": v, "description": description})
        meta["active"] = v
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        return True, f"{name} v{v} active"

    def rollback(self, name: str) -> int:
        meta = self._meta(name)
        if meta["active"] <= 1:
            raise ValueError("no earlier version to roll back to")
        meta["active"] -= 1
        (self._dir(name) / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        return meta["active"]

    def get(self, name: str) -> str | None:
        meta = self._meta(name)
        return (self._dir(name) / f"v{meta['active']}.py").read_text(encoding="utf-8") if meta["active"] else None

    def search(self, query: str, limit: int = 5) -> list[tuple[str, str]]:
        words = set(re.findall(r"\w+", query.lower()))
        scored = []
        for d in sorted(self.root.iterdir()):
            if not (d / "meta.json").exists():
                continue
            m = self._meta(d.name)
            desc = next((x["description"] for x in m["versions"] if x["v"] == m["active"]), "")
            hay = set(re.findall(r"\w+", (d.name.replace("_", " ") + " " + desc).lower()))
            if words & hay:
                scored.append((len(words & hay), d.name, desc))
        return [(n, d) for _, n, d in sorted(scored, reverse=True)[:limit]]
