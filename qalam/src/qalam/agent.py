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


# ----------------------------------------------------------------------------------------------- the loop (the terminal is the body)
from typing import Callable  # noqa: E402

from .config import ModelConfig  # noqa: E402


@dataclass
class Step:
    kind: str            # "command" | "tool" | "answer" | "refused" | "declined" | "budget"
    text: str
    result: str = ""


def run_agent(cfg: ModelConfig, generate: Callable[[list[int], int], list[int]], decode: Callable[[list[int]], str], encode: Callable[[str], list[int]],
              prompt: list[int], execute: Callable[[str, str], tuple[bool, str]], approve: Callable[[str, str], bool],
              max_steps: int = 12, think_budget: int = 256, max_new: int = 256) -> tuple[list[Step], list[int]]:
    """The terminal loop of T-LDM: the model writes ONE command line (CMD_BEGIN..CMD_END) or one tool call (TOOL_BEGIN..TOOL_END) or an answer (EOS);
    the result goes back into the stream (RESULT_BEGIN .. OK|FAIL .. RESULT_END) and the model continues. `generate(stream, max_new)` returns new ids
    (it stops at a closing special). The model's text is only checked here (`check_command` / `check_tool`); `execute(kind, text)` is the caller's sandbox,
    and `approve(kind, text)` is a person's confirmation for sensitive calls. Thinking (THINK_BEGIN..THINK_END) is bounded by `think_budget` and never executed."""
    sp = cfg.special_id
    stream, steps = list(prompt), []
    for _ in range(max_steps):
        new = generate(stream, max_new)
        if sp("THINK_BEGIN") in new:                                           # thinking is private reasoning: cut to the budget, never run, never shown as the answer
            a = new.index(sp("THINK_BEGIN"))
            b = new.index(sp("THINK_END")) if sp("THINK_END") in new else len(new)
            if b - a > think_budget:
                new = new[:a + think_budget] + [sp("THINK_END")] + new[b + 1:]
        kind = None
        for begin, end, name in ((sp("CMD_BEGIN"), sp("CMD_END"), "command"), (sp("TOOL_BEGIN"), sp("TOOL_END"), "tool")):
            if begin in new and end in new[new.index(begin):]:
                i = new.index(begin)
                j = new.index(end, i)
                kind, body, new = name, decode(new[i + 1:j]), new[:j + 1]
                break
        stream += new
        if kind is None:
            steps.append(Step("answer", decode([t for t in new if t < cfg.text_vocab])))
            return steps, stream
        d = check_command(body) if kind == "command" else check_tool(body)
        if not d.allowed:
            steps.append(Step("refused", body, d.reason))
            result = (False, "refused: " + d.reason)
        elif d.needs_approval and not approve(kind, body):
            steps.append(Step("declined", body, "not approved"))
            result = (False, "declined: not approved")
        else:
            ok, out = execute(kind, body)
            steps.append(Step(kind, body, out))
            result = (ok, out)
        stream += [sp("RESULT_BEGIN")] + encode(result[1][:2000]) + [sp("OK") if result[0] else sp("FAIL"), sp("RESULT_END")]
    steps.append(Step("budget", "step budget reached"))
    return steps, stream
