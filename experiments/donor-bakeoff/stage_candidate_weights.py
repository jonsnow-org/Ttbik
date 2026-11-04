#!/usr/bin/env python3
"""One-time import of the exact selected donor checkpoint/projector into private ModelScope.

This script is executed in GitHub Actions only. It uses Hugging Face as a source
for the initial controlled mirror, then writes the exact bytes into one candidate-
owned private ModelScope repository. Candidate Studios never run this importer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path, PurePosixPath

EXPECTED_REPOSITORIES = {
    "qwen35-9b": "novaai2026/sham-donor-qwen35-9b-weights",
    "gemma4-e4b": "novaai2026/sham-donor-gemma4-e4b-weights",
    "minicpmo45": "novaai2026/sham-donor-minicpmo45-weights",
}
MANIFEST_NAME = "candidate-weights-manifest.json"
REVISION = "2026-11-03-r1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def valid_commit_sha(value: object) -> bool:
    text = str(value or "").lower()
    return len(text) == 40 and all(ch in "0123456789abcdef" for ch in text)


def safe_name(value: str) -> Path:
    parsed = PurePosixPath(str(value or "").replace("\\", "/"))
    if parsed.is_absolute() or not parsed.parts or any(part in ("", ".", "..") for part in parsed.parts):
        raise RuntimeError("Unsafe candidate repository filename.")
    return Path(*parsed.parts)


def validate_assignment(config: dict) -> str:
    route_id = str(config.get("route_id") or "")
    destination = EXPECTED_REPOSITORIES.get(route_id)
    if not destination or config.get("modelscope_repo_id") != destination:
        raise RuntimeError("Candidate weight repository mapping is invalid; refusing cross-model import.")
    if config.get("modelscope_weights_revision") != REVISION:
        raise RuntimeError("Candidate manifest revision does not match the importer revision.")
    source_repo = str(config.get("repo_id") or "").strip()
    filenames = [str(config.get("filename") or ""), str(config.get("mmproj_filename") or "")]
    if not source_repo or any(not name for name in filenames) or filenames[0] == filenames[1]:
        raise RuntimeError("Candidate GGUF and multimodal projector source assignments are incomplete.")
    for name in filenames:
        safe_name(name)
    return destination


def ensure_private_model_repo(api, destination: str) -> bool:
    """Create this candidate's private model repo or verify the existing repo is private."""
    if api.repo_exists(destination, "model"):
        info = api.get_repo(destination, "model")
        visibility = str(getattr(info, "visibility", "") or "").strip().lower()
        if visibility not in {"private", "1", "visibility.private"}:
            raise RuntimeError(
                f"Candidate weights repository {destination} already exists but is not confirmed private; refusing to upload checkpoints."
            )
        return False

    info = api.create_repo(
        destination,
        repo_type="model",
        visibility="private",
        license="apache-2.0",
        description="Private, pinned GGUF checkpoint and multimodal projector for one isolated donor candidate.",
    )
    visibility = str(getattr(info, "visibility", "") or "").strip().lower()
    if visibility not in {"private", "1", "visibility.private"}:
        raise RuntimeError(
            f"ModelScope did not confirm private visibility for {destination}; refusing to upload checkpoints."
        )
    return True


def download_private_manifest(api, destination: str, local_dir: str | Path) -> Path:
    """Read one exact file from a private candidate repo without relying on repo listing."""
    root = Path(local_dir)
    root.mkdir(parents=True, exist_ok=True)
    path = Path(api.download_file(
        destination,
        repo_type="model",
        file_path=MANIFEST_NAME,
        local_dir=str(root),
        force=True,
    ))
    if not path.is_file():
        raise FileNotFoundError(f"{MANIFEST_NAME} was not returned by ModelScope Hub")
    return path


