"""An append-only, hash-chained record of everything the model does to itself or the world, and an emergency stop. Each line carries the hash of the line before it, so
deleting or editing an earlier line is detected (`verify`). The stop is a flag the agent loop checks before every step. Protected: the model does not edit its own record."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path


class AuditLog:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _last_hash(self) -> str:
        if not self.path.exists() or not self.path.stat().st_size:
            return "0" * 64
        last = self.path.read_text(encoding="utf-8").strip().splitlines()[-1]
        return json.loads(last)["hash"]

    def append(self, kind: str, **fields) -> str:
        rec = {"time": round(time.time(), 3), "kind": kind, **fields, "prev": self._last_hash()}
        rec["hash"] = hashlib.sha256(json.dumps(rec, sort_keys=True, default=str).encode()).hexdigest()
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, sort_keys=True, default=str) + "\n")
        return rec["hash"]

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(x) for x in self.path.read_text(encoding="utf-8").splitlines() if x.strip()]

    def verify(self) -> tuple[bool, int]:
        """(intact, index of the first broken line or -1)."""
        prev = "0" * 64
        for i, rec in enumerate(self.entries()):
            body = {k: v for k, v in rec.items() if k != "hash"}
            if rec.get("prev") != prev or hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest() != rec.get("hash"):
                return False, i
            prev = rec["hash"]
        return True, -1


class EmergencyStop:
    """A file that exists = stop. The owner (or an operator script) creates it; the agent loop and the self-improvement cycle check it and halt."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def engaged(self) -> bool:
        return self.path.exists()

    def engage(self, reason: str = "") -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(reason or "stop", encoding="utf-8")

    def release(self) -> None:
        self.path.unlink(missing_ok=True)
