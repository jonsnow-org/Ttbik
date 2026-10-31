"""Stage only the official Realistic Vision fp16 checkpoint, its recommended MSE VAE,
and tiny Diffusers config files in a private ModelScope model repository.

No full Diffusers component weights are copied: this avoids uploading a second,
multi-gigabyte copy of the same checkpoint.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODEL_ID = os.environ.get(
    "PHOTO_MODEL_REPO", "novaai2026/realistic-vision-v6-test-models"
)
SOURCE_MODEL = "SG161222/Realistic_Vision_V6.0_B1_noVAE"
SOURCE_VAE = "stabilityai/sd-vae-ft-mse-original"
CHECKPOINT_NAME = "Realistic_Vision_V6.0_NV_B1_fp16.safetensors"
VAE_NAME = "vae-ft-mse-840000-ema-pruned.safetensors"
ROOT = Path("realistic-vision-v6-package")
CONFIG_ROOT = ROOT / "config"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_config_files() -> None:
    staging = Path("hf-config-staging")
    shutil.rmtree(staging, ignore_errors=True)
    snapshot_download(
        repo_id=SOURCE_MODEL,
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
            raise FileNotFoundError(f"Required config file is missing: {rel}")
        target = CONFIG_ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> None:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("MODELSCOPE_TOKEN is required; no token value is logged.")

    shutil.rmtree(ROOT, ignore_errors=True)
    (ROOT / "checkpoint").mkdir(parents=True)
    (ROOT / "vae").mkdir(parents=True)
    CONFIG_ROOT.mkdir(parents=True)

    print("Downloading the single FP16 checkpoint (about 2.13 GB)...", flush=True)
    checkpoint_source = Path(
        hf_hub_download(repo_id=SOURCE_MODEL, filename=CHECKPOINT_NAME)
    )
    checkpoint_target = ROOT / "checkpoint" / CHECKPOINT_NAME
    shutil.copyfile(checkpoint_source, checkpoint_target)

    print("Downloading the creator-recommended MSE VAE (about 335 MB)...", flush=True)
    vae_source = Path(
        hf_hub_download(repo_id=SOURCE_VAE, filename=VAE_NAME)
    )
    vae_target = ROOT / "vae" / VAE_NAME
    shutil.copyfile(vae_source, vae_target)

    copy_config_files()

    manifest = {
        "model_id": "Realistic Vision V6.0 B1 noVAE FP16",
        "model_source": SOURCE_MODEL,
        "checkpoint_file": f"checkpoint/{CHECKPOINT_NAME}",
        "checkpoint_bytes": checkpoint_target.stat().st_size,
        "checkpoint_sha256": sha256(checkpoint_target),
        "vae_source": SOURCE_VAE,
        "vae_file": f"vae/{VAE_NAME}",
        "vae_bytes": vae_target.stat().st_size,
        "vae_sha256": sha256(vae_target),
        "recommended_vae": VAE_NAME,
        "format": "single-file safetensors; CPU inference loads FP32",
        "license": {
            "checkpoint": "CreativeML OpenRAIL-M",
            "vae": "MIT",
        },
    }
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (ROOT / "README.md").write_text(
        "# Realistic Vision V6.0 isolated visual-test weights\n\n"
        f"- Checkpoint source: https://huggingface.co/{SOURCE_MODEL}\n"
        f"- Checkpoint: {CHECKPOINT_NAME} (FP16, one copy)\n"
        f"- Recommended VAE source: https://huggingface.co/{SOURCE_VAE}\n"
        f"- VAE: {VAE_NAME}\n"
        "- The checkpoint is licensed CreativeML OpenRAIL-M; the VAE is MIT.\n"
        "- This is a private evaluation package, not a production deployment.\n"
        "- Only config files are included alongside the two required weight files; "
        "the duplicate full Diffusers component weights are intentionally excluded.\n",
        encoding="utf-8",
    )

    for path in (checkpoint_target, vae_target):
        print(
            f"verified {path.name}: {path.stat().st_size} bytes sha256={sha256(path)}",
            flush=True,
        )

    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility

    api = HubApi()
    api.login(token)
    try:
        api.create_model(
            MODEL_ID,
            visibility=Visibility.PRIVATE,
            license="openrail",
        )
        print(f"created private ModelScope model repo: {MODEL_ID}", flush=True)
    except Exception as exc:  # repo may already exist from a previous run
        message = str(exc).lower()
        if "exist" not in message and "already" not in message and "duplicate" not in message:
            raise
        print(f"ModelScope model repo already exists; updating same files: {MODEL_ID}", flush=True)

    api.push_model(
        model_id=MODEL_ID,
        model_dir=str(ROOT),
        visibility=Visibility.PRIVATE,
        license="openrail",
        commit_message="Add Realistic Vision V6.0 FP16 checkpoint and recommended MSE VAE",
    )
    print(f"uploaded private photo-test model package: {MODEL_ID}", flush=True)


if __name__ == "__main__":
    main()
