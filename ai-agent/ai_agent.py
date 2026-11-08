"""
AI Agent — the GitHub side. One run = one issue.

Model: reached through OpenRouter (https://openrouter.ai) with OPENROUTER_API_KEY. The default is the router `openrouter/free`, which picks one of the models that are free that day;
the repository variable AI_MODEL may hold one model id or a comma list tried in order (the first that answers wins). Free models change often, so a list with fallbacks is the safe setting.

Two modes, decided by the label `ai-full` on the issue:
  normal  -> reads the issue, writes ONE comment (analysis / plan / code in the comment). Changes nothing in the repository.
  full    -> may also create files: it works on a NEW branch (ai/issue-<n>-<time>), commits, pushes that branch and opens a pull request into the default branch.

Safety rules that are enforced HERE, in code, not left to the model:
  * the default branch is never written to: every change goes branch -> pull request (a push whose target is the default branch is refused);
  * the model never runs a command: it returns JSON, this script validates it and writes files itself;
  * paths are checked: nothing under athar/, cloudflare/, deploy/oracle/, .github/workflows/, .git/, no secret-looking file, no instruction files (CLAUDE.md ...), no path escape;
  * only a trusted issue is processed: its author is the owner / a member / a collaborator, or it carries the label `from-telegram` (only someone with write access can add a label,
    and the Telegram bridge only accepts messages from the owner's chat);
  * the same issue content is never processed twice (see --key and the actions/cache step in the workflow).
Nothing here prints a secret.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import requests

API = "https://api.github.com"
OPENROUTER = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openrouter/free"
# the agent needs models that follow tool calls: these free ones list `tools` support on OpenRouter (checked 2026-11-08); the free router is the last resort. Override with AI_MODEL.
AGENT_MODELS = "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,xingchen-agi/xing4.0-29b-a4b:free,cohere/north-mini-code:free,openrouter/free"
FULL_LABEL = "ai-full"
TRUSTED_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}
MARK = "<!-- ai-reply -->"
DENY_PREFIXES = ("athar/", "cloudflare/", "deploy/oracle/", ".github/workflows/", ".git/", "node_modules/", "ai-agent/ai_agent.py", "ai-agent/agent_loop.py")
DENY_NAMES = {"CLAUDE.md", "AGENTS.md", ".env", ".npmrc", "id_rsa", "id_ed25519"}
MAX_FILES = 12
MAX_FILE_BYTES = 120_000
MAX_CONTEXT_CHARS = 24_000


# ------------------------------------------------------------------ pure helpers (tested)

def content_key(issue: dict, full: bool) -> str:
    """A key that changes when the issue's content or the mode changes — the same content is never processed twice."""
    labels = sorted(l["name"] if isinstance(l, dict) else str(l) for l in issue.get("labels", []))
    h = hashlib.sha256(json.dumps([issue.get("title", ""), issue.get("body", ""), full, [l for l in labels if l != FULL_LABEL]], ensure_ascii=False).encode()).hexdigest()[:20]
    return f"ai-{issue.get('number')}-{'full' if full else 'plain'}-{h}"


def is_trusted(issue: dict) -> bool:
    names = {l["name"] if isinstance(l, dict) else str(l) for l in issue.get("labels", [])}
    return issue.get("author_association") in TRUSTED_ASSOCIATIONS or "from-telegram" in names


def wants_full(issue: dict) -> bool:
    return FULL_LABEL in {l["name"] if isinstance(l, dict) else str(l) for l in issue.get("labels", [])}


def path_problem(path: str) -> str | None:
    """None when the path may be written, else the reason it may not."""
    p = path.replace("\\", "/").strip()
    if not p or p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        return "absolute or empty path"
    parts = p.split("/")
    if ".." in parts or "" in parts[:-1]:
        return "path escape"
    low = p.lower()
    if any(low.startswith(d.lower()) for d in DENY_PREFIXES):
        return "protected folder"
    if parts[-1] in DENY_NAMES or re.search(r"(secret|token|credential|private[_-]?key|\.pem$|\.p12$|\.env($|\.))", low):
        return "secret-looking or instruction file"
    return None


