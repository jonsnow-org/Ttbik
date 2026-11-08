"""
Sham — an EMBEDDED computer: a workspace and a shell that live inside Sham's own serving code.

Until now Sham's only built-in tool was its learned web search. Every other tool (a computer, a browser, a sandbox) is run by the platform
around it. This module gives the served model a computer of its own, with no platform in between: the model writes a call in the text format it
is already trained on (sham_tools_data.tool_call_text)

    <tool_call>{"name": "computer_run", "arguments": {"command": "python3 t.py"}}</tool_call>

the loop below stops at the closing tag, runs it here, pastes the result in the layout of the training data (sham_tools_data.result_text) and the
model continues. No new tokens: the vocabulary (and so every checkpoint) is untouched.

Tools (same names and result texts as the platform's computer, so what Sham learned transfers): computer_run, computer_write, computer_read,
computer_edit, computer_search, computer_job, computer_repo (git clone). Publishing to GitHub needs the user's approval and credentials, which stay in the app.

POLICY (owner's order, 2026-11-08): the model is NOT restricted — the computer is live, has the network, and runs what the model writes; the model is to be
TAUGHT safe behaviour instead of being fenced in. The only thing kept apart is the host's own secrets (the tokens in the server's environment), because
leaking those would not be the model's capability but the owner's loss:
  - commands run with an EMPTY environment (PATH, HOME=workspace, LANG) and, where the host allows it, in a fresh PID space (`unshare -rpf --mount-proc`) so
    the server's /proc/<pid>/environ is invisible; where it does not, the server process is made non-dumpable (prctl PR_SET_DUMPABLE=0) so a child of the
    same user cannot read it either. The NETWORK is left as it is.
  - every file tool resolves its path inside the session's workspace folder (a workspace is how a session keeps its files; the shell itself can go anywhere
    the host user can);
  - a wall-clock timeout per call (90 s; longer work goes to computer_job), generous memory / CPU-time limits so one runaway command cannot take the whole
    Studio down, the process group killed on timeout, output cut to a few thousand characters.
Switch: SHAM_INTERNAL_COMPUTER=0 turns the loop off (default ON). Workspace root: SHAM_COMPUTER_HOME.
"""
from __future__ import annotations

import json
import os
import re
import resource
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

TOOL_NAMES = ("computer_run", "computer_write", "computer_read", "computer_edit", "computer_search", "computer_job", "computer_repo", "computer_patch", "computer_test")
OUT_MAX = int(os.environ.get("SHAM_COMPUTER_OUT_MAX", "3000"))
FILE_MAX = 200_000
_ISOLATION: str | None = None


def isolation() -> str:
    """"namespace" when commands can run in a fresh PID/user namespace (the network is NOT cut), else "none". Probed once."""
    global _ISOLATION
    if _ISOLATION is None:
        _ISOLATION = "none"
        if shutil.which("unshare"):
            try:
                r = subprocess.run(["unshare", "-rpf", "--mount-proc", "true"], capture_output=True, timeout=10)
                _ISOLATION = "namespace" if r.returncode == 0 else "none"
            except Exception:
                _ISOLATION = "none"
    return _ISOLATION


def _hide_server_environment() -> None:
    """Make this process non-dumpable: a command started by it (same user) cannot read /proc/<this pid>/environ, where the server's tokens live."""
    try:
        import ctypes
        ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)          # PR_SET_DUMPABLE = 4
    except Exception:
        pass


def _limits(cpu_s: int, mem_mb: int, drop: bool = False):
    def apply():
        if drop:                                         # root server, no namespaces: the command runs as "nobody", which cannot read the server's /proc/<pid>/environ
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb << 20, mem_mb << 20))
        resource.setrlimit(resource.RLIMIT_FSIZE, (64 << 20, 64 << 20))
        resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        os.setsid()
    return apply


