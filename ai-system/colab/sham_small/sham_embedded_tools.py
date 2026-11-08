"""Sham's computer and browser as PART OF THE MODEL'S OWN GENERATION LOOP (owner's order 2026-11-08: they live in the model's code, not on a Studio and not behind an API).

Sham v1 already works this way (sham_computer.chat_generate_with_computer): the model writes a call, the loop stops at its closing tag, runs it HERE, pastes the result back in the
layout it was trained on and the model goes on. This module gives Sham v2 the same loop in its own (Qwen3) layout, whose single user turn holds the tool block, the conversation so
far and ends with «شام:» (sham_tools_data.qwen3_tool_examples): after an embedded call the lines `شام: <call>` and `نتيجة الأداة <name>:` are appended and the model is asked again.

Embedded tools: the seven computer tools (sham_computer.Computer: shell, files, edit, search, background jobs, git clone) and `browser` (browser_computer: headless Chromium, started on
first use). Each session (the user + the model) has its own workspace folder. Every other tool (GitHub, connectors, memory ...) is still the web app's and is returned to it untouched.
Switch: SHAM_INTERNAL_COMPUTER=0 turns the embedded tools off (default on).
"""
from __future__ import annotations

import json
import threading

import sham_computer

BROWSER = "browser"
def _p(a: dict) -> str:
    return f"{str(a['cwd']).rstrip('/')}/{a.get('path', '')}" if a.get("cwd") else a.get("path", "")


# The sandbox_* names the model learned (a "separate temporary workspace") are the SAME embedded computer for Sham: one environment, no second one anywhere.
# sandbox_push stays the app's (it needs the user's confirmation and the GitHub token, which never come here).
SANDBOX_ALIAS = {
    "sandbox_clone": lambda a: ("computer_repo", {"url": f"https://github.com/{a.get('repo', '')}", "ref": a.get("branch") or None}),
    "sandbox_exec": lambda a: ("computer_run", {"command": a.get("command", ""), "cwd": a.get("cwd")}),
    "sandbox_wait": lambda a: ("computer_job", {"action": "log", "id": a.get("id", "")}),
    "sandbox_write_file": lambda a: ("computer_write", {"path": _p(a), "content": a.get("content", "")}),
    "sandbox_edit_file": lambda a: ("computer_edit", {"path": _p(a), "old": a.get("old", ""), "new": a.get("new", ""), "replace_all": a.get("replace_all")}),
    "sandbox_search": lambda a: ("computer_search", {"pattern": a.get("pattern", ""), "path": a.get("path") or a.get("cwd"), "glob": a.get("glob")}),
    "sandbox_read_file": lambda a: ("computer_read", {"path": _p(a)}),
}
EMBEDDED = frozenset(sham_computer.TOOL_NAMES) | {BROWSER} | frozenset(SANDBOX_ALIAS)
MAX_CALLS = 6
RESULT_CHARS = 1800
_COMPUTERS: dict[str, "sham_computer.Computer"] = {}
_LOCK = threading.Lock()


def enabled() -> bool:
    return sham_computer.enabled()


def computer_for(session: str) -> "sham_computer.Computer":
    key = (session or "default").strip() or "default"
    with _LOCK:
        if key not in _COMPUTERS:
            if len(_COMPUTERS) >= 32:                       # bounded: the oldest workspace handle is dropped (its files stay on disk)
                _COMPUTERS.pop(next(iter(_COMPUTERS)))
            _COMPUTERS[key] = sham_computer.Computer(key)
        return _COMPUTERS[key]


def run_embedded(name: str, args: dict, session: str) -> str:
    """Run one embedded tool and return its result text (never raises)."""
    try:
        if name == BROWSER:
            import browser_computer
            reply = json.loads(browser_computer.api_browser_do(json.dumps({**(args or {}), "session": session or "default"}, ensure_ascii=False)))
            if reply.get("ok") is False:
                return "error: " + str(reply.get("error") or "the browser failed")[:300]
            parts = [f"{k}: {reply[k]}" for k in ("url", "title") if reply.get(k)]
            for k in ("text", "elements", "outline"):
                if reply.get(k):
                    parts.append(str(reply[k]))
            return "\n".join(parts)[:4000] or "ok"
        return computer_for(session).execute(name, args or {})
    except Exception as exc:  # noqa: BLE001 - a tool failure is a result the model can read, not a crash of the loop
        return f"error: {type(exc).__name__}: {str(exc)[:200]}"