def parse_reply(text: str) -> dict:
    """The model's JSON ({comment, changes[], pr_title, pr_body}); tolerant of code fences and text around it. Falls back to treating the whole text as the comment."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", t, re.S)
    cand = m.group(1) if m else t[t.find("{"): t.rfind("}") + 1] if "{" in t and "}" in t else ""
    try:
        d = json.loads(cand)
        if isinstance(d, dict):
            d.setdefault("comment", "")
            d["changes"] = [c for c in d.get("changes", []) if isinstance(c, dict) and isinstance(c.get("path"), str) and isinstance(c.get("content"), str)]
            return d
    except (ValueError, TypeError):
        pass
    return {"comment": t, "changes": []}


def validate_changes(changes: list[dict]) -> tuple[list[dict], list[str]]:
    ok, refused = [], []
    for c in changes[:MAX_FILES]:
        why = path_problem(c["path"])
        if why:
            refused.append(f"{c['path']} ({why})")
        elif len(c["content"].encode()) > MAX_FILE_BYTES:
            refused.append(f"{c['path']} (too large)")
        else:
            ok.append(c)
    refused += [f"{c['path']} (more than {MAX_FILES} files)" for c in changes[MAX_FILES:]]
    return ok, refused


def branch_name(number: int, now: float | None = None) -> str:
    return f"ai/issue-{number}-{time.strftime('%Y%m%d-%H%M%S', time.gmtime(time.time() if now is None else now))}"


def refuse_default_branch(target: str, default: str) -> None:
    if target == default or target in ("main", "master"):
        raise RuntimeError(f"refusing to write to {target}: every change goes through a new branch and a pull request")


# ------------------------------------------------------------------ GitHub / OpenRouter

def gh(method: str, path: str, **kw):
    r = requests.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json",
                                                         "X-GitHub-Api-Version": "2022-11-28"}, timeout=60, **kw)
    if r.status_code >= 300:
        raise RuntimeError(f"GitHub {method} {path} -> {r.status_code}: {r.text[:200]}")
    return r.json() if r.text else {}


def repo() -> str:
    return os.environ["GITHUB_REPOSITORY"]


def model_list(spec: str | None) -> list[str]:
    """AI_MODEL may be one id or a comma list; empty means the free router."""
    out = [m.strip() for m in (spec or "").split(",") if m.strip()]
    return out or [DEFAULT_MODEL]


def call_model(messages: list[dict], model: str, max_tokens: int = 6000) -> str:
    """Try each model of the list in order. A model that is gone (404), rate-limited (429), out of free quota (402) or failing (5xx) is skipped for the next one."""
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is missing (add it in Settings -> Secrets and variables -> Actions).")
    errors = []
    for m in model_list(model):
        r = requests.post(OPENROUTER, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "ai-agent"},
                          json={"model": m, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=600)
        if r.status_code in (401, 403):
            raise RuntimeError("OpenRouter refused the key (OPENROUTER_API_KEY is wrong or revoked).")
        if r.status_code >= 300:
            errors.append(f"{m}: HTTP {r.status_code}")
            continue
        try:
            text = r.json()["choices"][0]["message"]["content"]
        except Exception:
            errors.append(f"{m}: unreadable answer")
            continue
        if text and text.strip():
            return text
        errors.append(f"{m}: empty answer")
    raise RuntimeError("no model answered (" + "; ".join(errors)[:400] + "). Free models and their daily limits change often: set AI_MODEL to a comma list of ids from https://openrouter.ai/models?q=free")


def repo_context(issue_text: str) -> str:
    """The file list plus the contents of files the issue names (paths it mentions that exist in the checkout)."""
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.splitlines()
    out = ["Files in the repository (first 300):\n" + "\n".join(files[:300])]
    used = 0
    for f in files:
        if f in issue_text or Path(f).name in issue_text and len(Path(f).name) > 4:
            if path_problem(f) and not f.startswith("ai-agent/"):
                continue
            try:
                body = Path(f).read_text(encoding="utf-8")[:6000]
            except Exception:
                continue
            used += len(body)
            if used > MAX_CONTEXT_CHARS:
                break
            out.append(f"\n--- {f} ---\n{body}")
    return "\n".join(out)[: MAX_CONTEXT_CHARS + 4000]


SYSTEM_NORMAL = ("You are AI Agent, an engineering assistant working on a GitHub issue. Analyse the request and answer in the language of the issue. "
                 "Reply with ONE JSON object: {\"comment\": \"markdown text for the issue\"}. You cannot change the repository in this mode: give a plan, review, or code inside the comment.")
SYSTEM_FULL = ("You are AI Agent with permission to propose changes. Reply with ONE JSON object: "
               "{\"comment\": \"short markdown summary for the issue\", \"changes\": [{\"path\": \"relative/path\", \"content\": \"the COMPLETE new file content\"}], "
               "\"pr_title\": \"...\", \"pr_body\": \"...\"}. Rules: at most 12 files; give whole files, never diffs; never touch athar/, cloudflare/, deploy/oracle/, .github/workflows/, "
               "secrets or instruction files; changes reach the repository only as a pull request that a human reviews.")


SYSTEM_CHAT = ("You are free i, a free AI assistant the owner talks to through Telegram. Answer the owner's message directly and briefly, as in a normal conversation, "
               "in the language the owner wrote (Arabic by default) and ONLY in that language (never mix in Chinese or any other script). Do not analyse a GitHub issue "
               "and do not talk about the repository or code unless the message asks about it. If you do not know something, say so. "
               "Reply with ONE JSON object: {\"comment\": \"your answer\"}.")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


def is_chat(issue: dict, full: bool) -> bool:
    """A plain message from the owner's Telegram chat (label from-telegram, no /build /fix /full): answered as a conversation, not as an engineering issue."""
    names = {l["name"] if isinstance(l, dict) else str(l) for l in issue.get("labels", [])}
    return "from-telegram" in names and not full and not ({"build", "fix"} & names)