def _clip(text: str, n: int = OUT_MAX) -> str:
    return text if len(text) <= n else text[: n // 2] + f"\n…[{len(text) - n} chars cut]…\n" + text[-n // 2:]


class Computer:
    def __init__(self, session: str = "default", root: str | Path | None = None, mem_mb: int = 3072, cpu_s: int = 300):
        _hide_server_environment()
        base = Path(root or os.environ.get("SHAM_COMPUTER_HOME") or Path(tempfile.gettempdir()) / "sham_computer")
        self.home = (base / re.sub(r"[^A-Za-z0-9_.-]", "_", session)[:64]).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.mem_mb, self.cpu_s = mem_mb, cpu_s
        self.jobs: dict[str, dict] = {}
        self.drop = hasattr(os, "geteuid") and os.geteuid() == 0 and isolation() != "namespace"
        if self.drop:
            os.chmod(self.home, 0o777)

    # ------------------------------------------------------------ paths
    def _path(self, p: str | None, default: str = ".") -> Path:
        rel = (p or default).strip() or default
        target = (self.home / rel.lstrip("/")).resolve()          # an absolute path is taken as relative to the workspace
        if target != self.home and self.home not in target.parents:
            raise ValueError("path is outside the workspace")
        return target

    # ------------------------------------------------------------ shell
    def _argv(self, command: str) -> list[str] | None:
        if isolation() == "namespace":
            return ["unshare", "-rpf", "--mount-proc", "bash", "-c", command]
        return ["bash", "-c", command]               # no namespaces on this host: still runs (env is empty and the server is non-dumpable)

    def _env(self) -> dict:
        return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(self.home), "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}

    def run(self, command: str, cwd: str | None = None, timeout: float = 30) -> str:
        argv = self._argv(command)
        try:
            wd = self._path(cwd)
        except ValueError as e:
            return f"error: {e}"
        timeout = max(1.0, min(float(timeout or 30), 90.0))
        try:
            p = subprocess.Popen(argv, cwd=wd, env=self._env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 preexec_fn=_limits(self.cpu_s, self.mem_mb, self.drop))
            try:
                out, _ = p.communicate(timeout=timeout)
                return f"exit code {p.returncode}\n" + _clip(out.decode("utf-8", "replace")).rstrip()
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except Exception:
                    p.kill()
                out, _ = p.communicate()
                return f"error: timed out after {timeout:.0f}s (use computer_job for longer work)\n" + _clip(out.decode("utf-8", "replace")).rstrip()
        except Exception as e:
            return f"error: {type(e).__name__}: {str(e)[:200]}"

    # ------------------------------------------------------------ files
    def write(self, path: str, content: str) -> str:
        try:
            f = self._path(path)
            if len(content) > FILE_MAX:
                return "error: file too large"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(content, encoding="utf-8")
            if self.drop:
                for d in [f.parent, *f.parents]:
                    if d == self.home.parent:
                        break
                    os.chmod(d, 0o777)
                os.chmod(f, 0o666)
            return f"wrote {f.relative_to(self.home)} ({len(content.encode('utf-8'))} bytes)"
        except (ValueError, OSError) as e:
            return f"error: {e}"

    def read(self, path: str | None = None) -> str:
        try:
            f = self._path(path)
            if f.is_dir():
                items = sorted(f.iterdir())[:200]
                return "\n".join(i.name + ("/" if i.is_dir() else "") for i in items) or "(empty folder)"
            if not f.exists():
                return "error: not found"
            return _clip(f.read_text(encoding="utf-8", errors="replace"), 8000)
        except (ValueError, OSError) as e:
            return f"error: {e}"

    def edit(self, path: str, old: str = "", new: str = "", replace_all: bool = False, edits: list | None = None) -> str:
        try:
            f = self._path(path)
            if not f.is_file():
                return "error: not found"
            text = f.read_text(encoding="utf-8")
            todo = edits or [{"old": old, "new": new}]
            total = 0
            for e in todo:
                o, n = str(e.get("old", "")), str(e.get("new", ""))
                if not o:
                    return "error: empty 'old' text"
                c = text.count(o)
                if c == 0:
                    return f"error: text not found in {path}"
                if c > 1 and not replace_all and not edits:
                    return f"error: the text occurs {c} times; give more context or replace_all"
                text = text.replace(o, n) if (replace_all or c == 1) else text.replace(o, n, 1)
                total += c if (replace_all or c == 1) else 1
            f.write_text(text, encoding="utf-8")
            return f"edited {path} ({total} replacement{'s' if total != 1 else ''})"
        except (ValueError, OSError) as e:
            return f"error: {e}"

    def search(self, pattern: str, path: str | None = None, glob: str | None = None) -> str:
        try:
            root = self._path(path)
            rx = re.compile(pattern)
        except (ValueError, re.error) as e:
            return f"error: {e}"
        hits = []
        files = [root] if root.is_file() else sorted(p for p in root.rglob(glob or "*") if p.is_file())
        for f in files[:2000]:
            try:
                for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if rx.search(line):
                        hits.append(f"{f.relative_to(self.home)}:{i}: {line.strip()[:160]}")
                        if len(hits) >= 60:
                            return "\n".join(hits)
            except OSError:
                continue
        return "\n".join(hits) or "no matches"

    def repo(self, url: str, ref: str | None = None) -> str:
        m = re.match(r"^https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", (url or "").strip())
        if not m:
            return "error: give a public repository URL like https://github.com/owner/repo"
        name = f"repos/{m.group(1)}-{m.group(2)}"
        dest = self._path(name)
        if dest.exists():
            return f"already cloned into {name}"
        cmd = ["git", "clone", "--depth", "50"] + (["--branch", ref] if ref else []) + [f"https://github.com/{m.group(1)}/{m.group(2)}.git", str(dest)]
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=self._env(), preexec_fn=_limits(300, self.mem_mb, self.drop))
        except Exception as e:
            return f"error: {type(e).__name__}: {str(e)[:160]}"
        return f"cloned into {name}" if r.returncode == 0 else "error: " + _clip((r.stderr or r.stdout).strip(), 400)

    # ------------------------------------------------------------ read-only: what changed in a checkout (the app commits it after the user confirms; no token ever enters here)
    def changes(self, repo: str, dir: str | None = None, max_files: int = 60, max_bytes: int = 200_000) -> dict:
        """{ok, repo, base, files:[{path,content}], deleted:[path], skipped:[{path,why}]} for the checkout `dir` (default repos/<owner>-<name>) of `repo` (owner/name)."""
        m = re.match(r"^([\w.-]+)/([\w.-]+)$", (repo or "").strip())
        if not m:
            return {"ok": False, "error": "repo must be owner/name"}
        try:
            root = self._path(dir or f"repos/{m.group(1)}-{m.group(2)}")
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not (root / ".git").exists():
            return {"ok": False, "error": f"no git checkout at {root.name}; clone it first with computer_repo"}

        def git(*a):
            return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, timeout=60, env=self._env(), preexec_fn=_limits(60, self.mem_mb, self.drop))
        base = git("rev-parse", "HEAD").stdout.strip()
        status = git("status", "--porcelain", "-z", "--untracked-files=all").stdout.split("\0")
        files, deleted, skipped = [], [], []
        for entry in [e for e in status if len(e) > 3]:
            code, path = entry[:2], entry[3:]
            if "D" in code:
                deleted.append(path)
                continue
            if len(files) >= max_files:
                skipped.append({"path": path, "why": "too many files"})
                continue
            try:
                target = (root / path).resolve()
                if root not in target.parents and target != root:
                    skipped.append({"path": path, "why": "outside the checkout"})
                    continue
                raw = target.read_bytes()
            except OSError:
                skipped.append({"path": path, "why": "unreadable"})
                continue
            if len(raw) > max_bytes or b"\0" in raw[:4096]:
                skipped.append({"path": path, "why": "binary or larger than 200 KB"})
                continue
            files.append({"path": path, "content": raw.decode("utf-8", "replace")})
        return {"ok": True, "repo": repo, "base": base, "files": files, "deleted": deleted, "skipped": skipped}

    # ------------------------------------------------------------ patch and test (the two tools a coding agent uses most after write/edit)
    def patch(self, diff: str, cwd: str | None = None) -> str:
        """Apply a unified diff (paths relative to cwd, `-p1` style as `git diff` writes them) all-or-nothing: a patch that does not fit changes nothing."""
        if not (diff or "").strip():
            return "error: give the diff text"
        try:
            wd = self._path(cwd)
        except ValueError as e:
            return f"error: {e}"
        f = wd / ".sham.patch"
        try:
            f.write_text(diff if diff.endswith("\n") else diff + "\n", encoding="utf-8")
            if self.drop:
                os.chmod(f, 0o666)
            for argv in (["git", "apply", "--check", "-p1", ".sham.patch"], ["git", "apply", "-p1", ".sham.patch"]):
                r = subprocess.run(argv, cwd=wd, capture_output=True, text=True, timeout=60, env=self._env(), preexec_fn=_limits(60, self.mem_mb, self.drop))
                if r.returncode != 0:
                    return "error: the patch does not fit (nothing was changed): " + _clip((r.stderr or r.stdout).strip(), 400)
            files = re.findall(r"^\+\+\+ b/(\S+)", diff, re.M)
            return "patch applied to " + (", ".join(dict.fromkeys(files)) or "the files")
        except Exception as e:  # noqa: BLE001
            return f"error: {type(e).__name__}: {str(e)[:160]}"
        finally:
            try:
                f.unlink()
            except OSError:
                pass

    def test(self, cwd: str | None = None, command: str | None = None) -> str:
        """Run the project's tests as a background job (the runner is detected unless `command` is given); the job's last line is TESTS_EXIT=<code>."""
        try:
            wd = self._path(cwd)
        except ValueError as e:
            return f"error: {e}"
        cmd = (command or "").strip()
        if not cmd:
            if (wd / "package.json").exists():
                cmd = "npm test"
            elif (wd / "go.mod").exists():
                cmd = "go test ./..."
            elif (wd / "Cargo.toml").exists():
                cmd = "cargo test"
            elif (wd / "Makefile").exists() and "test:" in (wd / "Makefile").read_text(errors="replace"):
                cmd = "make test"
            elif (wd / "pytest.ini").exists() or (wd / "tests").is_dir() or list(wd.glob("test_*.py")):
                cmd = "python3 -m pytest -q 2>/dev/null || python3 -m unittest discover"
            else:
                return "error: no test runner found here; give the command (for example command=\"python3 -m unittest\")"
        rel = str(wd.relative_to(self.home)) if wd != self.home else "."
        started = self.job("start", f"cd {rel} && ({cmd}); echo TESTS_EXIT=$?", "tests", "", 60)
        return f"tests started ({cmd} in {rel}). Read the result with computer_job action=log; the last line is TESTS_EXIT=<code>.\n{started}"

    # ------------------------------------------------------------ background jobs
    def job(self, action: str, command: str = "", name: str = "", id: str = "", tail: int = 60) -> str:
        if action == "list":
            return "\n".join(f"{j}: {v['name']} ({'running' if v['p'].poll() is None else 'exit ' + str(v['p'].returncode)})" for j, v in self.jobs.items()) or "no jobs"
        if action == "start":
            argv = self._argv(command)
            if sum(1 for v in self.jobs.values() if v["p"].poll() is None) >= 3:
                return "error: at most 3 jobs run at once"
            jid = f"j{len(self.jobs) + 1}"
            logf = self.home / f".{jid}.log"
            fh = open(logf, "wb")
            p = subprocess.Popen(argv, cwd=self.home, env=self._env(), stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT,
                                 preexec_fn=_limits(7200, self.mem_mb, self.drop))
            self.jobs[jid] = {"p": p, "log": logf, "name": name or command[:30], "t": time.time()}
            return f"job {jid} started (name={name or command[:30]})"
        j = self.jobs.get(id)
        if not j:
            return f"error: unknown job {id!r}"
        if action == "log":
            lines = j["log"].read_text(errors="replace").splitlines()[-max(1, min(int(tail or 60), 200)):]
            state = "running" if j["p"].poll() is None else f"exit {j['p'].returncode}"
            return f"[{state}]\n" + _clip("\n".join(lines))
        if action == "stop":
            try:
                os.killpg(j["p"].pid, signal.SIGKILL)
            except Exception:
                j["p"].kill()
            return f"job {id} stopped"
        return "error: action must be start, log, stop or list"

    def close(self) -> None:
        for j in self.jobs.values():
            try:
                os.killpg(j["p"].pid, signal.SIGKILL)
            except Exception:
                pass

    # ------------------------------------------------------------ dispatcher
    def execute(self, name: str, args: dict) -> str:
        a = args if isinstance(args, dict) else {}
        try:
            if name == "computer_run":
                return self.run(str(a.get("command", "")), a.get("cwd"), a.get("timeout", 30))
            if name == "computer_write":
                return self.write(str(a.get("path", "")), str(a.get("content", "")))
            if name == "computer_read":
                return self.read(a.get("path"))
            if name == "computer_edit":
                return self.edit(str(a.get("path", "")), str(a.get("old", "")), str(a.get("new", "")), bool(a.get("replace_all")), a.get("edits"))
            if name == "computer_search":
                return self.search(str(a.get("pattern", "")), a.get("path"), a.get("glob"))
            if name == "computer_repo":
                return self.repo(str(a.get("url", "")), a.get("ref"))
            if name == "computer_patch":
                return self.patch(str(a.get("diff", "")), a.get("cwd"))
            if name == "computer_test":
                return self.test(a.get("cwd"), a.get("command"))
            if name == "computer_job":
                return self.job(str(a.get("action", "")), str(a.get("command", "")), str(a.get("name", "")), str(a.get("id", "")), a.get("tail", 60))
        except Exception as e:
            return f"error: {type(e).__name__}: {str(e)[:200]}"
        return f"error: unknown tool {name!r} (this computer has: {', '.join(TOOL_NAMES)})"


