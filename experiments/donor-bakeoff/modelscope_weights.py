"""Verified download of one donor candidate's private ModelScope GGUF/projector pair.

The candidate mapping is intentionally closed: a candidate cannot point at another
candidate's repository, even if its manifest is modified.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
from typing import Callable

MANIFEST_NAME = "candidate-weights-manifest.json"
EXPECTED_REPOSITORIES = {
    "qwen35-9b": "novaai2026/sham-donor-qwen35-9b-weights",
    "gemma4-e4b": "novaai2026/sham-donor-gemma4-e4b-weights",
    "minicpmo45": "novaai2026/sham-donor-minicpmo45-weights",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative_filename(filename: str) -> Path:
    raw = str(filename or "").replace("\\", "/")
    parsed = PurePosixPath(raw)
    if not raw or parsed.is_absolute() or any(part in ("", ".", "..") for part in parsed.parts):
        raise RuntimeError("Candidate weight filename is not a safe repository-relative path.")
    return Path(*parsed.parts)


def re_full_sha(value: object) -> bool:
    text = str(value or "").lower()
    return len(text) == 64 and all(ch in "0123456789abcdef" for ch in text)


def re_full_commit(value: object) -> bool:
    text = str(value or "").lower()
    return len(text) == 40 and all(ch in "0123456789abcdef" for ch in text)


def download_candidate_file(
    config: dict,
    filename: str,
    cache_dir: str | Path,
    *,
    token: str | None = None,
    snapshot_download_impl: Callable | None = None,
    login_impl: Callable | None = None,
) -> Path:
    """Download and hash-check one selected GGUF/projector from its pinned private ModelScope repo."""
    if not isinstance(config, dict):
        raise RuntimeError("Candidate configuration is missing.")
    route_id = str(config.get("route_id") or "").strip()
    expected_repo = EXPECTED_REPOSITORIES.get(route_id)
    repo_id = str(config.get("modelscope_repo_id") or "").strip()
    if not expected_repo or repo_id != expected_repo:
        raise RuntimeError("Candidate-to-private-ModelScope-repository mapping is invalid; cross-candidate routing is refused.")
    if str(config.get("modelscope_weights_revision") or "").strip() != "2026-11-03-r1":
        raise RuntimeError("Candidate private ModelScope weight revision is missing or not approved.")
    allowed_files = {str(config.get("filename") or ""), str(config.get("mmproj_filename") or "")}
    if filename not in allowed_files or not filename:
        raise RuntimeError("Requested weight file is not assigned to this candidate.")
    relative = _relative_filename(filename)
    auth = (token if token is not None else (os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "")).strip()
    if not auth:
        raise RuntimeError("MODELSCOPE_API_TOKEN is required to read the candidate's private weight repository.")
    cache = Path(cache_dir).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    if login_impl is None:
        from modelscope.hub.api import HubApi
        HubApi().login(auth)
    else:
        login_impl(auth)
    if snapshot_download_impl is None:
        from modelscope import snapshot_download
        snapshot_download_impl = snapshot_download
    snapshot_download_impl(repo_id, local_dir=str(cache), allow_patterns=[MANIFEST_NAME, filename])
    manifest_path = cache / MANIFEST_NAME
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError("The private ModelScope weight repository is missing its integrity manifest.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("The private ModelScope weight manifest is unreadable.") from exc
    if (
        not isinstance(manifest, dict)
        or manifest.get("candidate_id") != route_id
        or manifest.get("source_repo_id") != config.get("repo_id")
        or not re_full_commit(manifest.get("source_revision"))
        or manifest.get("modelscope_repo_id") != repo_id
        or manifest.get("modelscope_weights_revision") != config.get("modelscope_weights_revision")
        or manifest.get("filename") != config.get("filename")
        or manifest.get("mmproj_filename") != config.get("mmproj_filename")
    ):
        raise RuntimeError("Private ModelScope weight manifest does not match this candidate's pinned assignment.")
    entry = (manifest.get("files") or {}).get(filename)
    if not isinstance(entry, dict) or not re_full_sha(entry.get("sha256")):
        raise RuntimeError("The private ModelScope manifest has no valid SHA-256 for the requested file.")
    target = cache / relative
    # A repository path must not escape this candidate's private cache through a symlink.
    if target.is_symlink():
        raise RuntimeError("Candidate weight file is a symlink; refusing to read outside the private cache.")
    resolved_target = target.resolve()
    if cache not in resolved_target.parents:
        raise RuntimeError("Candidate weight file resolves outside its private cache; refusing cross-session access.")
    if not resolved_target.is_file():
        raise RuntimeError("The selected candidate's private ModelScope repository did not deliver " + filename)
    target = resolved_target
    actual_size = target.stat().st_size
    expected_size = int(entry.get("size_bytes") or 0)
    if actual_size < 1_000_000 or actual_size != expected_size:
        raise RuntimeError(f"Candidate weight size mismatch for {filename}: got {actual_size}, expected {expected_size}.")
    actual_sha = _sha256(target)
    if actual_sha != str(entry["sha256"]).lower():
        raise RuntimeError("Candidate weight SHA-256 mismatch for " + filename + "; the file is not loaded.")
    return target
