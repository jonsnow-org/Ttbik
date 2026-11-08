"""free i as an agent: the owner's Telegram message is a COMMAND and this loop carries it out (analyse a project, edit files, run tests,
open and merge pull requests, start a deploy workflow), the way a Claude Code session does, with a free OpenRouter model as the brain.

How it works: the model answers each step with ONE JSON object {"tool": ..., "args": {...}}; this file runs the tool and feeds the result back,
until the model calls "final". Everything runs on the GitHub Actions runner of .github/workflows/ai-agent.yml.

Guard rails (code, not a prompt; the model cannot talk its way past them):
- writes never touch athar/, cloudflare/, deploy/oracle/, .github/workflows/, secrets or instruction files (ai_agent.path_problem);
- the repository is changed only on a branch `ai/issue-N-…` and reaches the default branch only through a pull request;
- merge_pr refuses #184, #505 and #237, a pull request that touches a protected path, and any base other than the default branch or main;
- shell commands are an allow-list of tests, linters and read-only git; no pipes, redirects or substitutions;
- workflows that may be started: deploy / sham / nova / computer / studio families only (never athar, cloudflare, this agent, the main sync);
- a step limit and a time limit; every tool result is cut to a few thousand characters.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path

import ai_agent as A

MAX_STEPS = 30
MAX_SECONDS = 40 * 60
OUT_LIMIT = 5000
NEVER_MERGE = {184, 505, 237}
WORKFLOW_ALLOW = re.compile(r"^(deploy-|sham-|nova-|computer-|keep-warm|redeploy|push-studio|studio-|inspect-|modes-|all-models-|time-image)[\w.-]*\.yml$")
WORKFLOW_DENY = re.compile(r"athar|cloudflare|ai-agent|ai-telegram|sync-main|npm-publish")
RUN_ALLOW = [re.compile(p) for p in (
    r"^python3? -m (unittest|pytest|py_compile)\b", r"^python3? [\w./-]+\.py\b", r"^node --test\b", r"^node --experimental-strip-types\b",
    r"^node scripts/[\w./-]+\.mjs\b", r"^npx (tsc|jest|eslint)\b", r"^npm (test|run (lint|build|test))\b", r"^cd [\w./-]+$",
    r"^git (status|diff|log|show|ls-files|branch)\b", r"^ls\b", r"^cat [\w./-]+$", r"^wc\b", r"^head\b", r"^tail\b", r"^grep\b",
)]
META = re.compile(r"[;|`<>\n]|\$\(")

SYSTEM = """You are free i, the owner's agent. The owner commands you through Telegram and you CARRY OUT the command with tools, like a coding assistant; you do not just advise.
Reply to EVERY step with exactly ONE JSON object and nothing else: {"tool": "<name>", "args": {...}}. When the work is done (or the message was only a question or a greeting), call
{"tool": "final", "args": {"message": "<what you did, in the owner's language, short, honest>"}}. Answer greetings and plain questions with "final" at once. Write only in the owner's language (Arabic by default); never mix in Chinese or other scripts.

Tools (args):
- list_files {path?}: tracked files under a folder (default root).
- read_file {path, start?, end?}: a file, by line window (default the first 300 lines).
- search {query, path?}: grep -rn in tracked files.
- write_file {path, content}: create or replace a whole file (on your branch).
- edit_file {path, old, new}: replace one exact text in a file.
- run {cmd}: a test / lint / read-only git command (allow-list; `&&` chains allowed, no pipes or redirects).
- open_pr {title, body, base?}: commit your edits on the branch and open a pull request into the default branch (or base).
- open_pull {head, base, title, body}: open a pull request between two existing branches (for example the default branch into main).
- merge_pr {number}: merge a pull request (merge commit). Refuses protected ones.
- run_workflow {workflow, inputs?}: start a workflow_dispatch workflow of the deploy / sham / nova / computer / studio families on the default branch.
- workflow_runs {workflow}: the latest runs of one workflow (status, conclusion, link).
- final {message}.

