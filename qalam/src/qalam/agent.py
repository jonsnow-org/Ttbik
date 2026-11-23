"""The agent contract: generated text is DATA. This module only decides whether a call is allowed; it never executes anything."""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import tools

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
    needs_confirmation: bool = False      # destructive: a typed confirmation, not a click


def check_tool(text: str, loaded: frozenset[str] | set[str] = frozenset()) -> Decision:
    """`text` is the content between TOOL_BEGIN and TOOL_END: `name {json arguments}`, checked against the typed registry (src/qalam/tools.py)."""
    call = tools.parse_call(text)
    if call is None:
        return Decision(False, False, "not `name {json}`")
    v = tools.validate(call[0], call[1], loaded)
    return Decision(v.ok, v.needs_approval, v.reason, v.needs_confirmation)


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
              max_steps: int = 12, think_budget: int = 256, max_new: int = 256,
              confirm: Callable[[str, str], bool] | None = None, loaded: set[str] | None = None) -> tuple[list[Step], list[int]]:
    """The terminal loop of T-LDM: the model writes ONE command line (CMD_BEGIN..CMD_END) or one tool call (TOOL_BEGIN <tool id> {json} TOOL_END) or an answer;
    the result goes back into the stream (RESULT_BEGIN .. OK|FAIL .. RESULT_END) and the model continues. `generate(stream, max_new)` returns new ids
    (it stops at a closing special). The model's text is only checked here; `execute(kind, text)` is the caller's sandbox; `approve` is a person's click for
    write/external/secret calls and `confirm` the typed confirmation for destructive ones (absent = refused). Tool groups load lazily: `load_tools` is handled
    here (it only widens what the model may call). Thinking (THINK_BEGIN..THINK_END) is bounded by `think_budget` and never executed."""
    sp = cfg.special_id
    loaded = set(loaded or ())
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
                inner = new[i + 1:j]
                if name == "tool" and inner and cfg.modality_of(inner[0]) == "tool":      # a native tool token: one id instead of a spelled name
                    nm = tools.tool_name(cfg, inner[0])
                    body = (nm or "?") + " " + decode(inner[1:]).strip()
                else:
                    body = decode(inner)
                kind, new = name, new[:j + 1]
                break
        stream += new
        if kind is None:
            steps.append(Step("answer", decode([t for t in new if t < cfg.text_vocab])))
            return steps, stream
        d = check_command(body) if kind == "command" else check_tool(body, loaded)
        if not d.allowed:
            steps.append(Step("refused", body, d.reason))
            result = (False, "refused: " + d.reason)
        elif d.needs_confirmation and not (confirm and confirm(kind, body)):
            steps.append(Step("declined", body, "not confirmed"))
            result = (False, "declined: needs a typed confirmation")
        elif d.needs_approval and not approve(kind, body):
            steps.append(Step("declined", body, "not approved"))
            result = (False, "declined: not approved")
        elif kind == "tool" and body.split()[0] == "load_tools":
            group = (tools.parse_call(body) or ("", {}))[1].get("group", "")
            if group in tools.GROUPS and group != tools.CORE_GROUP:
                loaded.add(group)
                result = (True, "loaded: " + " ".join(n for n, s in tools.REGISTRY.items() if s.group == group))
            else:
                result = (False, "unknown group; groups: " + " ".join(g for g in tools.GROUPS if g != tools.CORE_GROUP))
            steps.append(Step("tool", body, result[1]))
        else:
            ok, out = execute(kind, body)
            steps.append(Step(kind, body, out))
            result = (ok, out)
        stream += [sp("RESULT_BEGIN")] + encode(tools.shape_result(result[1])) + [sp("OK") if result[0] else sp("FAIL"), sp("RESULT_END")]
    steps.append(Step("budget", "step budget reached"))
    return steps, stream