def mode_label(full: bool, agent: bool = False) -> str:
    return "agent" if agent else "full" if full else "normal (comments only)"


def uses_agent(issue: dict, full: bool) -> bool:
    """A Telegram message (label from-telegram) or an ai-full request is a COMMAND the agent carries out (agent_loop.py). AI_AGENT_LOOP=0 turns that off."""
    names = {l["name"] if isinstance(l, dict) else str(l) for l in issue.get("labels", [])}
    return os.environ.get("AI_AGENT_LOOP", "1") != "0" and ("from-telegram" in names or full)


def already_answered(comments: list[dict], mode: str) -> bool:
    """The issue's LAST comment is already this mode's answer (the opened and labeled events fire two runs for one Telegram message): do not answer twice."""
    return bool(comments) and MARK in comments[-1]["body"] and f"mode: {mode}" in comments[-1]["body"]


def build_messages(issue: dict, comments: list[dict], full: bool, context: str) -> list[dict]:
    if is_chat(issue, full):
        text = _HTML_COMMENT.sub("", issue.get("body") or issue["title"]).strip()
        return [{"role": "system", "content": SYSTEM_CHAT}, {"role": "user", "content": text}]
    thread = "\n\n".join(f"{c['user']['login']}: {c['body']}" for c in comments if MARK not in c["body"])[-6000:]
    discussion = ("Discussion so far:\n" + thread) if thread else ""
    user = f"Issue #{issue['number']}: {issue['title']}\n\n{issue.get('body') or ''}\n\n{discussion}\n\n{context}"
    return [{"role": "system", "content": SYSTEM_FULL if full else SYSTEM_NORMAL}, {"role": "user", "content": user}]


def git(*a: str) -> str:
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {a[0]} failed: {r.stderr[:200]}")
    return r.stdout.strip()