Facts: default branch = the production branch (Vercel and the scheduled jobs use it); `main` is followed by Oracle: to ship, merge into the default branch, then open_pull default -> main and merge it.
Athar (athar/, cloudflare/, deploy/oracle/) is never touched. Never print or ask for secrets. Free CPU only. Read before you edit; test before you open a pull request when a test exists.
Never claim something was done unless a tool result says so; if a tool failed, say it failed. Prefer a few well-chosen steps over many."""


# ------------------------------------------------------------------ pure helpers (tested)

def read_problem(path: str) -> str | None:
    p = path.replace("\\", "/").strip()
    if not p or p.startswith("/") or re.match(r"^[A-Za-z]:", p) or ".." in p.split("/"):
        return "bad path"
    if re.search(r"(secret|token|credential|private[_-]?key|\.pem$|\.p12$|\.env($|\.))", p.lower()):
        return "secret-looking file"
    return None


def command_problem(cmd: str) -> str | None:
    cmd = cmd.strip()
    if not cmd or len(cmd) > 400:
        return "empty or too long"
    if META.search(cmd):
        return "pipes, redirects, substitutions and `;` are not allowed (use &&)"
    for part in [c.strip() for c in cmd.split("&&")]:
        if not any(p.search(part) for p in RUN_ALLOW):
            return f"not in the allow-list: {part[:60]}"
    return None


def workflow_problem(name: str) -> str | None:
    if "/" in name or not WORKFLOW_ALLOW.match(name) or WORKFLOW_DENY.search(name):
        return "this workflow may not be started by the agent"
    return None


_ALIASES = {"bash": "run", "shell": "run", "exec": "run", "read": "read_file", "cat": "read_file", "write": "write_file", "edit": "edit_file",
            "grep": "search", "ls": "list_files", "list": "list_files", "finish": "final", "done": "final", "answer": "final"}
_ARG_ALIASES = (("command", "cmd"), ("file_path", "path"), ("filepath", "path"), ("filename", "path"), ("file", "path"), ("directory", "path"),
                ("dir", "path"), ("pattern", "query"), ("text", "message"), ("content_text", "content"), ("old_string", "old"), ("new_string", "new"))
_XML_CALL = re.compile(r"<function=([\w.-]+)>(.*?)</function>", re.S)
_XML_PARAM = re.compile(r"<parameter=([\w.-]+)>\s*(.*?)\s*</parameter>", re.S)
_PY_CALL = re.compile(r"<\|tool_call_start\|>\s*\[?\s*([\w.-]+)\((.*?)\)\s*\]?\s*<\|tool_call_end\|>", re.S)


def _normalise(tool: str, args: dict) -> dict:
    tool = _ALIASES.get(tool, tool)
    args = dict(args)
    for a, b in _ARG_ALIASES:
        if a in args and b not in args:
            args[b] = args.pop(a)
    if isinstance(args.get("inputs"), str):                           # a dict sent as a JSON string
        try:
            args["inputs"] = json.loads(args["inputs"])
        except ValueError:
            args.pop("inputs")
    return {"tool": tool, "args": args}


def parse_step(text: str) -> dict | None:
    """One tool call from the model, in whichever dialect it used (free models differ):
    {"tool": .., "args": ..} (also name/function/tool_name + arguments/parameters/input), Qwen-style <function=NAME><parameter=K>V</parameter></function>,
    Liquid-style <|tool_call_start|>[name(k='v')]<|tool_call_end|>, and <tool_call>{json}</tool_call>. None when there is no call."""
    t = text.strip()
    m = _XML_CALL.search(t)
    if m:
        return _normalise(m.group(1), {k: v for k, v in _XML_PARAM.findall(m.group(2))})
    m = _PY_CALL.search(t)
    if m:
        import ast
        try:
            call = ast.parse(f"f({m.group(2)})", mode="eval").body
            return _normalise(m.group(1), {k.arg: ast.literal_eval(k.value) for k in call.keywords if k.arg})
        except (SyntaxError, ValueError):
            return None
    i = t.find("{")
    if i < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(t[i:])
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    obj = obj.get("tool_call") if isinstance(obj.get("tool_call"), dict) else obj
    name = next((obj[k] for k in ("tool", "name", "function", "tool_name", "action") if isinstance(obj.get(k), str)), None)
    if not name:
        return None
    args = next((obj[k] for k in ("args", "arguments", "parameters", "params", "input") if isinstance(obj.get(k), (dict, str))), {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {}
    return _normalise(name, args if isinstance(args, dict) else {})


def redact(t: str) -> str:
    """No secret goes back to the model or into a comment."""
    return re.sub(r"Bearer\s+\S+", "Bearer [hidden]", re.sub(r"(github_pat_|ghp_|gho_|ghs_|sk-or-v1-)[\w-]+", "[hidden]", t))


def clip(s: str, n: int = OUT_LIMIT) -> str:
    return s if len(s) <= n else s[:n] + f"\n…[cut, {len(s) - n} more characters]"


# ------------------------------------------------------------------ tools

class Agent:
    def __init__(self, number: int, default: str, root: Path | None = None):
        self.number, self.default = number, default
        self.root = (root or Path.cwd()).resolve()
        self.branch = ""
        self.written: list[str] = []
        self.trace: list[str] = []

    def _git(self, *a: str) -> str:
        r = subprocess.run(["git", *a], cwd=self.root, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"git {a[0]} failed: {redact(r.stderr)[:200]}")
        return r.stdout.strip()

    # -- files
    def _safe(self, path: str, write: bool) -> Path:
        why = A.path_problem(path) if write else read_problem(path)
        if why:
            raise ValueError(f"refused ({why}): {path}")
        p = (self.root / path).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError(f"refused (outside the repository): {path}")
        return p

    def list_files(self, path: str = "") -> str:
        r = subprocess.run(["git", "ls-files", "--", path or "."], cwd=self.root, capture_output=True, text=True)
        files = [f for f in r.stdout.split("\n") if f and not read_problem(f)]
        return clip("\n".join(files[:400]) + (f"\n…[{len(files) - 400} more]" if len(files) > 400 else "")) or "(nothing)"

    def read_file(self, path: str, start: int = 1, end: int = 300) -> str:
        p = self._safe(path, write=False)
        if not p.is_file():
            return f"no such file: {path}"
        lines = p.read_text(encoding="utf-8", errors="replace").split("\n")
        s, e = max(1, int(start)), min(len(lines), max(int(start), int(end)))
        return clip("\n".join(f"{i}: {lines[i - 1]}" for i in range(s, e + 1))) + f"\n[{len(lines)} lines in the file]"

    def search(self, query: str, path: str = "") -> str:
        if not query.strip():
            return "empty query"
        r = subprocess.run(["git", "grep", "-n", "-I", "-F", "--", query, "--", path or "."], cwd=self.root, capture_output=True, text=True)
        hits = [h for h in r.stdout.split("\n") if h and not read_problem(h.split(":")[0])]
        return clip("\n".join(h[:240] for h in hits[:60])) or "no matches"

    def _branch(self) -> None:
        if self.branch:
            return
        self.branch = f"ai/issue-{self.number}-{uuid.uuid4().hex[:6]}"
        A.refuse_default_branch(self.branch, self.default)
        self._git("config", "user.name", "ai-agent[bot]")
        self._git("config", "user.email", "ai-agent@users.noreply.github.com")
        self._git("switch", "-c", self.branch)

    def write_file(self, path: str, content: str) -> str:
        p = self._safe(path, write=True)
        if len(content.encode()) > A.MAX_FILE_BYTES:
            return f"refused: file larger than {A.MAX_FILE_BYTES} bytes"
        self._branch()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        if path not in self.written:
            self.written.append(path)
        return f"wrote {path} ({len(content)} characters) on branch {self.branch}"

    def edit_file(self, path: str, old: str, new: str) -> str:
        p = self._safe(path, write=True)
        if not p.is_file():
            return f"no such file: {path}"
        text = p.read_text(encoding="utf-8")
        if text.count(old) != 1:
            return f"refused: the old text occurs {text.count(old)} times (it must occur exactly once)"
        return self.write_file(path, text.replace(old, new, 1))

    # -- shell
    def run(self, cmd: str) -> str:
        why = command_problem(cmd)
        if why:
            return f"refused: {why}"
        try:
            r = subprocess.run(cmd, shell=True, cwd=self.root, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            return "stopped: the command ran longer than 10 minutes"
        return clip(redact(f"exit {r.returncode}\n{r.stdout}{r.stderr}"))

    # -- GitHub
    def open_pr(self, title: str, body: str = "", base: str = "") -> str:
        if not self.written:
            return "refused: no edits were written, so there is nothing to open"
        base = base or self.default
        if base not in (self.default, "main"):
            return "refused: base must be the default branch or main"
        self._git("add", "--", *self.written)
        self._git("commit", "-m", f"ai: {title}\n\nRefs #{self.number}")
        A.refuse_default_branch(self._git("rev-parse", "--abbrev-ref", "HEAD"), self.default)
        self._git("push", "origin", f"HEAD:refs/heads/{self.branch}")
        pr = A.gh("POST", f"/repos/{A.repo()}/pulls", json={"title": f"ai: {title}"[:200], "head": self.branch, "base": base,
                                                          "body": f"{body}\n\nRefs #{self.number}\n\n_Opened by free i (AI Agent)._"})
        self.written = []
        return f"opened pull request #{pr['number']}: {pr['html_url']} (GitHub does not start CI on pull requests opened by this workflow: run the tests with `run` first)"

    def open_pull(self, head: str, base: str, title: str, body: str = "") -> str:
        if head not in (self.default, self.branch) and not head.startswith("ai/"):
            return "refused: head must be the default branch or an ai/ branch"
        if base not in (self.default, "main") or head == base:
            return "refused: base must be the default branch or main (and differ from head)"
        pr = A.gh("POST", f"/repos/{A.repo()}/pulls", json={"title": title[:200], "head": head, "base": base, "body": f"{body}\n\n_Opened by free i (AI Agent)._"})
        return f"opened pull request #{pr['number']}: {pr['html_url']}"

    def merge_pr(self, number: int) -> str:
        number = int(number)
        if number in NEVER_MERGE:
            return f"refused: #{number} must never be merged (owner's standing order)"
        pr = A.gh("GET", f"/repos/{A.repo()}/pulls/{number}")
        if pr.get("state") != "open" or pr.get("merged"):
            return f"refused: #{number} is not open"
        if pr["base"]["ref"] not in (self.default, "main"):
            return "refused: the base is neither the default branch nor main"
        files = A.gh("GET", f"/repos/{A.repo()}/pulls/{number}/files?per_page=100")
        bad = [f["filename"] for f in files if A.path_problem(f["filename"]) == "protected folder"]
        if bad:
            return "refused: the pull request touches protected paths: " + ", ".join(bad[:5])
        r = A.gh("PUT", f"/repos/{A.repo()}/pulls/{number}/merge", json={"merge_method": "merge"})
        return f"merged #{number}: {r.get('message', 'ok')}"

    def run_workflow(self, workflow: str, inputs: dict | None = None) -> str:
        why = workflow_problem(workflow)
        if why:
            return f"refused: {why}"
        A.gh("POST", f"/repos/{A.repo()}/actions/workflows/{workflow}/dispatches", json={"ref": self.default, "inputs": {str(k): str(v) for k, v in (inputs or {}).items()}})
        return f"started {workflow} on {self.default}"

    def workflow_runs(self, workflow: str) -> str:
        why = workflow_problem(workflow)
        if why:
            return f"refused: {why}"
        d = A.gh("GET", f"/repos/{A.repo()}/actions/workflows/{workflow}/runs?per_page=5")
        return "\n".join(f"#{r['id']} {r['status']}/{r.get('conclusion')} {r['created_at']} {r['html_url']}" for r in d.get("workflow_runs", [])[:5]) or "no runs"

    def call(self, tool: str, args: dict) -> str:
        fn = {"list_files": self.list_files, "read_file": self.read_file, "search": self.search, "write_file": self.write_file, "edit_file": self.edit_file,
              "run": self.run, "open_pr": self.open_pr, "open_pull": self.open_pull, "merge_pr": self.merge_pr, "run_workflow": self.run_workflow,
              "workflow_runs": self.workflow_runs}.get(tool)
        if not fn:
            return f"unknown tool: {tool}"
        try:
            return fn(**args)
        except TypeError as exc:
            return f"bad arguments for {tool}: {str(exc)[:160]}"
        except Exception as exc:                                    # a failing tool is a result the model can read, never a crash
            return f"ERROR in {tool}: {redact(str(exc))[:400]}"


# ------------------------------------------------------------------ the loop

def compact_trace(trace: list[str]) -> str:
    """read_file ×12, search ×3 (not one long list)."""
    counts: dict[str, int] = {}
    for t in trace:
        counts[t] = counts.get(t, 0) + 1
    return ", ".join(f"{k} ×{v}" if v > 1 else k for k, v in counts.items())


WRAP_UP = ("Stop using tools now. Write your FINAL answer to the owner's command from what you have read and done so far: "
           "findings first, short and concrete, in the owner's language. Say plainly what you could not finish. Plain text, no JSON.")


def wrap_up(messages: list[dict], model: str, why: str, trace: list[str]) -> str:
    """The step or time limit ended the work: one last call turns what was read into an answer (never a bare list of steps)."""
    try:
        out = A.call_model(messages + [{"role": "user", "content": WRAP_UP}], model, 2500).strip()
        act = parse_step(out)
        text = str(act["args"].get("message") or "") if act and act["tool"] == "final" else ("" if act else out)
        if text:
            return f"{text}\n\n(توقفتُ عند {why}: لم أُكمل كل شيء.)"
    except Exception:
        pass
    return f"توقفتُ عند {why} قبل أن أكتب خلاصة. ما أنجزتُه: {compact_trace(trace) or 'لا شيء'}"


def run_agent(issue: dict, comments: list[dict], model: str, default: str, root: Path | None = None, now=time.time) -> tuple[str, list[str]]:
    """(the final message, the trace of tool calls). Never raises for a model or tool problem."""
    ag = Agent(int(issue["number"]), default, root)
    task = A._HTML_COMMENT.sub("", issue.get("body") or issue["title"]).strip()
    history = "\n\n".join(f"{c['user']['login']}: {c['body']}" for c in comments if A.MARK not in c["body"])[-3000:]
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"The owner's command:\n{task}" + (f"\n\nEarlier comments:\n{history}" if history else "")}]
    started, bad = now(), 0
    for step in range(MAX_STEPS):
        if now() - started > MAX_SECONDS:
            return wrap_up(messages, model, f"حدّ الوقت ({int((now() - started) // 60)} دقيقة)", ag.trace), ag.trace
        try:
            out = A.call_model(messages, model, 3500)
        except Exception as exc:
            return f"تعذّر الاتصال بالنموذج: {str(exc)[:300]}", ag.trace
        act = parse_step(out)
        if not act:
            bad += 1
            if bad > 3:
                return "النموذج لم يُرجع خطوة صالحة بعد عدة محاولات؛ توقفتُ. آخر ما قاله:\n" + clip(out, 800), ag.trace
            messages += [{"role": "assistant", "content": clip(out, 1500)}, {"role": "user", "content": 'Reply with ONE JSON object only: {"tool": "...", "args": {...}}'}]
            continue
        if act["tool"] == "final":
            return str(act["args"].get("message") or "(no message)"), ag.trace
        result = ag.call(act["tool"], act["args"])
        ag.trace.append(act["tool"])
        left = MAX_STEPS - step - 1
        hint = f"\n[step {step + 1}/{MAX_STEPS}]" + ("\nFew steps left: call final NOW with your findings." if left <= 6 else "")
        messages += [{"role": "assistant", "content": json.dumps(act, ensure_ascii=False)[:2500]}, {"role": "user", "content": f"Result of {act['tool']}:\n{clip(result)}{hint}"}]
        if len(messages) > 40:                                       # keep the task and the latest exchanges
            messages = messages[:2] + messages[-30:]
    return wrap_up(messages, model, f"حدّ الخطوات ({MAX_STEPS})", ag.trace), ag.trace
