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
    hub_api_factory: Callable | None = None,
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
    if token is not None:
        auth = str(token).strip()
        token_source = "argument"
    else:
        auth = ""
        token_source = ""
        # A candidate-specific Studio secret must win over any stale shared
        # ModelScope variables that may have been retained by a prior image.
        for name in ("DONOR_MODEL_READ_TOKEN", "MODELSCOPE_API_TOKEN", "MODELSCOPE_TOKEN"):
            candidate_token = str(os.environ.get(name) or "").strip()
            if candidate_token:
                auth = candidate_token
                token_source = name
                break
    if not auth:
        raise RuntimeError("DONOR_MODEL_READ_TOKEN is required to read the candidate's private weight repository.")
    cache = Path(cache_dir).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    # Download exact file paths instead of enumerating the private repo.
    # Some ModelScope Studio runtimes return an empty repo listing for a private
    # repository even when the same token can read individual files. Direct
    # per-file reads fail loudly on auth/404, and force=True avoids stale cache.
    if hub_api_factory is None:
        from modelscope_hub import HubApi
        hub_api_factory = HubApi
    api = hub_api_factory(token=auth)
    try:
        api.download_file(
            repo_id,
            repo_type="model",
            file_path=MANIFEST_NAME,
            local_dir=str(cache),
            force=True,
        )
    except Exception as exc:
        # Report only the selected variable name; never expose its secret value.
        raise RuntimeError(
            f"ModelScope could not read {MANIFEST_NAME} from {repo_id}@master "
            f"using {token_source}: {type(exc).__name__}: {str(exc)[:500]}"
        ) from exc
    manifest_path = cache / MANIFEST_NAME
    if not manifest_path.is_file():
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
    api.download_file(
        repo_id,
        repo_type="model",
        file_path=filename,
        local_dir=str(cache),
        force=True,
    )
    if not target.is_file():
        raise RuntimeError("The selected candidate's private ModelScope repository did not deliver " + filename)
    actual_size = target.stat().st_size
    expected_size = int(entry.get("size_bytes") or 0)
    if actual_size < 1_000_000 or actual_size != expected_size:
        raise RuntimeError(f"Candidate weight size mismatch for {filename}: got {actual_size}, expected {expected_size}.")
    actual_sha = _sha256(target)
    if actual_sha != str(entry["sha256"]).lower():
        raise RuntimeError("Candidate weight SHA-256 mismatch for " + filename + "; the file is not loaded.")
    return target
