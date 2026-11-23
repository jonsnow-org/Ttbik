"""Atomic checkpoints with an integrity hash and a lineage: a checkpoint names its parent's hash and is never silently resized or rebased."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import torch

from .config import ModelConfig
from .model import Qalam


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def save_checkpoint(path: str | Path, model: Qalam, step: int, parent_sha: str | None = None, meta: dict | None = None) -> str:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    os.close(fd)
    try:
        torch.save({"state": model.state_dict(), "config": model.cfg.to_dict(), "step": int(step)}, tmp)
        os.replace(tmp, path)                                   # atomic: a reader sees the old file or the whole new one
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    sha = _sha(path)
    side = {"sha256": sha, "step": int(step), "parent_sha256": parent_sha, "meta": meta or {}}
    tmp_side = path.with_suffix(path.suffix + ".json.tmp")
    tmp_side.write_text(json.dumps(side, sort_keys=True), encoding="utf-8")
    os.replace(tmp_side, path.with_suffix(path.suffix + ".json"))
    return sha


def load_checkpoint(path: str | Path) -> tuple[Qalam, dict]:
    path = Path(path)
    side = json.loads(path.with_suffix(path.suffix + ".json").read_text(encoding="utf-8"))
    if _sha(path) != side["sha256"]:
        raise ValueError("checkpoint failed its integrity check")
    blob = torch.load(path, map_location="cpu", weights_only=True)
    model = Qalam(ModelConfig(**blob["config"]))
    model.load_state_dict(blob["state"])
    return model, side
