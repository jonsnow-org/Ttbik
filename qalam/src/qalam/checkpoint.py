"""Atomic checkpoints with an integrity hash and a lineage: a checkpoint names its parent's hash and is never silently resized or rebased."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import torch

from .config import ModelConfig, config_hash
from .model import Qalam


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def save_checkpoint(path: str | Path, model: Qalam, step: int, parent_sha: str | None = None, meta: dict | None = None) -> str:
    """ONE file holds the weights, the configuration (with its architecture hash), the step and the lineage, so they can never disagree after an interruption. The
    `.json` beside it is a readable copy with the file's SHA-256, written second: if it is missing or stale, `load_checkpoint` falls back to the embedded record."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"step": int(step), "parent_sha256": parent_sha, "meta": meta or {}, "config_hash": config_hash(model.cfg)}
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    os.close(fd)
    try:
        torch.save({"state": model.state_dict(), "config": model.cfg.to_dict(), "step": int(step), "record": record}, tmp)
        os.replace(tmp, path)                                   # atomic: a reader sees the old file or the whole new one
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    sha = _sha(path)
    side = {**record, "sha256": sha}
    tmp_side = path.with_suffix(path.suffix + ".json.tmp")
    tmp_side.write_text(json.dumps(side, sort_keys=True), encoding="utf-8")
    os.replace(tmp_side, path.with_suffix(path.suffix + ".json"))
    return sha


def load_checkpoint(path: str | Path, expect_hash: str | None = None, parents_dir: str | Path | None = None) -> tuple[Qalam, dict]:
    """Loads and verifies: the file's SHA-256 against the sidecar (when both are consistent), the configuration hash against `expect_hash` (the frozen architecture),
    and, if `parents_dir` is given, that the named parent checkpoint exists there and matches its own recorded hash, all the way back (a lineage that cannot be walked is refused)."""
    path = Path(path)
    blob = torch.load(path, map_location="cpu", weights_only=True)
    side_path = path.with_suffix(path.suffix + ".json")
    side = dict(blob["record"])
    side["sha256"] = _sha(path)
    if side_path.exists():
        disk = json.loads(side_path.read_text(encoding="utf-8"))
        if disk.get("step") == side["step"] and disk.get("sha256") != side["sha256"]:
            raise ValueError("checkpoint failed its integrity check")
    cfg = ModelConfig(**blob["config"])
    if config_hash(cfg) != side["config_hash"] or (expect_hash is not None and side["config_hash"] != expect_hash):
        raise ValueError("checkpoint architecture does not match the frozen one")
    if parents_dir is not None:
        seen, cur = set(), side
        while cur.get("parent_sha256"):
            want = cur["parent_sha256"]
            if want in seen:
                raise ValueError("lineage loops")
            seen.add(want)
            found = [f for f in Path(parents_dir).glob("*.pt") if _sha(f) == want]
            if not found:
                raise ValueError(f"lineage broken: parent {want[:12]} is not in {parents_dir}")
            cur = dict(torch.load(found[0], map_location="cpu", weights_only=True)["record"])
    model = Qalam(cfg)
    model.load_state_dict(blob["state"])
    return model, side
