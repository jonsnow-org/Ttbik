"""Phase 3 of the T-LDM agent system (docs/experiments/TLDM_AGENT_SYSTEM.md §5): `app_tool` and `ask_user` through Sham's own `<tool_call>` envelope.

The web app alone holds GitHub, connectors, memory, push, tokens and the user's tap (sham_embedded_tools.py returns every non-embedded tool to it untouched;
src/lib/shamExec.ts runs it). This port is the ONLY way a task step reaches those tools, and it adds nothing the app does not already do:
  * the call is written exactly as Sham writes it:  <tool_call>{"name": "...", "arguments": {...}}</tool_call>  (sham_toolcall.OPEN_TAG / CLOSE_TAG);
  * only a tool the web app owns is sent: Sham's embedded computer tools (computer_*, sandbox_* aliases, browser, desktop) are refused here, they go through the
    `shell` / `file` workers on the model's own computer (one body), and a name not in the loaded tool list is refused (the model cannot invent a tool);
  * NO TOKEN ENTERS: an argument that looks like a credential is refused before anything is sent; a secret is written only as the app's placeholder {{secret:name}}
    (request_secret), which the web app fills in on its side. A result that carries something token-like is redacted before it reaches the task folder;
  * the user's yes: `needs_ok(name, arguments)` is the web app's own rule (shamNeedsOk in src/lib/shamExec.ts: SHAM_NEEDS_OK + a non-GET http_request / connector_api),
    kept in sync by a test that reads the TypeScript file. Such a call is sent only after confirm(question) said yes, and then with approved=True;
  * ask_user is the app's own `ask_user` tool: the question goes out in the same envelope.

transport(envelope: str, approved: bool) -> str is the web app's side (in serving: the app's tool loop; in tests: a scripted app). Nothing here holds a token or opens a network connection.
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "colab", "sham_small"))
from sham_toolcall import CLOSE_TAG, OPEN_TAG  # noqa: E402

# The web app's rule (src/lib/shamExec.ts, SHAM_NEEDS_OK and shamNeedsOk). test_app_port.py fails if the TypeScript set changes and this one does not.
NEEDS_OK = frozenset({"computer_publish", "sandbox_push", "github_create_pr", "github_merge_pr", "github_create_issue", "github_comment", "github_run_workflow", "mcp_call"})
METHOD_TOOLS = frozenset({"http_request", "connector_api"})          # need the user's yes unless the method is GET / HEAD

# Embedded in Sham's own code (sham_embedded_tools.EMBEDDED); read from the module when it imports, this list otherwise.
_EMBEDDED_FALLBACK = frozenset({"computer_run", "computer_read", "computer_write", "computer_edit", "computer_search", "computer_repo", "computer_job", "computer_patch", "computer_test", "computer_bank", "computer_apps", "computer_batch",
                                "browser", "desktop", "sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_edit_file", "sandbox_search", "sandbox_read_file"})

PLACEHOLDER = re.compile(r"\{\{secret:[A-Za-z0-9_-]{1,64}\}\}")
SECRET_PATTERNS = [
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"),       # GitHub tokens
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),                          # OpenAI-style / OpenRouter keys
    re.compile(r"\bgsk_[A-Za-z0-9]{20,}"),                           # Groq
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),                  # Slack
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),                             # AWS access key id
    re.compile(r"\bhf_[A-Za-z0-9]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),                  # Telegram bot token
    re.compile(r"(?i)\b(?:bearer|token|api[_-]?key|password|passwd|secret)\b\s*[:=]\s*[\"']?[^\s\"'{}]{12,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),   # JWT
]
SECRET_KEYS = re.compile(r"(?i)^(?:token|access_token|api_key|apikey|password|passwd|secret|authorization|auth|private_key|client_secret)$")


def _embedded() -> frozenset:
    try:
        import sham_embedded_tools
        return frozenset(sham_embedded_tools.EMBEDDED)
    except Exception:                                               # (its computer module may not import on every host; the names do not change)
        return _EMBEDDED_FALLBACK


def needs_ok(name: str, arguments: dict | None) -> bool:
    """The web app's shamNeedsOk, the same decision on the same input."""
    if name in NEEDS_OK:
        return True
    if name in METHOD_TOOLS:
        method = str((arguments or {}).get("method") or "GET")
        return not re.fullmatch(r"(?i)GET|HEAD", method)
    return False