def extend_prompt(prompt: str, call_text: str, name: str, result: str) -> str:
    """The same lines qwen3_tool_examples trains on: the call the model wrote, the tool's result, then the next «شام:»."""
    body = prompt.rstrip()
    if body.endswith("شام:"):
        body = body[: -len("شام:")].rstrip()
    return f"{body}\nشام: {call_text}\nنتيجة الأداة {name}:\n{str(result)[:RESULT_CHARS]}\nشام:"


def loop(generate, extract, prompt: str, tool_names: list[str], session: str, max_calls: int = MAX_CALLS):
    """generate(prompt) -> the model's raw reply; extract(raw, prompt, names) -> {"name","arguments","text"} | None.
    Returns (raw, trace, prompt): `raw` is the first reply that is NOT an embedded call (a final answer, or a call to a tool that belongs to the web app); `trace` lists the
    embedded calls that ran [{name, arguments, result}]."""
    from sham_tools_data import tool_call_text
    trace: list[dict] = []
    raw = generate(prompt)
    while enabled() and len(trace) < max_calls:
        call = extract(raw, prompt, tool_names)
        if not call or call["name"] not in EMBEDDED:
            break
        args = call.get("arguments") or {}
        run_name, run_args = SANDBOX_ALIAS[call["name"]](args) if call["name"] in SANDBOX_ALIAS else (call["name"], args)
        result = run_embedded(run_name, {k: v for k, v in run_args.items() if v is not None}, session)
        trace.append({"name": call["name"], "arguments": args, "result": str(result)[:RESULT_CHARS]})
        prompt = extend_prompt(prompt, tool_call_text(call["name"], args), call["name"], result)
        raw = generate(prompt)
    return raw, trace, prompt


def has_embedded_tools(prompt: str) -> bool:
    return any(f"- {n}(" in prompt for n in EMBEDDED)


def _selftest() -> None:
    import tempfile
    import os
    os.environ["SHAM_COMPUTER_HOME"] = tempfile.mkdtemp()
    sham_computer._ISOLATION = "none"
    from sham_native_tools import extract_tool_call
    names = ["computer_run", "computer_write", "web_search"]
    prompt = "- computer_run(command) — x\n- computer_write(path, content) — x\n- web_search(query) — x\n\nالمستخدم: اكتب ملفاً ثم اقرأه\nشام:"
    script = iter([
        '<tool_call>{"name": "computer_write", "arguments": {"path": "a.txt", "content": "hello"}}</tool_call>',
        '<tool_call>{"name": "computer_run", "arguments": {"command": "cat a.txt"}}</tool_call>',
        'تم: الملف يحتوي hello',
    ])
    seen = []

    def gen(p):
        seen.append(p)
        return next(script)
    raw, trace, final_prompt = loop(gen, extract_tool_call, prompt, names, "s1")
    assert raw.startswith("تم") and [t["name"] for t in trace] == ["computer_write", "computer_run"], (raw, trace)
    assert "hello" in trace[1]["result"], trace
    assert "نتيجة الأداة computer_write:" in seen[1] and seen[1].rstrip().endswith("شام:") and seen[2].count("نتيجة الأداة") == 2
    # a tool that belongs to the web app is returned to it, not run here
    raw2, trace2, _ = loop(lambda p: '<tool_call>{"name": "web_search", "arguments": {"query": "x"}}</tool_call>', extract_tool_call, prompt, names, "s1")
    assert not trace2 and "web_search" in raw2
    # sessions do not share a workspace
    assert "a.txt" not in run_embedded("computer_run", {"command": "ls"}, "other")
    # the loop is bounded
    endless = lambda p: '<tool_call>{"name": "computer_run", "arguments": {"command": "echo hi"}}</tool_call>'
    _, tr3, _ = loop(endless, extract_tool_call, prompt, names, "s2", max_calls=3)
    assert len(tr3) == 3
    os.environ["SHAM_INTERNAL_COMPUTER"] = "0"
    _, tr4, _ = loop(endless, extract_tool_call, prompt, names, "s2")
    assert tr4 == []
    os.environ["SHAM_INTERNAL_COMPUTER"] = "1"
    sprompt = prompt + "\n- sandbox_exec(command) — x"
    _it = iter(['<tool_call>{"name": "sandbox_exec", "arguments": {"command": "echo viaalias"}}</tool_call>', "تم"])
    sraw, strace, _ = loop(lambda p: next(_it), extract_tool_call, sprompt, names + ["sandbox_exec"], "s5")
    assert strace and "viaalias" in strace[0]["result"] and strace[0]["name"] == "sandbox_exec", strace
    assert has_embedded_tools(prompt) and not has_embedded_tools("hello")
    print("sham_embedded_tools self-test OK: the model's own loop runs the computer, returns other tools to the app, is bounded and per-session")


if __name__ == "__main__":
    _selftest()
