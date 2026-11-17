"""The terminal's long-term memory as files (section 7 of the book; step 2 of docs/experiments/TLDM_TERMINAL_SPEC.md §3). Stdlib only: the serving path can import it without torch.

  * every finished episode is ONE JSON file: successes in memory_lora/, failures in memory_errors/ (the lessons);
  * a step is [command, result] (older records) or [command, result, ok] (new records: ok = the command itself ran and exited 0);
  * recall(task)          -> the earlier success for the same task (normalised text), or None;
  * failed_commands(task) -> commands that FAILED for that task before (records with the ok flag: only the commands that failed; older records: every command of the failed episode,
                             the behaviour training/evolve.py was written against);
  * memory_for(root, model_id, session) -> the store of ONE model (and, unless shared, one user session): Sham v1 and Sham v2 never read each other's memory
                             (one body per model, no routing between models), and one user's episodes are not replayed for another user unless the owner decides to share.
Nothing here edits a model's weights; deleting the folder forgets everything.
"""
from __future__ import annotations

import hashlib
import json
import os
import re


def _norm(task: str) -> str:
    return re.sub(r"\s+", " ", (task or "").strip().lower())


def _safe(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", part or "default")[:80] or "default"


class MemoryStore:
    def __init__(self, root: str):
        self.root = root
        self.ok_dir, self.err_dir = os.path.join(root, "memory_lora"), os.path.join(root, "memory_errors")
        os.makedirs(self.ok_dir, exist_ok=True)
        os.makedirs(self.err_dir, exist_ok=True)

    def _path(self, task: str, success: bool) -> str:
        return os.path.join(self.ok_dir if success else self.err_dir, hashlib.md5(_norm(task).encode()).hexdigest()[:12] + ".json")

    @staticmethod
    def _read(path: str):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None                                             # a damaged file is a forgotten memory, never a crash

    def save(self, task: str, steps: list, reply: str, success: bool, secs: float = 0.0) -> str:
        """steps = [(command, result), ...] or [(command, result, ok), ...] actually executed."""
        rec = {"task": task, "steps": [list(s) for s in steps], "reply": reply, "success": success, "secs": round(secs, 3)}
        path = self._path(task, success)
        if not success and os.path.exists(path):                    # a lesson keeps every failed attempt
            old = self._read(path) or {}
            rec["steps"] = old.get("steps", []) + rec["steps"]
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
        return path

    def recall(self, task: str):
        p = self._path(task, True)
        return self._read(p) if os.path.exists(p) else None

    def forget(self, task: str) -> bool:
        """Removes the remembered success for a task (e.g. the owner says the remembered answer was wrong)."""
        p = self._path(task, True)
        if os.path.exists(p):
            os.remove(p)
            return True
        return False

    def failed_commands(self, task: str) -> set:
        p = self._path(task, False)
        rec = self._read(p) if os.path.exists(p) else None
        if not rec:
            return set()
        out = set()
        for s in rec.get("steps", []):
            if len(s) >= 3:
                if not s[2]:
                    out.add(s[0])
            else:
                out.add(s[0])
        return out

    def successes(self) -> list:
        recs = (self._read(os.path.join(self.ok_dir, f)) for f in sorted(os.listdir(self.ok_dir)) if f.endswith(".json"))
        return [r for r in recs if r]


def memory_for(root: str, model_id: str, session: str | None = None, shared: bool = False) -> MemoryStore:
    """The memory of one model: <root>/<model_id>/<session>/ (or <root>/<model_id>/_shared/ when the owner shares it between users)."""
    return MemoryStore(os.path.join(root, _safe(model_id), "_shared" if shared else _safe(session or "default")))