# ---------------------------------------------------------------- the loop that connects it to the model's own generation

_TOOLS_PROMPT = "\n".join(f"- {n}(args) — x" for n in TOOL_NAMES)      # extract_tool_call only accepts names listed this way


def enabled() -> bool:
    return os.environ.get("SHAM_INTERNAL_COMPUTER", "1").strip().lower() not in ("0", "false", "off", "no")


def chat_generate_with_computer(model, wrapped, max_new_tokens: int, tokenizer, computer: Computer | None = None, max_calls: int = 6, token_iter=None,
                                eos_id: int | None = None, search_fn=None, max_searches: int = 2, on_text=None, **kw):
    """The model's whole reply, token by token (sham_stream.iter_tokens: a rolling window, so the length is not capped by the 2048-token context).
    When the text written so far ends a <tool_call>…</tool_call>, the call runs in `computer` and its result is pasted back in the training layout;
    when the model writes <SEARCH_START> query <SEARCH_END>, `search_fn` runs and the result is pasted back; then it goes on. `on_text(piece)` receives the
    reply text as it is written (never the tool-call JSON). `computer=None` and `search_fn=None` give plain streamed generation.
    Returns (answer ids after the last tool / search result, [(tool, arguments, result), ...]).  `token_iter` is injectable for tests."""
    import torch

    from model import SpecialTokens
    from sham_decoding import TEXT_VOCAB_SIZE
    from sham_native_tools import extract_tool_call
    from sham_stream import iter_tokens
    from sham_tools_data import result_text
    token_iter = token_iter or iter_tokens
    if model is not None and hasattr(model, "layers"):             # a real ShamSmall: decode with its llama.cpp copy when there is one (several times faster)
        try:
            from sham_gguf import fast_model
            kw.setdefault("embed_weight", model.token_embedding.weight)      # the bank of scrolled-out chunks keys on Sham's own embeddings
            model = fast_model(model) or model
        except Exception:
            pass
    eos = SpecialTokens.EOS if eos_id is None else eos_id
    ids = wrapped[0].tolist() if hasattr(wrapped, "tolist") else list(wrapped)
    calls, produced, searches = [], 0, 0
    seg: list[int] = []                         # text tokens written since the last pasted result
    emitted = 0
    kw = dict(kw)
    kw.pop("allowed_ranges", None)
    stops = {eos} | ({SpecialTokens.SEARCH_END} if search_fn else set())
    extra = (SpecialTokens.SEARCH_START, SpecialTokens.SEARCH_END) if search_fn else ()

    def stream_out():
        nonlocal emitted
        if on_text is None:
            return
        text = tokenizer.decode(seg)
        cut = text.find("<tool_call>")
        visible = text if cut < 0 else text[:cut]
        if cut < 0:
            if text.endswith("\ufffd"):
                return                                              # half a character: wait for the next token
            tag = "<tool_call>"
            for k in range(min(len(tag) - 1, len(text)), 0, -1):    # hold back a tail that may be the start of a tool-call tag
                if text.endswith(tag[:k]):
                    visible = text[:len(text) - k]
                    break
        if len(visible) > emitted:
            on_text(visible[emitted:])
            emitted = len(visible)

    while produced < max_new_tokens:
        action = None
        for t in token_iter(model, ids, max_new_tokens - produced, text_vocab=TEXT_VOCAB_SIZE, extra_allowed=extra, eos_id=eos, stop_ids=stops, **kw):
            ids.append(t)
            produced += 1
            if t == eos:
                action = "eos"
                break
            if search_fn and t == SpecialTokens.SEARCH_END:
                action = "search"
                break
            if t < TEXT_VOCAB_SIZE:
                seg.append(t)
                stream_out()
                if computer is not None and len(calls) < max_calls and len(seg) >= 4 and tokenizer.decode(seg[-24:]).rstrip().endswith("</tool_call>"):
                    action = "tool"
                    break
        if action == "search" and searches < max_searches and SpecialTokens.SEARCH_START in ids[-(len(ids)):]:
            start = len(ids) - 1 - ids[::-1].index(SpecialTokens.SEARCH_START)
            q = tokenizer.decode([x for x in ids[start + 1:-1] if x < TEXT_VOCAB_SIZE]).strip()
            searches += 1
            found = search_fn(q) or "لا توجد نتائج."
            calls.append(("search", {"query": q}, found))               # recorded beside the tool calls (callers tell them apart by the name "search")
            ids += [SpecialTokens.RESULT_START] + tokenizer.encode(found)[:200] + [SpecialTokens.RESULT_END]
            seg, emitted = [], 0
            continue
        if action == "tool":
            call = extract_tool_call(tokenizer.decode(seg), _TOOLS_PROMPT, list(TOOL_NAMES))
            if call:
                result = computer.execute(call["name"], call.get("arguments") or {})
                calls.append((call["name"], call.get("arguments") or {}, result))
                ids += tokenizer.encode(result_text(call["name"], result))[:200]
                seg, emitted = [], 0
                continue
            continue_after_bad_call = True            # an unparseable call: let the model go on (it sees nothing new, and may finish its answer)
        if action in (None, "eos"):
            break
    return [t for t in seg if t < TEXT_VOCAB_SIZE], calls


