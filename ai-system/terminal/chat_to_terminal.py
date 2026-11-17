"""The terminal behind the chat: the user talks to the chat, the chat model drives a sandboxed terminal, and the user sees only the final reply (the terminal stays hidden).

Protocol with the model: a message whose first line starts with "$ " is a command for the terminal; anything else is the final reply to the user.
After a command the model receives "[terminal] ok|failed|refused ...: output" and continues. A command that needs confirmation is run only if confirm(command) says yes.
`model(messages) -> str` is any callable (a local llama-server, a Studio, a scripted test double); nothing here depends on one model.
"""
from __future__ import annotations

from typing import Callable

from sandbox_terminal import SandboxTerminal

SYSTEM = ("You can use a private terminal. To run a command write exactly one line starting with '$ ' (for example: $ ls). "
          "You will receive the result. When you are done, answer the user in plain text with no '$' line. "
          "Allowed: ls cat echo pwd head tail wc grep sort uniq mkdir touch date seq tr cut python3. Paths stay inside your working folder.")


def observation(r) -> str:
    if r.refused:
        return f"[terminal] refused: {r.refused}"
    return f"[terminal] {'ok' if r.ok else 'failed'}" + (f": {r.out}" if r.out else "")


def run_turn(model: Callable[[list], str], user_message: str, term: SandboxTerminal, history: list | None = None, max_steps: int = 6,
             confirm: Callable[[str], bool] | None = None) -> tuple[str, list]:
    """-> (reply for the user, events). `history` is the chat so far (the caller keeps it)."""
    msgs = [{"role": "system", "content": SYSTEM}] + list(history or []) + [{"role": "user", "content": user_message}]
    term.task = user_message[:200]
    events = []
    for _ in range(max_steps):
        out = model(msgs).strip()
        first = out.splitlines()[0] if out else ""
        if not first.startswith("$ "):
            return out, events
        cmd = first[2:].strip()
        r = term.run(cmd)
        if r.needs_confirmation and confirm is not None and confirm(cmd):
            r = term.run(cmd, confirm=True)
        events.append(r)
        msgs.append({"role": "assistant", "content": first})
        msgs.append({"role": "user", "content": observation(r)})
    return "I could not finish within the allowed number of steps.", events
