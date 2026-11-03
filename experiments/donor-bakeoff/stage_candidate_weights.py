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


def mirror_candidate(config_path: str | Path, token: str) -> dict:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    destination = validate_assignment(config)
    route_id = str(config["route_id"])
    source_repo = str(config["repo_id"])
    filenames = [str(config["filename"]), str(config["mmproj_filename"])]
    if not token.strip():
        raise RuntimeError("MODELSCOPE_TOKEN is required for the private ModelScope mirror.")

    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility

    api = HubApi()
    api.login(token.strip())
    with tempfile.TemporaryDirectory(prefix="donor-weights-check-") as remote_tmp:
        try:
            snapshot_download(destination, local_dir=remote_tmp, allow_patterns=[MANIFEST_NAME])
            marker = Path(remote_tmp) / MANIFEST_NAME
            if marker.is_file():
                existing = json.loads(marker.read_text(encoding="utf-8"))
                if (
                    existing.get("candidate_id") == route_id
                    and existing.get("source_repo_id") == source_repo
                    and existing.get("modelscope_repo_id") == destination
                    and existing.get("modelscope_weights_revision") == REVISION
                    and existing.get("filename") == filenames[0]
                    and existing.get("mmproj_filename") == filenames[1]
                ):
                    print(f"{route_id}: private ModelScope weights manifest already matches {REVISION}; no external download or replacement needed.", flush=True)
                    return existing
        except Exception as exc:
            print(f"{route_id}: no matching private ModelScope manifest found; preparing first mirror ({type(exc).__name__}).", flush=True)

    # This one-time transfer preserves exact checkpoint bytes; no conversion or requantization occurs.
    from huggingface_hub import hf_hub_download
    with tempfile.TemporaryDirectory(prefix=f"donor-{route_id}-") as temp:
        root = Path(temp)
        file_entries = {}
        for filename in filenames:
            relative = safe_name(filename)
            downloaded = Path(hf_hub_download(repo_id=source_repo, filename=filename, local_dir=str(root / "source")))
            if not downloaded.is_file() or downloaded.stat().st_size < 1_000_000:
                raise RuntimeError(f"Source file is missing or unexpectedly small: {filename}")
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
            "modelscope_repo_id": destination,
            "modelscope_weights_revision": REVISION,
            "filename": filenames[0],
            "mmproj_filename": filenames[1],
            "files": file_entries,
        }
        package = root / "package"
        (package / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            api.create_model(destination, visibility=Visibility.PRIVATE)
            print(f"{route_id}: created private ModelScope repository {destination}.", flush=True)
        except Exception as exc:
            reason = str(exc).lower()
            if not any(word in reason for word in ("exist", "already", "duplicate")):
                raise
            print(f"{route_id}: private ModelScope repository already exists; updating only its pinned candidate files.", flush=True)
        api.push_model(
            model_id=destination,
            model_dir=str(package),
            visibility=Visibility.PRIVATE,
            commit_message=f"Mirror exact {route_id} Q4_K_M checkpoint and projector ({REVISION})",
        )
    with tempfile.TemporaryDirectory(prefix="donor-weights-verify-") as verify_tmp:
        snapshot_download(destination, local_dir=verify_tmp, allow_patterns=[MANIFEST_NAME])
        remote_manifest = json.loads((Path(verify_tmp) / MANIFEST_NAME).read_text(encoding="utf-8"))
        if remote_manifest != manifest:
            raise RuntimeError("Private ModelScope repository verification failed after upload.")
    print(f"{route_id}: private ModelScope mirror verified: {destination}; candidate Studio runtime will use this repository only.", flush=True)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
    mirror_candidate(args.config, token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
