"""Stage exact official Juggernaut XL Ragnarok FP8 checkpoint and local configs."""
from __future__ import annotations
import hashlib, json, os, shutil
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

SOURCE_REPO="Kandoo/Juggernaut-XL-Ragnarok"
MODEL_REPO=os.environ.get("PHOTO_MODEL_REPO","novaai2026/juggernaut-ragnarok-test-models")
CHECKPOINT="juggernautXL_ragnarok_fp8_e4m3fn.safetensors"
PACKAGE=Path("juggernaut-ragnarok-modelscope-package")
CACHE=Path("juggernaut-ragnarok-hf-cache")
ALLOW=[CHECKPOINT,"model_index.json","scheduler/*","tokenizer/*","tokenizer_2/*","text_encoder/config.json","text_encoder_2/config.json","unet/config.json","vae/config.json"]
REQUIRED=(CHECKPOINT,"model_index.json","scheduler/scheduler_config.json","tokenizer/tokenizer.json","tokenizer_2/tokenizer.json","text_encoder/config.json","text_encoder_2/config.json","unet/config.json","vae/config.json")

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def field(obj,name,default=None):
    return obj.get(name,default) if isinstance(obj,dict) else getattr(obj,name,default)

def main():
    ms_token=os.environ.get("MODELSCOPE_TOKEN","").strip()
    if not ms_token: raise RuntimeError("MODELSCOPE_TOKEN is required; never logged.")
    hf_token=os.environ.get("HF_TOKEN","").strip() or None
    hub=HfApi(token=hf_token)
    info=hub.model_info(repo_id=SOURCE_REPO,revision="main",files_metadata=True)
    revision=info.sha
    if not revision: raise RuntimeError("Could not pin Juggernaut to immutable source revision.")
    print("JUGGERNAUT_SOURCE_REVISION",revision,flush=True)
    shutil.rmtree(PACKAGE,ignore_errors=True)
    snap=Path(snapshot_download(repo_id=SOURCE_REPO,revision=revision,cache_dir=str(CACHE),allow_patterns=ALLOW,token=hf_token))
    PACKAGE.mkdir(parents=True,exist_ok=True)
    upstream={s.rfilename:s for s in (info.siblings or [])}
    files={}
    for src in sorted(p for p in snap.rglob("*") if p.is_file()):
        rel=src.relative_to(snap).as_posix(); dst=PACKAGE/rel
        dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst)
        actual=digest(dst); sibling=upstream.get(rel)
        lfs=field(sibling,"lfs") if sibling else None; up_sha=field(lfs,"sha256") if lfs else None
        if rel==CHECKPOINT and not up_sha: raise RuntimeError("Creator FP8 file missing upstream LFS SHA-256.")
        if up_sha and actual.lower()!=str(up_sha).lower(): raise RuntimeError("Upstream SHA mismatch: "+rel)
        size=field(sibling,"size") if sibling else None
        if size is not None and dst.stat().st_size!=int(size): raise RuntimeError("Upstream size mismatch: "+rel)
        files[rel]={"size_bytes":dst.stat().st_size,"sha256":actual}
    missing=[p for p in REQUIRED if p not in files]
    if missing: raise FileNotFoundError("Missing Juggernaut files: "+", ".join(missing))
    if files[CHECKPOINT]["size_bytes"]!=4539473080: raise RuntimeError("Checkpoint is not the exact 4,539,473,080-byte FP8 source file.")
    manifest={"schema_version":1,"candidate":"juggernaut-xl-ragnarok-fp8","source_repo":SOURCE_REPO,"source_revision":revision,"model_repo":MODEL_REPO,"checkpoint":CHECKPOINT,"checkpoint_bytes":files[CHECKPOINT]["size_bytes"],"checkpoint_sha256":files[CHECKPOINT]["sha256"],"precision":"FP8 e4m3fn UNet / FP16 text encoders / FP32 VAE","architecture":"Stable Diffusion XL","license":"creativeml-openrail-m","device_policy":"CPU 8GB only; no GPU/16GB/fallback","files":files}
    (PACKAGE/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    (PACKAGE/"README.md").write_text("# Juggernaut XL Ragnarok FP8 isolated ModelScope package\n\nSource: https://huggingface.co/"+SOURCE_REPO+"\nRevision: "+revision+"\nCheckpoint: "+CHECKPOINT+"\nDestination: "+MODEL_REPO+"\nAll staged files are recorded with SHA-256 in manifest.json.\nCPU 8GB only; no GPU, 16GB or fallback.\n")
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api=HubApi(); api.login(ms_token)
    try: api.create_model(MODEL_REPO,visibility=Visibility.PRIVATE,license="openrail")
    except Exception as exc:
        msg=str(exc).lower()
        if not any(x in msg for x in ("exist","already","duplicate")): raise
        print("Updating existing private repo",MODEL_REPO,flush=True)
    api.push_model(model_id=MODEL_REPO,model_dir=str(PACKAGE),visibility=Visibility.PRIVATE,license="openrail",commit_message="Mirror official Juggernaut FP8 "+revision[:12])
    print("JUGGERNAUT_MODEL_PUSH=SUCCESS")
    print("JUGGERNAUT_CHECKPOINT_SHA256="+files[CHECKPOINT]["sha256"])
    print("JUGGERNAUT_FILES="+str(len(files)))

if __name__=="__main__": main()