def find_secret(value, path: str = "arguments") -> str:
    """'' if nothing credential-like is in the value; else where it is (never the value itself)."""
    if isinstance(value, dict):
        for k, v in value.items():
            if SECRET_KEYS.match(str(k)) and isinstance(v, str) and v and not PLACEHOLDER.fullmatch(v.strip()):
                return f"{path}.{k}"
            hit = find_secret(v, f"{path}.{k}")
            if hit:
                return hit
        return ""
    if isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            hit = find_secret(v, f"{path}[{i}]")
            if hit:
                return hit
        return ""
    if isinstance(value, str):
        text = PLACEHOLDER.sub("", value)
        return path if any(p.search(text) for p in SECRET_PATTERNS) else ""
    return ""


def redact(text: str) -> str:
    for p in SECRET_PATTERNS:
        text = p.sub("[redacted]", text)
    return text


def envelope(name: str, arguments: dict) -> str:
    return OPEN_TAG + json.dumps({"name": name, "arguments": arguments}, ensure_ascii=False) + CLOSE_TAG


class AppPort:
    """app_call(name, arguments) for tasks.Coordinator, plus confirm/ask through the app's own ask_user tool."""

    def __init__(self, transport, tools, confirm=None, max_chars: int = 4000):
        """transport(envelope, approved) -> result text. tools = names the web app loaded for this chat (e.g. sham_toolcall.tool_names_from_prompt(prompt)).
        confirm(question) -> bool: the user's tap; None = nothing that needs it can run."""
        self.transport, self.confirm, self.max_chars = transport, confirm, max_chars
        self.tools = frozenset(tools) - _embedded()
        self.sent: list = []                                        # (envelope, approved) actually handed to the app: the owner's audit trail

    def check(self, name: str, arguments: dict) -> str:
        """'' = may be sent; else why not. Run BEFORE anything leaves."""
        if name in _embedded():
            return f"{name} is Sham's own computer tool: it runs through the shell/file workers on the model's computer, not through the app"
        if name not in self.tools:
            return f"{name} is not a tool the app loaded for this chat"
        if not isinstance(arguments, dict):
            return "arguments must be an object"
        where = find_secret(arguments)
        if where:
            return f"refused: {where} looks like a credential; write the app's placeholder {{{{secret:name}}}} (request_secret) instead"
        return ""

    def needs_ok(self, name: str, arguments: dict) -> bool:
        return needs_ok(name, arguments)

    def __call__(self, name: str, arguments: dict | None = None, approved: bool = False) -> str:
        """Raises PermissionError when the call must not be sent (tasks.Coordinator turns it into a failed step with the reason).
        approved=True: the user already said yes to THIS call (a resumed waiting step); every other check still applies."""
        arguments = arguments or {}
        why = self.check(name, arguments)
        if why:
            raise PermissionError(why)
        if needs_ok(name, arguments) and not approved:
            q = f"{name} {json.dumps(arguments, ensure_ascii=False)[:200]}"
            if not (self.confirm is not None and self.confirm(q)):
                raise PermissionError("needs the user's confirmation")
            approved = True
        env = envelope(name, arguments)
        self.sent.append((env, approved))
        return redact(str(self.transport(env, approved)))[: self.max_chars]

    def ask(self, question: str) -> str:
        """The app's ask_user tool, in the same envelope; returns the user's answer as the app reports it."""
        if "ask_user" not in self.tools:
            raise PermissionError("ask_user is not loaded for this chat")
        return self(name="ask_user", arguments={"question": question})