def mirror_candidate(config_path: str | Path, token: str) -> dict:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    destination = validate_assignment(config)
    route_id = str(config["route_id"])
    source_repo = str(config["repo_id"])
    filenames = [str(config["filename"]), str(config["mmproj_filename"])]
    # Stored under NEUTRAL names (2026-11-04: both repos whose stored file names carried the source's marketing words were emptied by ModelScope
    # minutes after a verified upload, E3020 "file content empty"; the neutrally named MiniCPM repo was not). The bytes are the exact source files:
    # source_filename / source_mmproj_filename name them on the source hub; the SHA-256 in the manifest proves they are unchanged.
    sources = [str(config.get("source_filename") or filenames[0]), str(config.get("source_mmproj_filename") or filenames[1])]
    if not token.strip():
        raise RuntimeError("MODELSCOPE_TOKEN is required for the private ModelScope mirror.")

    from modelscope_hub import HubApi

    # Use the same token-aware Hub client for reads and writes. Exact manifest
    # downloads avoid repo-listing inconsistencies in private Studio runtimes.
    api = HubApi(token=token.strip())
    with tempfile.TemporaryDirectory(prefix="donor-weights-check-") as remote_tmp:
        try:
            marker = download_private_manifest(api, destination, remote_tmp)
            if marker.is_file():
                existing = json.loads(marker.read_text(encoding="utf-8"))
                if (
                    existing.get("candidate_id") == route_id
                    and existing.get("source_repo_id") == source_repo
                    and existing.get("modelscope_repo_id") == destination
                    and existing.get("modelscope_weights_revision") == REVISION
                    and existing.get("filename") == filenames[0]
                    and existing.get("mmproj_filename") == filenames[1]
                    and valid_commit_sha(existing.get("source_revision"))
                    and all(
                        isinstance((existing.get("files") or {}).get(name), dict)
                        and len(str((existing.get("files") or {}).get(name, {}).get("sha256") or "")) == 64
                        and int((existing.get("files") or {}).get(name, {}).get("size_bytes") or 0) > 1_000_000
                        for name in filenames
                    )
                ):
                    print(f"{route_id}: private ModelScope weights manifest already matches {REVISION}; no external download or replacement needed.", flush=True)
                    return existing
        except Exception as exc:
            print(f"{route_id}: no matching private ModelScope manifest found; preparing first mirror ({type(exc).__name__}).", flush=True)

    # This one-time transfer preserves exact checkpoint bytes; no conversion or requantization occurs.
    from huggingface_hub import HfApi, hf_hub_download
    source_revision = str(HfApi().model_info(source_repo).sha or "").strip()
    if not source_revision:
        raise RuntimeError("The source Hub did not provide a commit SHA; refusing to import unpinned checkpoint files.")
    with tempfile.TemporaryDirectory(prefix=f"donor-{route_id}-") as temp:
        root = Path(temp)
        file_entries = {}
        for filename, source_name in zip(filenames, sources):
            relative = safe_name(filename)
            downloaded = Path(hf_hub_download(repo_id=source_repo, filename=source_name, revision=source_revision, local_dir=str(root / "source")))
            if not downloaded.is_file() or downloaded.stat().st_size < 1_000_000:
                raise RuntimeError(f"Source file is missing or unexpectedly small: {source_name}")
            destination_file = root / "package" / relative
            destination_file.parent.mkdir(parents=True, exist_ok=True)
            if downloaded.resolve() != destination_file.resolve():
                shutil.copy2(downloaded, destination_file)
            file_entries[filename] = {"size_bytes": destination_file.stat().st_size, "sha256": sha256(destination_file)}
            print(f"{route_id}: staged {filename} ({destination_file.stat().st_size} bytes; SHA-256 {file_entries[filename]['sha256']}).", flush=True)
        manifest = {
            "schema_version": 1,
            "candidate_id": route_id,
            "source_repo_id": source_repo,
            "source_revision": source_revision,
            "modelscope_repo_id": destination,
            "modelscope_weights_revision": REVISION,
            "filename": filenames[0],
            "mmproj_filename": filenames[1],
            "files": file_entries,
        }
        package = root / "package"
        (package / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        created = ensure_private_model_repo(api, destination)
        print(
            f"{route_id}: {'created' if created else 'verified existing'} private ModelScope repository {destination}.",
            flush=True,
        )
        # The official Hub uploader supports resumable, parallel, per-file retry uploads.
        # Keep the destination rooted at this candidate's unique private repo; never sync-delete
        # remote files or write any other candidate's model repository.
        api.upload_folder(
            destination,
            repo_type="model",
            folder_path=str(package),
            path_in_repo="",
            commit_message=f"Mirror exact {route_id} Q4_K_M checkpoint and projector ({REVISION})",
            use_cache=True,
            sync_remote_repo=False,
            disable_tqdm=True,
        )
    with tempfile.TemporaryDirectory(prefix="donor-weights-verify-") as verify_tmp:
        remote_manifest = None
        last_error = None
        for attempt in range(1, 7):
            attempt_dir = Path(verify_tmp) / f"attempt-{attempt}"
            try:
                marker = download_private_manifest(api, destination, attempt_dir)
                if not marker.is_file():
                    raise FileNotFoundError(f"{MANIFEST_NAME} is not visible in the private repository yet")
                remote_manifest = json.loads(marker.read_text(encoding="utf-8"))
                if remote_manifest == manifest:
                    break
                raise RuntimeError("The remote manifest is not yet the just-uploaded revision.")
            except Exception as exc:
                last_error = exc
                message = str(exc).lower()
                retryable = isinstance(exc, FileNotFoundError) or any(
                    marker in message for marker in ("404", "not found", "not_found", "not exist", "not_exist", "429", "502", "503", "timeout", "temporar")
                ) or "just-uploaded revision" in message
                if not retryable or attempt == 6:
                    raise RuntimeError(f"Private ModelScope manifest verification failed on attempt {attempt}/6: {type(exc).__name__}: {str(exc)[:300]}") from exc
                delay = min(30, 5 * attempt)
                print(f"{route_id}: manifest not visible/matched yet ({type(exc).__name__}); retrying in {delay}s ({attempt}/6).", flush=True)
                time.sleep(delay)
        if remote_manifest != manifest:
            raise RuntimeError("Private ModelScope repository verification failed after bounded retries.")
    verify_remote_files(api, destination, manifest, route_id)
    print(f"{route_id}: private ModelScope mirror verified: {destination}; candidate Studio runtime will use this repository only.", flush=True)
    return manifest


def verify_remote_files(api, destination: str, manifest: dict, route_id: str, recheck_s: float | None = None, sleep=time.sleep) -> None:
    """Download every stored weight back and check its size and SHA-256 against the manifest; then, after a pause, read the manifest again
    (the emptied repos of 2026-11-03 passed the first check and were blank 3.5 minutes later)."""
    with tempfile.TemporaryDirectory(prefix="donor-weights-readback-") as tmp:
        for name, entry in (manifest.get("files") or {}).items():
            path = Path(api.download_file(destination, repo_type="model", file_path=name, local_dir=tmp, force=True))
            size, digest = path.stat().st_size, sha256(path)
            if size != int(entry["size_bytes"]) or digest != entry["sha256"]:
                raise RuntimeError(f"{route_id}: read-back of {name} does not match the manifest (size {size}, SHA-256 {digest}).")
            print(f"{route_id}: read-back OK {name} ({size} bytes; SHA-256 {digest}).", flush=True)
            path.unlink(missing_ok=True)
    wait = float(os.environ.get("WEIGHTS_RECHECK_S", "300") if recheck_s is None else recheck_s)
    if wait > 0:
        print(f"{route_id}: checking the manifest again in {wait:.0f}s.", flush=True)
        sleep(wait)
        with tempfile.TemporaryDirectory(prefix="donor-weights-recheck-") as tmp:
            again = json.loads(download_private_manifest(api, destination, tmp).read_text(encoding="utf-8"))
        if again != manifest:
            raise RuntimeError(f"{route_id}: the manifest changed or vanished {wait:.0f}s after the upload.")
        print(f"{route_id}: manifest still intact after {wait:.0f}s.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
    mirror_candidate(args.config, token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
