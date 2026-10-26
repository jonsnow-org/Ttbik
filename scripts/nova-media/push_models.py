"""Copy the media models into a public ModelScope (a Studio cannot read a private one; these are open models) model repo (the media Studio can reach modelscope.cn only).
  sdxs/   IDKiro/sdxs-512-dreamshaper  (diffusers layout; OpenRAIL++ as published by its author)
  piper/  rhasspy/piper-voices  ar/ar_JO/kareem/medium  (MIT repository; the voice dataset's own terms are the owner's to check)
Never prints the token."""
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODEL_ID = os.environ.get("MEDIA_MODEL_REPO", "novaai2026/nova-media-models")
work = Path("media-models")
shutil.rmtree(work, ignore_errors=True)
(work / "piper").mkdir(parents=True)
sd = snapshot_download("IDKiro/sdxs-512-dreamshaper", local_dir=str(work / "sdxs"), allow_patterns=["*.json", "*.txt", "*.safetensors", "tokenizer/*", "unet/*", "text_encoder/*", "vae/*", "scheduler/*"],
                       ignore_patterns=["*.ckpt", "*.bin", "*fp32*", ".git*"])
for f in ("ar_JO-kareem-medium.onnx", "ar_JO-kareem-medium.onnx.json"):
    p = hf_hub_download("rhasspy/piper-voices", f"ar/ar_JO/kareem/medium/{f}")
    shutil.copy(p, work / "piper" / f)
for p in sorted(work.rglob("*")):
    if p.is_file():
        print(f"{p.relative_to(work)}  {p.stat().st_size / 1e6:.1f} MB")
from modelscope.hub.api import HubApi
from modelscope.hub.constants import Visibility

api = HubApi()
api.login(os.environ["MODELSCOPE_TOKEN"])
for lic in ("openrail", "apache-2.0"):
    try:
        api.push_model(model_id=MODEL_ID, model_dir=str(work), visibility=Visibility.PUBLIC, license=lic, commit_message="nova media models (sdxs, piper ar)")
        print(f"pushed {MODEL_ID} (license tag {lic})")
        break
    except Exception as e:                                               # noqa: BLE001
        print(f"push with license {lic} failed: {type(e).__name__}: {str(e)[:200]}")
        if lic == "apache-2.0":
            sys.exit(1)
