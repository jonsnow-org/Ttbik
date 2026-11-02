"""Resilient, identity-preserving ModelScope model downloads for private Studios.

Try both official Hub endpoints before using the Hub's Git/LFS transport. This
module never changes model IDs, repository ownership, or selected-model routing.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


def _clean_error(exc: BaseException, token: str) -> str:
    value = f"{type(exc).__name__}: {exc}"
    return value.replace(token, "***")[:360] if token else value[:360]


def _endpoints() -> list[str]:
    values = [
        os.environ.get("MODELSCOPE_ENDPOINT", "").strip(),
        "https://modelscope.ai",
        "https://modelscope.cn",
    ]
    out: list[str] = []
    for value in values:
        value = value.rstrip("/")
        if value and value not in out:
            out.append(value)
    return out


def _missing(root: Path, required_files: Iterable[str]) -> list[str]:
    return [name for name in required_files if not (root / name).is_file()]


def _snapshot(
    repo_id: str,
    cache_dir: Path,
    endpoint: str,
    token: str,
    allow_patterns: list[str] | None,
    local_dir: Path | None,
) -> Path:
    import inspect

    # Set the endpoint before importing the SDK: older ModelScope versions read
    # MODELSCOPE_ENDPOINT into module-level constants at import time.
    os.environ["MODELSCOPE_ENDPOINT"] = endpoint
    from modelscope import snapshot_download

    signature = inspect.signature(snapshot_download)
    params = signature.parameters
    kwargs = {"model_id": repo_id}
    if "cache_dir" in params:
        kwargs["cache_dir"] = str(cache_dir)
    if "endpoint" in params:
        kwargs["endpoint"] = endpoint
    else:
        os.environ["MODELSCOPE_ENDPOINT"] = endpoint
    if token and "token" in params:
        kwargs["token"] = token
    if allow_patterns and "allow_patterns" in params:
        kwargs["allow_patterns"] = allow_patterns
    if local_dir is not None and "local_dir" in params:
        kwargs["local_dir"] = str(local_dir)
    result = snapshot_download(**kwargs)
    return Path(result)


def _git_lfs_snapshot(
    repo_id: str,
    target: Path,
    endpoint: str,
    token: str,
    timeout_seconds: int,
) -> Path:
    from modelscope.hub.repository import Repository

    target.parent.mkdir(parents=True, exist_ok=True)
    expected_host = (urlparse(endpoint).hostname or "").lower()
    expected_repo = f"models/{repo_id}".lower()
    if target.exists():
        git_dir = target / ".git"
        if not git_dir.is_dir():
            # Only clear this model-specific download folder, never the Studio
            # source tree or another model's cache.
            shutil.rmtree(target)
        else:
            remote = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=str(target),
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
            ).stdout.strip()
            parsed = urlparse(remote)
            remote_host = (parsed.hostname or "").lower()
            remote_path = parsed.path.lstrip("/").lower().removesuffix(".git")
            if remote_host != expected_host or expected_repo not in remote_path:
                # A partial clone from a different official endpoint must not be
                # reused for this retry.
                shutil.rmtree(target)
    Repository(
        model_dir=str(target),
        clone_from=f"models/{repo_id}",
        git_token=token or None,
        endpoint=endpoint,
    )
    subprocess.run(
        ["git", "lfs", "pull"],
        cwd=str(target),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_seconds,
    )
    return target


def download_model_repo(
    repo_id: str,
    cache_dir: str | Path,
    *,
    token: str = "",
    allow_patterns: list[str] | None = None,
    required_files: Iterable[str] = (),
    local_dir: str | Path | None = None,
    allow_git_fallback: bool = True,
    timeout_seconds: int = 1200,
) -> Path:
    """Download one exact ModelScope model repo; validate expected files before use.

    The normal HTTP snapshot path is attempted on both official endpoints.
    Git/LFS is a fallback for Hub API listing/authentication incidents. If an
    exact per-model repository cannot be loaded, this raises instead of
    switching to another model or another Studio.
    """
    if not isinstance(repo_id, str) or repo_id.count("/") != 1 or any(x in repo_id for x in ("..", "\\", " ")):
        raise ValueError("Invalid ModelScope model repository ID.")
    token = str(token or "").strip()
    cache = Path(cache_dir).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    local = Path(local_dir).expanduser() if local_dir is not None else None
    required = tuple(required_files)
    errors: list[str] = []

    for endpoint in _endpoints():
        try:
            root = _snapshot(repo_id, cache, endpoint, token, allow_patterns, local)
            missing = _missing(root, required)
            if not missing:
                return root
            errors.append(f"{endpoint}: snapshot incomplete ({', '.join(missing[:4])})")
        except Exception as exc:  # noqa: BLE001 - continue to the alternate official endpoint
            errors.append(f"{endpoint}: {_clean_error(exc, token)}")

    if allow_git_fallback:
        for endpoint in _endpoints():
            slug = repo_id.replace("/", "--")
            target = local if local is not None else cache / "_git_lfs" / slug
            if local is not None:
                # Use the supplied model-specific directory as the isolated
                # fallback. A non-Git partial snapshot can be safely replaced.
                target = local
            else:
                target = target.parent / f"{slug}-{endpoint.split('//', 1)[-1].replace('.', '-')}"
            try:
                root = _git_lfs_snapshot(repo_id, target, endpoint, token, timeout_seconds)
                missing = _missing(root, required)
                if not missing:
                    return root
                errors.append(f"{endpoint}: Git/LFS snapshot incomplete ({', '.join(missing[:4])})")
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{endpoint}: Git/LFS {_clean_error(exc, token)}")

    detail = "; ".join(errors[-6:])
    raise RuntimeError(f"ModelScope download failed for the selected repository {repo_id}: {detail[:1800]}")
