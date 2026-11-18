"""Executors for the terminal loop. ONE BODY PER MODEL: the loop never creates a computer of its own where a model already has one; it works through the model's existing computer, so the files are the same
files the model's own tools and the Mini App's computer tab see, and no tool is replaced or hidden.

  SandboxBackend      the isolated local sandbox of sandbox_terminal.py (strict policy): tests, offline use, public demos.
  ComputerBackend     any object with `execute("computer_run", {"command": ...}) -> "exit code N\\n<output>"` - Sham's embedded Computer (ai-system/colab/sham_small/sham_computer.py) exactly as it is.
                      `policy="model_computer"` (default): the computer's own policy, unchanged (the owner's order of 2026-11-08 for Sham's computer).
                      `policy="model_computer_approvals"` (owner decision 2026-11-18; the default of the T-LDM binding, sham_binding.py): the same unrestricted base, PLUS
                      a sensitive command (approvals.sensitive) runs only after the owner's allow; until then it never reaches the computer.
                      `policy="strict"`: the book's safety rules (allowlist, forbidden list, confirmation, workspace-confined paths) are applied BEFORE the command reaches the computer.
Nothing here edits the computer; it only calls the tool the model already has (`computer_run`).
"""
from __future__ import annotations

import re
import time

from approvals import POLICIES, gate, sensitive
from sandbox_terminal import Result, SandboxTerminal

SandboxBackend = SandboxTerminal                     # same interface: run(command, confirm=False) -> Result


class ComputerBackend:
    def __init__(self, computer, policy: str = "model_computer", log_path: str | None = None, trusted: dict | None = None, deny_list=None, owner: bool = False):
        if policy not in POLICIES:
            raise ValueError(f"policy must be one of {POLICIES}")
        self.computer, self.policy, self.task = computer, policy, ""
        self.deny_list = list(deny_list or [])
        self.owner = bool(owner)
        home = getattr(computer, "home", None)
        self._vetter = SandboxTerminal(workdir=str(home), log_path=log_path, trusted=trusted) if policy == "strict" else None
        self._log = SandboxTerminal(workdir=str(home), log_path=log_path) if (log_path and policy != "strict") else None

    @property
    def dir(self):
        return str(self.computer.home)

    def close(self) -> None:                         # the computer belongs to its model's session: it is NOT closed here
        pass

    def run(self, command: str, confirm: bool = False) -> Result:
        t0 = time.time()
        if self._vetter is not None:
            _, _, why, needs = self._vetter.vet(command)
            if why:
                return self._done(Result(command, False, "", 126, refused=why), t0)
            if needs and not confirm:
                return self._done(Result(command, False, "", 0, refused="needs the user's confirmation", needs_confirmation=True), t0)
        action, why = gate(command, self.dir, getattr(self, "deny_list", None), owner=bool(getattr(self, "owner", False)))
        if action == "deny":
            return self._done(Result(command, False, "", 126, refused=f"denied: {why}"), t0)
        if self.policy == "model_computer_approvals" and not confirm and action == "ask":
            return self._done(Result(command, False, "", 0, refused=f"needs the user's approval: {why}", needs_confirmation=True), t0)
        text = self._exec(command)
        m = re.match(r"exit code (-?\d+)\n?(.*)", text, re.S)
        if m:
            code, out = int(m.group(1)), m.group(2).strip()
            return self._done(Result(command, code == 0, out, code), t0)
        return self._done(Result(command, False, text.strip(), 1), t0)       # "error: ..." (timeout, path, ...)

    def _exec(self, command: str) -> str:            # the one place that reaches the computer (subclasses change only HOW it is reached)
        return self.computer.execute("computer_run", {"command": command})

    def _done(self, r: Result, t0: float) -> Result:
        r.secs = round(time.time() - t0, 3)
        sink = self._vetter or self._log
        if sink is not None:
            sink.task = self.task
            sink._log(r)
        return r
