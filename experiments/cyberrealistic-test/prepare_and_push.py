"""Stage the creator-published CyberRealistic FINAL FP16 checkpoint.

The checkpoint includes its own baked VAE. No Realistic Vision weights or external
VAE are copied into this package. The published creator SHA-256 is enforced before
the package can be pushed to a private ModelScope repo.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODEL_ID = os.environ.get("PHOTO_MODEL_REPO", "novaai2026/cyberrealistic-final-test-models")
SOURCE_MODEL = "cyberdelia/CyberRealistic"
CONFIG_SOURCE = "SG161222/Realistic_Vision_V6.0_B1_noVAE"
CHECKPOINT_NAME = "CyberRealistic_FINAL_FP16.safetensors"
EXPECTED_SHA256 = "2209c07b331a06cb28cf7c830ec758ae5b49eb97fab21f5de6b18c7be8b41554"
ROOT = Path("cyberrealistic-final-package")
CONFIG_ROOT = ROOT / "config"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_architecture_configs() -> None:
    staging = Path("sd15-config-staging")
    shutil.rmtree(staging, ignore_errors=True)
    snapshot_download(
        repo_id=CONFIG_SOURCE,
        local_dir=str(staging),
        allow_patterns=[
            "model_index.json",
            "scheduler/scheduler_config.json",
            "tokenizer/*",
            "text_encoder/config.json",
            "unet/config.json",
            "vae/config.json",
        ],
    )
    for rel in (
        "model_index.json",
        "scheduler/scheduler_config.json",
        "tokenizer/merges.txt",
        "tokenizer/special_tokens_map.json",
        "tokenizer/tokenizer_config.json",
        "tokenizer/vocab.json",
        "text_encoder/config.json",
        "unet/config.json",
        "vae/config.json",
    ):
        source = staging / rel
        if not source.is_file():
            raise FileNotFoundError(f"Required SD 1.5 config is missing: {rel}")
        target = CONFIG_ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> None:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("MODELSCOPE_TOKEN is required; no token value is logged.")

    shutil.rmtree(ROOT, ignore_errors=True)
    checkpoint_dir = ROOT / "checkpoint"
    checkpoint_dir.mkdir(parents=True)
    CONFIG_ROOT.mkdir(parents=True)

    print("Downloading creator-published CyberRealistic FINAL FP16 checkpoint...", flush=True)
    source = Path(hf_hub_download(repo_id=SOURCE_MODEL, filename=CHECKPOINT_NAME))
    target = checkpoint_dir / CHECKPOINT_NAME
    shutil.copyfile(source, target)

    actual = sha256(target)
    print(f"CyberRealistic checkpoint: {target.stat().st_size} bytes sha256={actual}", flush=True)
    if actual.lower() != EXPECTED_SHA256:
        raise RuntimeError("Creator SHA-256 mismatch. Refusing to stage an unverified or different file.")

    print("Verified exact creator SHA-256; staging SD 1.5 architecture configs...", flush=True)
    copy_architecture_configs()

    manifest = {
        "model_id": "CyberRealistic FINAL FP16",
        "model_source": SOURCE_MODEL,
        "checkpoint_file": f"checkpoint/{CHECKPOINT_NAME}",
        "checkpoint_bytes": target.stat().st_size,
        "checkpoint_sha256": actual,
        "creator_published_sha256": EXPECTED_SHA256,
        "config_source": CONFIG_SOURCE,
        "architecture": "Stable Diffusion 1.5",
        "vae": "baked into the creator checkpoint; no external VAE attached",
        "format": "single-file FP16 safetensors; loaded as FP32 for CPU inference",
        "license": "CreativeML OpenRAIL-M",
        "sampler": "DPM++ SDE Karras",
        "recommended_steps": 30,
        "recommended_cfg": 5.0,
        "recommended_resolution": "512x768",
    }
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (ROOT / "README.md").write_text(
        "# CyberRealistic FINAL FP16 — isolated human-photography evaluation\n\n"
        f"- Creator checkpoint: https://huggingface.co/{SOURCE_MODEL}\n"
        f"- Exact file: {CHECKPOINT_NAME}\n"
        "- Creator's official model notes and SHA-256: https://cyberdelia.nl/models/cyberrealistic-sd-1-5\n"
        f"- SHA-256: {actual}\n"
        "- Architecture: Stable Diffusion 1.5\n"
        "- VAE: baked into the checkpoint; no separate VAE is added\n"
        "- License: CreativeML OpenRAIL-M\n"
        "- Test-only package; separate from Realistic Vision and production media routes\n",
        encoding="utf-8",
    )

    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility

    api = HubApi()
    api.login(token)
    try:
        api.create_model(MODEL_ID, visibility=Visibility.PRIVATE, license="openrail")
        print(f"Created private ModelScope model repo: {MODEL_ID}", flush=True)
    except Exception as exc:
        message = str(exc).lower()
        if not any(word in message for word in ("exist", "already", "duplicate")):
            raise
        print(f"Private ModelScope model repo already exists; updating: {MODEL_ID}", flush=True)

    api.push_model(
        model_id=MODEL_ID,
        model_dir=str(ROOT),
        visibility=Visibility.PRIVATE,
        license="openrail",
        commit_message="Add verified CyberRealistic FINAL FP16 checkpoint (baked VAE)",
    )
    print(f"Uploaded separate private CyberRealistic package: {MODEL_ID}", flush=True)


if __name__ == "__main__":
    main()
