"""Binding of the terminal loop to SHAM's own embedded computer (v1 and v2 use the same one today).

  ShamEmbeddedBackend(session, model_id)   runs every command through sham_embedded_tools.run_call: the SAME entry point the model's own tool loop uses. Consequences, all wanted:
      * one body: the files are the files of that session's embedded computer (sham_embedded_tools.computer_for);
      * the owner's read-only screen in the Mini App (`view(session, "activity")`) lists the terminal's commands like any other call: nothing is hidden from the owner;
      * sham_computer.py and sham_embedded_tools.py are not edited;
      * policy: default `model_computer_approvals` (owner 2026-11-18, approvals.py): the computer as it is, plus the owner's allow/deny before a sensitive command.
  Separation later (owner 2026-11-17: "we separate when we decide, each with its own computer, an exact copy of the first"): set SHAM_TLDM_SEPARATE_COMPUTERS=1 (or separate=True): the session key becomes
      "<model_id>:<session>", i.e. its own Computer of the same class with its own workspace. Today both models share, as the models themselves do.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "colab", "sham_small"))
from approvals import default_policy  # noqa: E402
from backends import ComputerBackend  # noqa: E402


def session_key(session: str, model_id: str = "sham", separate: bool | None = None) -> str:
    sep = separate if separate is not None else os.environ.get("SHAM_TLDM_SEPARATE_COMPUTERS", "0").strip() == "1"
    base = (session or "default").strip() or "default"
    return f"{model_id}:{base}" if sep else base


class ShamEmbeddedBackend(ComputerBackend):
    def __init__(self, session: str, model_id: str = "sham", policy: str | None = None, separate: bool | None = None, log_path: str | None = None, trusted: dict | None = None, owner: bool = False):
        import sham_embedded_tools as tools
        self._tools, self.model_id = tools, model_id
        self.key = session_key(session, model_id, separate)
        super().__init__(tools.computer_for(self.key), policy=policy or default_policy(), log_path=log_path, trusted=trusted, owner=owner)

    def _exec(self, command: str) -> str:
        return self._tools.run_call({"name": "computer_run", "arguments": {"command": command}}, self.key)
