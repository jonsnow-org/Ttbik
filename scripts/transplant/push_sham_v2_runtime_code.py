#!/usr/bin/env python3
"""Publish only Sham v2's signed hot-runtime code to its existing private model repo.

The checkpoint and media weights are intentionally never downloaded or overwritten.
ModelScope's push_model is additive, so only studio_code/ and the small bridge manifest
are updated.  The Studio's deployment workflow restarts the app after this job succeeds.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "novaai2026/sham-v2"
sys.path.insert(0, str(ROOT / "ai-system" / "modelscope-sham"))

import codesign  # noqa: E402
import sync_to_modelscope as sync  # noqa: E402


def updated_manifest(remote: dict[str, Any], code_sig: str) -> dict[str, Any]:
    """Keep model and tokenizer fingerprints unchanged while updating the hot-code signature."""
    if not isinstance(remote, dict) or not isinstance(remote.get("sha"), str) or not remote["sha"].strip():
        raise RuntimeError("The private Sham v2 model repo has no valid bridge_manifest.json; refusing to publish code without a weight fingerprint.")
    manifest = dict(remote)
    manifest["code_sig"] = code_sig
    files = {str(x) for x in (remote.get("files") or []) if isinstance(x, str)}
    files.update({"bridge_manifest.json", "studio_code"})
    manifest["files"] = sorted(files)
    return manifest


def stage_runtime_code(destination: Path, remote: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Stage + sign code exactly as the normal checkpoint bridge does, with no model binaries."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    code_sig = sync.stage_code(destination / "studio_code")
    manifest = updated_manifest(remote, code_sig)
    (destination / "bridge_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return code_sig, manifest


def self_test() -> None:
    """Offline check: the current Qwen3 chat module is signed and weight/media metadata is preserved."""
    old_token = os.environ.get("MODELSCOPE_TOKEN")
    old_signing_key = os.environ.get("SHAM_CODE_SIGNING_KEY")
    os.environ["MODELSCOPE_TOKEN"] = "sham-v2-runtime-code-self-test"
    os.environ.pop("SHAM_CODE_SIGNING_KEY", None)
    try:
        remote = {
            "sha": "unchanged-weight-media-fingerprint",
            "code_sig": "old-signature",
            "ckpt_sha": {"final_merged.pt": "unchanged-checkpoint"},
            "files": ["final_merged.pt", "studio_code", "media"],
        }
        with tempfile.TemporaryDirectory(prefix="sham-v2-code-sync-test-") as temp:
            stage = Path(temp) / "stage"
            signature, manifest = stage_runtime_code(stage, remote)
            code_dir = stage / "studio_code"
            chat = code_dir / "sham_small" / "sham_studio_chat.py"
            assert chat.is_file(), "signed code is missing sham_studio_chat.py"
            assert "SHAM_QWEN3_SYSTEM" in chat.read_text(encoding="utf-8"), "Qwen3 chat-template support was not included in the signed code"
            saved_signature = (code_dir / codesign.SIG_NAME).read_text(encoding="utf-8").strip()
            assert saved_signature == signature
            assert codesign.verify(code_dir, signature, {"MODELSCOPE_API_TOKEN": "sham-v2-runtime-code-self-test"})
            assert manifest["sha"] == remote["sha"], "weight/media fingerprint must not change"
            assert manifest["ckpt_sha"] == remote["ckpt_sha"], "checkpoint fingerprint must not change"
            assert "media" in manifest["files"], "existing media must remain listed"
            assert manifest["code_sig"] == signature
            assert (stage / "bridge_manifest.json").is_file()
        print("Sham v2 signed runtime-code sync self-test OK")
    finally:
        if old_token is None:
            os.environ.pop("MODELSCOPE_TOKEN", None)
        else:
            os.environ["MODELSCOPE_TOKEN"] = old_token
        if old_signing_key is None:
            os.environ.pop("SHAM_CODE_SIGNING_KEY", None)
        else:
            os.environ["SHAM_CODE_SIGNING_KEY"] = old_signing_key


def publish() -> None:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("MODELSCOPE_TOKEN is missing; no ModelScope write was attempted.")
    # Import the optional SDK only for real publishing; --self-test stays offline and lightweight.
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility

    api = HubApi()
    api.login(token)
    remote = sync.remote_manifest(api, MODEL_ID)
    if not remote or not remote.get("sha"):
        raise RuntimeError("Could not read the existing Sham v2 bridge manifest. Refusing to push without preserving the weight fingerprint.")

    with tempfile.TemporaryDirectory(prefix="sham-v2-runtime-code-") as temp:
        stage = Path(temp) / "stage"
        signature, manifest = stage_runtime_code(stage, remote)
        if remote.get("code_sig") == signature:
            print(f"Signed Sham v2 runtime code is already current ({signature[:12]}); weights were not touched.")
            return
        api.push_model(
            model_id=MODEL_ID,
            model_dir=str(stage),
            visibility=Visibility.PRIVATE,
            license="apache-2.0",
            commit_message=f"Sham v2 signed runtime code {signature[:12]}",
        )
        print(
            f"Published signed runtime code only ({signature[:12]}); "
            f"preserved model fingerprint {manifest['sha'][:12]} and checkpoint metadata."
        )


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif not sys.argv[1:]:
        publish()
    else:
        raise SystemExit("Usage: push_sham_v2_runtime_code.py [--self-test]")
