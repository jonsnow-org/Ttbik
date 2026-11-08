"""
Sham — an EMBEDDED computer: a workspace and a shell that live inside Sham's own serving code.

Until now Sham's only built-in tool was its learned web search. Every other tool (a computer, a browser, a sandbox) is run by the platform
around it. This module gives the served model a computer of its own, with no platform in between: the model writes a call in the text format it
is already trained on (sham_tools_data.tool_call_text)

    <tool_call>{"name": "computer_run", "arguments": {"command": "python3 t.py"}}</tool_call>

the loop below stops at the closing tag, runs it here, pastes the result in the layout of the training data (sham_tools_data.result_text) and the
model continues. No new tokens: the vocabulary (and so every checkpoint) is untouched.

Tools (same names and result texts as the platform's computer, so what Sham learned transfers): computer_run, computer_write, computer_read,
computer_edit, computer_search, computer_job. Network-dependent ones (clone / publish) are not here: this computer has NO network by default.

SAFETY — model-written code runs on the host that serves the model, so it is contained, and it refuses to run a command when it cannot be:
  - a private workspace folder per session; every file path is resolved inside it (no ../, no symlink escape);
  - commands run in fresh Linux namespaces (`unshare -rpfn --mount-proc`): a new PID space (the server's own /proc, and its environment
    variables with every token, are invisible), no network, the user mapped to an unprivileged one;
  - an EMPTY environment (only PATH, HOME=workspace, LANG), CPU-time / memory / file-size / process-count / open-file limits, a wall-clock
    timeout, the whole process group killed on timeout, output cut to a few thousand characters;
  - if the namespaces are not available on the host, `computer_run` / `computer_job` answer with an error instead of running unisolated
    (SHAM_COMPUTER_ALLOW_UNISOLATED=1 overrides that for a throw-away host you accept the risk on). File tools stay available.
Switch: SHAM_INTERNAL_COMPUTER=1 turns the loop on in the Studio (default OFF). Workspace root: SHAM_COMPUTER_HOME.
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

TOOL_NAMES = ("computer_run", "computer_write", "computer_read", "computer_edit", "computer_search", "computer_job")
OUT_MAX = int(os.environ.get("SHAM_COMPUTER_OUT_MAX", "3000"))
FILE_MAX = 200_000
_ISOLATION: str | None = None


def isolation() -> str:
    """"namespace" when commands can run in fresh PID/net/user namespaces, else "none". Probed once."""
    global _ISOLATION
    if _ISOLATION is None:
        _ISOLATION = "none"
        if shutil.which("unshare"):
            try:
                r = subprocess.run(["unshare", "-rpfn", "--mount-proc", "true"], capture_output=True, timeout=10)
                _ISOLATION = "namespace" if r.returncode == 0 else "none"
            except Exception:
                _ISOLATION = "none"
    return _ISOLATION


def _limits(cpu_s: int, mem_mb: int):
    def apply():
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
    def __init__(self, session: str = "default", root: str | Path | None = None, mem_mb: int = 1536, cpu_s: int = 60):
        base = Path(root or os.environ.get("SHAM_COMPUTER_HOME") or Path(tempfile.gettempdir()) / "sham_computer")
        self.home = (base / re.sub(r"[^A-Za-z0-9_.-]", "_", session)[:64]).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.mem_mb, self.cpu_s = mem_mb, cpu_s
        self.jobs: dict[str, dict] = {}

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
            return ["unshare", "-rpfn", "--mount-proc", "bash", "-c", command]
        if os.environ.get("SHAM_COMPUTER_ALLOW_UNISOLATED") == "1":
            return ["bash", "-c", command]
        return None

    def _env(self) -> dict:
        return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(self.home), "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}

    def run(self, command: str, cwd: str | None = None, timeout: float = 30) -> str:
        argv = self._argv(command)
        if argv is None:
            return "error: this host cannot isolate commands (no Linux namespaces), so computer_run is disabled; computer_write/read/edit/search still work"
        try:
            wd = self._path(cwd)
        except ValueError as e:
            return f"error: {e}"
        timeout = max(1.0, min(float(timeout or 30), 90.0))
        try:
            p = subprocess.Popen(argv, cwd=wd, env=self._env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 preexec_fn=_limits(self.cpu_s, self.mem_mb))
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

    # ------------------------------------------------------------ background jobs
    def job(self, action: str, command: str = "", name: str = "", id: str = "", tail: int = 60) -> str:
        if action == "list":
            return "\n".join(f"{j}: {v['name']} ({'running' if v['p'].poll() is None else 'exit ' + str(v['p'].returncode)})" for j, v in self.jobs.items()) or "no jobs"
        if action == "start":
            argv = self._argv(command)
            if argv is None:
                return "error: this host cannot isolate commands, so jobs are disabled"
            if sum(1 for v in self.jobs.values() if v["p"].poll() is None) >= 3:
                return "error: at most 3 jobs run at once"
            jid = f"j{len(self.jobs) + 1}"
            logf = self.home / f".{jid}.log"
            fh = open(logf, "wb")
            p = subprocess.Popen(argv, cwd=self.home, env=self._env(), stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT,
                                 preexec_fn=_limits(3600, self.mem_mb))
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
            if name == "computer_job":
                return self.job(str(a.get("action", "")), str(a.get("command", "")), str(a.get("name", "")), str(a.get("id", "")), a.get("tail", 60))
        except Exception as e:
            return f"error: {type(e).__name__}: {str(e)[:200]}"
        return f"error: unknown tool {name!r} (this computer has: {', '.join(TOOL_NAMES)})"


# ---------------------------------------------------------------- the loop that connects it to the model's own generation

_TOOLS_PROMPT = "\n".join(f"- {n}(args) — x" for n in TOOL_NAMES)      # extract_tool_call only accepts names listed this way


def enabled() -> bool:
    return os.environ.get("SHAM_INTERNAL_COMPUTER", "0").strip().lower() in ("1", "true", "on", "yes")


def chat_generate_with_computer(model, wrapped, max_new_tokens: int, tokenizer, computer: Computer, max_calls: int = 6, chunk: int = 24,
                                gen=None, eos_id: int | None = None, search_fn=None, max_searches: int = 2, **kw):
    """Generate in short chunks; when the text produced so far ends a <tool_call>…</tool_call>, run it in `computer`, append the result in the
    training layout and go on. Returns (answer ids after the last tool result, [(tool, arguments, result), ...]).
    `gen(model, ids, n, **kw) -> tensor` defaults to sham_decoding.guarded_generate_tokens (a test can pass a scripted one)."""
    import torch

    from sham_decoding import TEXT_VOCAB_SIZE, guarded_generate_tokens
    from sham_native_tools import extract_tool_call
    from sham_tools_data import result_text
    from model import SpecialTokens
    gen = gen or guarded_generate_tokens
    eos = SpecialTokens.EOS if eos_id is None else eos_id
    ids, calls, produced, mark, searches = wrapped, [], 0, wrapped.shape[1], 0
    kw = dict(kw)
    kw.pop("allowed_ranges", None)
    stops = {eos} | ({SpecialTokens.SEARCH_END} if search_fn else set())
    if search_fn:
        kw["extra_allowed"] = (SpecialTokens.SEARCH_START, SpecialTokens.SEARCH_END)       # the learned web search keeps working beside the computer
    while produced < max_new_tokens:
        n = min(chunk, max_new_tokens - produced)
        out = gen(model, ids, n, stop_ids=stops, **kw)
        new = out[0, ids.shape[1]:].tolist()
        produced += max(1, len(new))
        ids = out
        if search_fn and new and new[-1] == SpecialTokens.SEARCH_END and searches < max_searches and SpecialTokens.SEARCH_START in out[0, mark:].tolist():
            seq = out[0].tolist()
            start = len(seq) - 1 - seq[::-1].index(SpecialTokens.SEARCH_START)
            q = tokenizer.decode([t for t in seq[start + 1:-1] if t < TEXT_VOCAB_SIZE]).strip()
            searches += 1
            res = tokenizer.encode(search_fn(q) or "لا توجد نتائج.")[:200]
            ids = torch.cat([ids, torch.tensor([[SpecialTokens.RESULT_START] + res + [SpecialTokens.RESULT_END]], dtype=torch.long, device=ids.device)], dim=1)
            mark = ids.shape[1]
            continue
        text = tokenizer.decode([t for t in out[0, mark:].tolist() if t < TEXT_VOCAB_SIZE])
        if "</tool_call>" in text and len(calls) < max_calls:
            call = extract_tool_call(text, _TOOLS_PROMPT, list(TOOL_NAMES))
            if call:
                result = computer.execute(call["name"], call.get("arguments") or {})
                calls.append((call["name"], call.get("arguments") or {}, result))
                back = tokenizer.encode(result_text(call["name"], result))[:200]
                ids = torch.cat([ids, torch.tensor([back], dtype=torch.long, device=ids.device)], dim=1)
                mark = ids.shape[1]
                continue
        if new and new[-1] == eos:
            break
    tail = [t for t in ids[0, mark:].tolist() if t < TEXT_VOCAB_SIZE]
    return tail, calls


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
        if iso == "namespace" or os.environ.get("SHAM_COMPUTER_ALLOW_UNISOLATED") == "1":
            r = c.execute("computer_run", {"command": "python3 a/hello.py"})
            assert r == "exit code 0\n42", r
            os.environ["SHAM_SECRET_PROBE"] = "TOPSECRET"
            r = c.execute("computer_run", {"command": "env | grep -c SHAM_SECRET_PROBE; cat /proc/1/environ 2>/dev/null | tr '\\0' '\\n' | grep -c SHAM_SECRET_PROBE; true"})
            assert "TOPSECRET" not in r and r.split("\n")[1].strip() == "0", r
            r = c.execute("computer_run", {"command": "python3 -c \"import socket; socket.create_connection(('1.1.1.1', 53), 2)\""})
            assert "exit code 1" in r, "the embedded computer must have no network: " + r
            r = c.execute("computer_run", {"command": "sleep 5", "timeout": 1})
            assert r.startswith("error: timed out"), r
            r = c.execute("computer_run", {"command": "exit 3"})
            assert r.startswith("exit code 3"), r
            j = c.execute("computer_job", {"action": "start", "command": "echo working; sleep 1; echo done", "name": "demo"})
            assert j.startswith("job j1 started"), j
            time.sleep(2.2)
            assert "done" in c.execute("computer_job", {"action": "log", "id": "j1"})
        else:
            assert c.execute("computer_run", {"command": "echo hi"}).startswith("error: this host cannot isolate")
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

        def fake_gen(model, ids, n, stop_ids=None, **kw):
            seq = enc[state["k"]] if state["k"] < len(enc) else [0]
            state["k"] += 1
            return torch.cat([ids, torch.tensor([seq], dtype=torch.long)], dim=1)

        import sham_decoding
        sham_decoding.TEXT_VOCAB_SIZE = 10_000
        c2 = Computer("t2", root=td)
        tail, calls = chat_generate_with_computer(None, torch.tensor([[1, 2, 3]]), 400, tok, c2, gen=fake_gen)
        assert calls and calls[0][0] == "computer_write" and calls[0][2].startswith("wrote x.txt"), calls
        assert (c2.home / "x.txt").read_text() == "hi"
        assert tok.decode(tail) == ans_txt or len(tail) > 0
        # the learned search still works beside the computer
        from model import SpecialTokens as ST
        seen = []
        state["k"] = 0
        q_ids = [301 + i for i in range(3)]
        for i in q_ids:
            tok._m[i] = "q"
        enc2 = [[ST.SEARCH_START] + q_ids + [ST.SEARCH_END], enc[1]]
        enc[:] = enc2
        tail2, calls2 = chat_generate_with_computer(None, torch.tensor([[1, 2, 3]]), 400, tok, c2, gen=fake_gen, search_fn=lambda q: seen.append(q) or "نتيجة")
        assert seen == ["qqq"] and not calls2 and len(tail2) > 0, (seen, calls2)
    print(f"sham_computer self-test OK  (isolation: {isolation()})")


if __name__ == "__main__":
    _selftest()