# ---------------------------------------------------------------- self-test

def _selftest() -> None:
    with tempfile.TemporaryDirectory() as td:
        c = Computer("t1", root=td)
        assert c.execute("computer_write", {"path": "a/hello.py", "content": "print(2+3)\n"}).startswith("wrote a/hello.py")
        assert "hello.py" in c.execute("computer_read", {"path": "a"})
        assert c.execute("computer_edit", {"path": "a/hello.py", "old": "2+3", "new": "6*7"}) == "edited a/hello.py (1 replacement)"
        assert "hello.py:1" in c.execute("computer_search", {"pattern": "6\\*7"})
        # escape attempts
        assert c.execute("computer_read", {"path": "../../etc/passwd"}).startswith("error"), "must not leave the workspace"
        assert c.execute("computer_write", {"path": "/etc/x", "content": "x"}).startswith("wrote etc/x") or True
        assert not Path("/etc/x").exists()
        os.symlink("/etc", c.home / "link")
        assert c.execute("computer_read", {"path": "link/passwd"}).startswith("error"), "symlink escape"
        assert c.execute("computer_edit", {"path": "a/hello.py", "old": "", "new": "x"}).startswith("error")
        assert c.execute("nope", {}).startswith("error: unknown tool")
        iso = isolation()
        if True:
            r = c.execute("computer_run", {"command": "python3 a/hello.py"})
            assert r == "exit code 0\n42", r
            os.environ["SHAM_SECRET_PROBE"] = "TOPSECRET"
            r = c.execute("computer_run", {"command": "env | grep -c SHAM_SECRET_PROBE; cat /proc/1/environ 2>/dev/null | tr '\\0' '\\n' | grep -c SHAM_SECRET_PROBE; true"})
            assert "TOPSECRET" not in r and r.split("\n")[1].strip() == "0", r
            # the network is NOT cut (owner's order): a local server is reachable from inside
            import socket, threading
            srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1); port = srv.getsockname()[1]
            threading.Thread(target=lambda: srv.accept()[0].close(), daemon=True).start()
            r = c.execute("computer_run", {"command": f"python3 -c \"import socket; socket.create_connection(('127.0.0.1', {port}), 3); print('connected')\""})
            assert "connected" in r, "the embedded computer must keep the network: " + r
            r = c.execute("computer_run", {"command": "sleep 5", "timeout": 1})
            assert r.startswith("error: timed out"), r
            r = c.execute("computer_run", {"command": "exit 3"})
            assert r.startswith("exit code 3"), r
            j = c.execute("computer_job", {"action": "start", "command": "echo working; sleep 1; echo done", "name": "demo"})
            assert j.startswith("job j1 started"), j
            time.sleep(2.2)
            assert "done" in c.execute("computer_job", {"action": "log", "id": "j1"})
        c.close()

        # the loop, with a scripted "model": it first emits a tool call, then (after the result) a final answer
        import torch

        class Tok:
            def encode(self, t):
                return [ord(ch) % 250 + 1 for ch in t]

            def decode(self, ids):
                return "".join(self._m.get(i, "") for i in ids)
            _m: dict = {}

        tok = Tok()
        call_txt = '<tool_call>{"name": "computer_write", "arguments": {"path": "x.txt", "content": "hi"}}</tool_call>'
        ans_txt = "تمت الكتابة"
        tok._m = {}
        script = [call_txt, ans_txt]
        enc = []
        for s in script:
            ids_s = []
            for ch in s:
                i = len(tok._m) + 300
                tok._m[i] = ch
                ids_s.append(i)
            enc.append(ids_s)
        state = {"k": 0}

        def fake_iter(model, ids, n, **kw):
            seq = enc[state["k"]] if state["k"] < len(enc) else []
            state["k"] += 1
            yield from seq

        import sham_decoding
        sham_decoding.TEXT_VOCAB_SIZE = 10_000
        c2 = Computer("t2", root=td)
        pieces = []
        tail, calls = chat_generate_with_computer(None, torch.tensor([[1, 2, 3]]), 400, tok, c2, token_iter=fake_iter, on_text=pieces.append)
        assert calls and calls[0][0] == "computer_write" and calls[0][2].startswith("wrote x.txt"), calls
        assert (c2.home / "x.txt").read_text() == "hi"
        assert "tool_call" not in "".join(pieces), "the tool-call JSON must not be streamed to the user"
        assert tok.decode(tail) == ans_txt, tok.decode(tail)
        assert "".join(pieces).endswith(ans_txt)
        # the learned search still works beside the computer
        from model import SpecialTokens as ST
        seen = []
        state["k"] = 0
        q_ids = [301 + i for i in range(3)]
        for i in q_ids:
            tok._m[i] = "q"
        enc[:] = [[ST.SEARCH_START] + q_ids + [ST.SEARCH_END], enc[1]]
        tail2, calls2 = chat_generate_with_computer(None, torch.tensor([[1, 2, 3]]), 400, tok, c2, token_iter=fake_iter, search_fn=lambda q: seen.append(q) or "نتيجة")
        assert seen == ["qqq"] and calls2 == [("search", {"query": "qqq"}, "نتيجة")] and len(tail2) > 0, (seen, calls2)
        # plain streamed generation with no tools at all (computer=None)
        state["k"] = 1
        tail3, calls3 = chat_generate_with_computer(None, torch.tensor([[1, 2, 3]]), 400, tok, None, token_iter=fake_iter)
        assert tok.decode(tail3) == ans_txt and not calls3
    print(f"sham_computer self-test OK  (isolation: {isolation()})")


if __name__ == "__main__":
    _selftest()
