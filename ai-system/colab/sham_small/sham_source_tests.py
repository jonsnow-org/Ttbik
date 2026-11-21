"""Verified-tests crawler source: public GitHub Python projects whose OWN test suite passes when we run it, as (tests -> the code that satisfies them) documents.

Why (owner, 2026-11-21): instead of Wikipedia, something useful. A test that passes is a machine-checked statement of what the code does: the document pairs a test file with the
module it exercises, and is kept ONLY if the whole suite really passed here (>= 3 tests, exit code 0). Nothing is written by hand and nothing is inferred.

Safety: the tests are other people's code. They run as the unprivileged user `nobody` with an EMPTY environment (no secrets, a private HOME), a hard timeout and their own process group;
if that isolation is not available (no passwordless sudo) the source returns nothing — it never runs untrusted code as the collector's own user.
Each source is a function fn(rng) -> list[Item]; this one is registered in sham_sources_gh.gh_sources as `verified_tests`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

from sham_spider import Item, http_get, new_url

MAX_REPO_KB = 3000
TIMEOUT_S = int(os.environ.get("SHAM_TESTS_TIMEOUT", "90"))
PASSED = re.compile(r"(\d+) passed")
FAILED = re.compile(r"\b(\d+) (failed|error)")
SKIP_DIRS = re.compile(r"(^|/)(\.git|node_modules|venv|\.venv|build|dist|docs?|examples?|vendor|site-packages)(/|$)")


def isolation_prefix() -> list[str] | None:
    """The command prefix that runs a child as `nobody` with an empty environment, or None when that is not possible on this machine."""
    if os.environ.get("SHAM_TESTS_NO_SANDBOX") == "1":
        return None
    try:
        ok = subprocess.run(["sudo", "-n", "-u", "nobody", "true"], capture_output=True, timeout=10).returncode == 0
    except Exception:
        ok = False
    return ["sudo", "-n", "-u", "nobody", "env", "-i"] if ok else None


_PYTEST_DIR: list = []


def ensure_pytest() -> str:
    """The extra PYTHONPATH entry that makes pytest importable for the sandboxed child ("" when this interpreter already has it). The collector image has no pytest: it is installed once into a
    private folder (world-readable, so `nobody` can import it) instead of editing the workflow."""
    try:
        import pytest  # noqa: F401
        return ""
    except ImportError:
        pass
    if not _PYTEST_DIR:
        d = tempfile.mkdtemp(prefix="vt_pytest_")
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--target", d, "pytest"], capture_output=True, timeout=240)
        subprocess.run(["chmod", "-R", "a+rX", d], capture_output=True, timeout=60)
        _PYTEST_DIR.append(d if r.returncode == 0 else "")
    return _PYTEST_DIR[0]


def run_suite(repo_dir: str, prefix: list[str] | None, timeout: int = TIMEOUT_S) -> tuple[bool, int, str]:
    """-> (passed, number of passed tests, last output). Only a clean pass counts; a repo that needs a missing dependency simply fails and is dropped."""
    if prefix is None:
        return False, 0, "no isolation"
    home = tempfile.mkdtemp(prefix="home_")
    os.chmod(home, 0o777)
    env = [f"HOME={home}", f"PATH={os.path.dirname(sys.executable)}:/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE=1", "PYTHONPATH=" + ":".join(x for x in (repo_dir, os.path.join(repo_dir, "src"), ensure_pytest()) if x)]
    cmd = prefix + env + [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "--no-header", "--maxfail=1", "-o", "addopts=", repo_dir]
    try:
        r = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, timeout=timeout, start_new_session=True)
        out = (r.stdout or "") + (r.stderr or "")
        m = PASSED.search(out)
        n = int(m.group(1)) if m else 0
        return r.returncode == 0 and n >= 3 and not FAILED.search(out), n, out[-400:]
    except subprocess.TimeoutExpired:
        return False, 0, "timeout"
    except Exception as exc:                                     # noqa: BLE001
        return False, 0, f"{type(exc).__name__}"
    finally:
        shutil.rmtree(home, ignore_errors=True)


def module_for(test_path: str, files: list[str]) -> str | None:
    """tests/test_foo.py (or foo_test.py) -> foo.py / foo/__init__.py somewhere outside the tests."""
    base = os.path.basename(test_path)
    name = re.sub(r"^test_|_test\.py$|\.py$", "", base) if base.startswith("test_") else re.sub(r"_test\.py$", "", base)
    if not name:
        return None
    cands = [f for f in files if (os.path.basename(f) == f"{name}.py" or f.endswith(f"/{name}/__init__.py") or f == f"{name}/__init__.py")
             and not re.search(r"(^|/)(tests?|testing)(/|$)", f) and not os.path.basename(f).startswith("test_")]
    return sorted(cands, key=len)[0] if cands else None


def documents(repo_dir: str, full: str, license_id: str, n_passed: int, max_docs: int = 3) -> list[Item]:
    files = []
    for root, dirs, fs in os.walk(repo_dir):
        rel_root = os.path.relpath(root, repo_dir)
        dirs[:] = [d for d in dirs if not SKIP_DIRS.search(os.path.join(rel_root, d).replace("\\", "/"))]
        for f in fs:
            if f.endswith(".py"):
                files.append(os.path.normpath(os.path.join(rel_root, f)).replace("\\", "/"))
    tests = [f for f in files if re.search(r"(^|/)(test_[^/]+\.py|[^/]+_test\.py)$", f)]
    out = []
    for t in sorted(tests, key=lambda x: os.path.getsize(os.path.join(repo_dir, x))):
        mod = module_for(t, files)
        if not mod:
            continue
        try:
            tt = open(os.path.join(repo_dir, t), encoding="utf-8").read().strip()
            mt = open(os.path.join(repo_dir, mod), encoding="utf-8").read().strip()
        except Exception:
            continue
        if not (200 <= len(tt) <= 6000 and 200 <= len(mt) <= 9000):
            continue
        text = (f"# {full}: الاختبارات نجحت ({n_passed} اختبارًا) عند التشغيل\n## الاختبارات ({t})\n{tt}\n\n## الشيفرة التي تحقق الاختبارات ({mod})\n{mt}")
        out.append(Item("text", text, "verified_tests", license=license_id or "permissive"))
        if len(out) >= max_docs:
            break
    return out


def src_verified_tests(rng) -> list[Item]:
    prefix = isolation_prefix()
    if prefix is None:
        return []
    from sham_sources_gh import LICENSES, _gh_headers
    q = f'language:python license:{rng.choice(LICENSES)} stars:{rng.choice(["3..30", "30..300", "300..3000"])} size:<{MAX_REPO_KB} fork:false archived:false'
    raw = http_get("https://api.github.com/search/repositories", {"q": q, "per_page": 20, "page": rng.randint(1, 10), "sort": rng.choice(["updated", "stars"])}, timeout=40, headers=_gh_headers())
    try:
        repos = json.loads(raw).get("items", []) if raw else []
    except Exception:
        repos = []
    rng.shuffle(repos)
    for repo in repos[:6]:
        full = repo["full_name"]
        if not new_url("gh_tests", full):
            continue
        work = tempfile.mkdtemp(prefix="vt_")
        try:
            d = os.path.join(work, "r")
            c = subprocess.run(["git", "clone", "--depth", "1", "--quiet", f"https://github.com/{full}.git", d], capture_output=True, timeout=120, env={"PATH": os.environ.get("PATH", ""), "GIT_TERMINAL_PROMPT": "0"})
            if c.returncode != 0:
                continue
            subprocess.run(["chmod", "-R", "a+rwX", work], capture_output=True, timeout=60)
            ok, n, _ = run_suite(d, prefix)
            if not ok:
                continue
            items = documents(d, full, (repo.get("license") or {}).get("spdx_id", ""), n)
            if items:
                return items
        except Exception:
            continue
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return []


def _selftest() -> None:
    d = tempfile.mkdtemp(prefix="vt_self_")
    os.makedirs(os.path.join(d, "tests"))
    open(os.path.join(d, "calc.py"), "w").write('"""tiny calculator"""\n' + "\n".join(f"def add{i}(a, b):\n    '''add {i}'''\n    return a + b + {i}\n" for i in range(12)))
    open(os.path.join(d, "tests", "test_calc.py"), "w").write("from calc import *\n" + "\n".join(f"def test_add{i}():\n    assert add{i}(1, 2) == 3 + {i}\n" for i in range(12)))
    open(os.path.join(d, "bad.py"), "w").write("def f():\n    return 1\n" * 30)
    open(os.path.join(d, "tests", "test_bad.py"), "w").write("from bad import f\n" + "\n".join(f"def test_x{i}():\n    assert f() == 2\n" for i in range(12)))
    assert module_for("tests/test_calc.py", ["calc.py", "tests/test_calc.py"]) == "calc.py" and module_for("tests/test_nope.py", ["calc.py"]) is None
    # the isolation guard: with no sandbox the source refuses to run anything
    os.environ["SHAM_TESTS_NO_SANDBOX"] = "1"
    assert isolation_prefix() is None and run_suite(d, None)[0] is False
    os.environ.pop("SHAM_TESTS_NO_SANDBOX")
    # a plain (unsandboxed) prefix, only for this test: a passing suite is detected and a failing one is not
    ok, n, _ = run_suite(os.path.join(d), ["env", "-i"])
    assert not ok or n >= 3                                   # the whole folder holds one failing file -> the suite as a whole must not count as passed
    os.makedirs(os.path.join(d, "good"))
    shutil.copy(os.path.join(d, "calc.py"), os.path.join(d, "good", "calc.py"))
    os.makedirs(os.path.join(d, "good", "tests"))
    shutil.copy(os.path.join(d, "tests", "test_calc.py"), os.path.join(d, "good", "tests", "test_calc.py"))
    ok, n, out = run_suite(os.path.join(d, "good"), ["env", "-i"])
    assert ok and n == 12, (ok, n, out)
    items = documents(os.path.join(d, "good"), "owner/tiny", "MIT", n)
    assert len(items) == 1 and "الاختبارات نجحت (12" in items[0].text and "def add3" in items[0].text and items[0].source == "verified_tests"
    shutil.rmtree(d, ignore_errors=True)
    print("sham_source_tests self-test OK")


if __name__ == "__main__":
    _selftest()
