"""The agent contract: generated text is DATA. This module only decides whether a call is allowed; it never executes anything."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

# name -> {argument: type}; read tools need no approval, the sensitive ones do (a person confirms, always).
TOOLS: dict[str, dict[str, type]] = {
    "read_file": {"path": str},
    "list_files": {"path": str},
    "search": {"pattern": str, "path": str},
    "web_search": {"query": str},
    "run_python": {"code": str},
    "write_file": {"path": str, "content": str},
    "git_commit": {"message": str},
    "pip_install": {"package": str},
}
SENSITIVE = {"write_file", "git_commit", "pip_install", "run_python"}
# a terminal command line is only accepted when its first word is on this list (no pipes, no redirection, no substitution)
COMMANDS = {"ls", "cat", "head", "tail", "wc", "grep", "rg", "echo", "pwd", "python3", "git", "mkdir", "touch"}
SENSITIVE_COMMANDS = {"mkdir", "touch", "git", "python3"}
_FORBIDDEN = re.compile(r"[|&;<>`$\\]|\.\./|(^|\s)(rm|sudo|su|chmod|chown|curl|wget|nc|ssh|dd|mkfs|shutdown|reboot|passwd)(\s|$)")
_TOOL = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\{.*\})?\s*$", re.S)


@dataclass(frozen=True)
class Decision:
    allowed: bool
    needs_approval: bool
    reason: str


def check_tool(text: str) -> Decision:
    """`text` is the content between TOOL_BEGIN and TOOL_END: `name {json arguments}`."""
    m = _TOOL.match(text or "")
    if not m or m.group(1) not in TOOLS:
        return Decision(False, False, "unknown tool")
    name = m.group(1)
    try:
        args = json.loads(m.group(2) or "{}")
    except json.JSONDecodeError:
        return Decision(False, False, "arguments are not valid JSON")
    schema = TOOLS[name]
    if not isinstance(args, dict) or set(args) != set(schema) or any(not isinstance(args[k], t) for k, t in schema.items()):
        return Decision(False, False, "arguments do not match the tool's schema")
    if any(isinstance(v, str) and (".." in v.split("/") or v.startswith("/")) for k, v in args.items() if k in ("path",)):
        return Decision(False, False, "path leaves the workspace")
    return Decision(True, name in SENSITIVE, "ok")


def check_command(line: str) -> Decision:
    """`line` is the content between CMD_BEGIN and CMD_END: one command line."""
    line = (line or "").strip()
    if not line or "\n" in line:
        return Decision(False, False, "one command line only")
    if _FORBIDDEN.search(line):
        return Decision(False, False, "forbidden syntax or program")
    first = line.split()[0]
    if first not in COMMANDS:
        return Decision(False, False, "program is not on the allowlist")
    return Decision(True, first in SENSITIVE_COMMANDS, "ok")