def open_pull_request(number: int, changes: list[dict], title: str, body: str, default: str) -> str:
    br = branch_name(number)
    refuse_default_branch(br, default)
    git("config", "user.name", "ai-agent[bot]")
    git("config", "user.email", "ai-agent@users.noreply.github.com")
    git("switch", "-c", br)
    for c in changes:
        p = Path(c["path"])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(c["content"], encoding="utf-8")
        git("add", "--", c["path"])
    git("commit", "-m", f"ai: {title}\n\nRefs #{number}")
    refuse_default_branch(git("rev-parse", "--abbrev-ref", "HEAD"), default)
    git("push", "origin", f"HEAD:refs/heads/{br}")
    pr = gh("POST", f"/repos/{repo()}/pulls", json={"title": f"ai: {title}"[:200], "head": br, "base": default, "body": f"{body}\n\nCloses #{number}\n\n_Opened by AI Agent — review before merging._"})
    return pr["html_url"]


# ------------------------------------------------------------------ entry points

def load_issue() -> tuple[dict, list[dict]]:
    number = int(os.environ["ISSUE_NUMBER"])
    issue = gh("GET", f"/repos/{repo()}/issues/{number}")
    comments = gh("GET", f"/repos/{repo()}/issues/{number}/comments?per_page=50")
    return issue, comments


def main_key() -> int:
    issue, _ = load_issue()
    key = content_key(issue, wants_full(issue))
    out = os.environ.get("GITHUB_OUTPUT")
    print(key)
    print(f"author={(issue.get('user') or {}).get('login')} association={issue.get('author_association')} trusted={is_trusted(issue)}")
    if out:
        Path(out).open("a").write(f"key={key}\ntrusted={'true' if is_trusted(issue) else 'false'}\nfull={'true' if wants_full(issue) else 'false'}\n")
    return 0


def main_run() -> int:
    issue, comments = load_issue()
    number = issue["number"]
    default = os.environ.get("DEFAULT_BRANCH") or gh("GET", f"/repos/{repo()}")["default_branch"]
    full = wants_full(issue)
    if not is_trusted(issue):
        print("issue is not trusted (author is not the owner / a member / a collaborator, and no from-telegram label): nothing done")
        return 0
    agent = uses_agent(issue, full)
    mode = mode_label(full, agent)
    if already_answered(comments, mode):
        print("this issue's last comment is already the answer: nothing to do")
        return 0
    model = os.environ.get("AI_MODEL") or DEFAULT_MODEL
    if agent:                                                      # a command: carry it out with tools (agent_loop.py)
        from agent_loop import run_agent
        text, trace = run_agent(issue, comments, os.environ.get("AI_MODEL") or AGENT_MODELS, default)
        tail = f"\n\n_Steps: {', '.join(trace)}_" if trace else ""
        gh("POST", f"/repos/{repo()}/issues/{number}/comments", json={"body": f"{MARK}\n{text}{tail}\n\n<sub>AI Agent · {model} · mode: {mode}</sub>"})
        Path("ai-cache.json").write_text(json.dumps({"issue": number, "key": content_key(issue, full), "agent": True, "at": int(time.time())}))
        return 0
    pr_url, refused = "", []
    try:
        reply = parse_reply(call_model(build_messages(issue, comments, full, repo_context(f"{issue['title']} {issue.get('body') or ''}")), model))
        text = reply.get("comment") or "(no comment)"
        if full and reply["changes"]:
            ok, refused = validate_changes(reply["changes"])
            if ok:
                pr_url = open_pull_request(number, ok, str(reply.get("pr_title") or issue["title"])[:120], str(reply.get("pr_body") or text), default)
    except Exception as exc:                                   # one clear comment instead of a silent failure
        text = f"⚠️ AI Agent could not finish: {str(exc)[:500]}"
    tail = (f"\n\n**Pull request:** {pr_url}" if pr_url else "") + (("\n\n_Not written (refused by the safety rules): " + ", ".join(refused) + "_") if refused else "")
    gh("POST", f"/repos/{repo()}/issues/{number}/comments", json={"body": f"{MARK}\n{text}{tail}\n\n<sub>AI Agent · {model} · mode: {mode}</sub>"})
    Path("ai-cache.json").write_text(json.dumps({"issue": number, "key": content_key(issue, full), "pr": pr_url, "at": int(time.time())}))
    return 0


if __name__ == "__main__":
    sys.exit(main_key() if "--key" in sys.argv else main_run())
