"""Stage the official Umranz SD1.5 Diffusers package on ModelScope."""
from __future__ import annotations
import hashlib, json, os, shutil
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

SOURCE_REPO = "Umranz/SD1.5-Uncensored-Photoreal"
MODEL_REPO = os.environ.get("PHOTO_MODEL_REPO", "novaai2026/umranz-sd15-test-models")
PACKAGE = Path("umranz-modelscope-package")
CACHE = Path("umranz-hf-source-cache")
ALLOW = ["model_index.json","scheduler/*","text_encoder/*","tokenizer/*","unet/*","vae/*"]
REQUIRED = ("model_index.json","scheduler/scheduler_config.json","text_encoder/model.safetensors","tokenizer/tokenizer.json","unet/diffusion_pytorch_model.safetensors","vae/diffusion_pytorch_model.safetensors")
WEIGHTS = {"text_encoder/model.safetensors","unet/diffusion_pytorch_model.safetensors","vae/diffusion_pytorch_model.safetensors"}

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
    if not revision: raise RuntimeError("Could not pin Umranz to an immutable upstream commit.")
    print("UMRANZ_SOURCE_REVISION",revision,flush=True)
    shutil.rmtree(PACKAGE,ignore_errors=True)
    snap=Path(snapshot_download(repo_id=SOURCE_REPO,revision=revision,cache_dir=str(CACHE),allow_patterns=ALLOW,token=hf_token))
    PACKAGE.mkdir(parents=True,exist_ok=True)
    upstream={s.rfilename:s for s in (info.siblings or [])}
    for src in sorted(p for p in snap.rglob("*") if p.is_file()):
        rel=src.relative_to(snap).as_posix()
        dst=PACKAGE/rel; dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst)
    # The source ships tokenizer.json but not CLIP vocab/merges; use the local fast tokenizer.
    model_index=json.loads((PACKAGE/"model_index.json").read_text())
    model_index["tokenizer"]=["transformers","CLIPTokenizerFast"]
    (PACKAGE/"model_index.json").write_text(json.dumps(model_index,indent=2)+"\n")
    tok=PACKAGE/"tokenizer"/"tokenizer_config.json"
    tok_cfg=json.loads(tok.read_text()); tok_cfg["tokenizer_class"]="CLIPTokenizerFast"
    tok.write_text(json.dumps(tok_cfg,indent=2)+"\n")
    files={}
    for path in sorted(p for p in PACKAGE.rglob("*") if p.is_file()):
        rel=path.relative_to(PACKAGE).as_posix(); actual=digest(path)
        sibling=upstream.get(rel); lfs=field(sibling,"lfs") if sibling else None
        upstream_sha=field(lfs,"sha256") if lfs else None
        if rel in WEIGHTS and not upstream_sha: raise RuntimeError("Missing upstream LFS SHA-256: "+rel)
        if upstream_sha and actual.lower()!=str(upstream_sha).lower(): raise RuntimeError("Upstream SHA mismatch: "+rel)
        upstream_size=field(sibling,"size") if sibling else None
        if rel not in {"model_index.json","tokenizer/tokenizer_config.json"} and upstream_size is not None and path.stat().st_size!=int(upstream_size): raise RuntimeError("Upstream byte-size mismatch: "+rel)
        files[rel]={"size_bytes":path.stat().st_size,"sha256":actual}
    missing=[p for p in REQUIRED if p not in files]
    if missing: raise FileNotFoundError("Missing Umranz files: "+", ".join(missing))
    manifest={"schema_version":1,"candidate":"umranz-sd15-uncensored-photoreal","source_repo":SOURCE_REPO,"source_revision":revision,"model_repo":MODEL_REPO,"architecture":"Stable Diffusion 1.5","tokenizer_runtime":"CLIPTokenizerFast from source tokenizer.json","license":"creativeml-openrail-m","device_policy":"CPU 8GB only; no GPU/16GB/fallback","files":files}
    (PACKAGE/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    (PACKAGE/"README.md").write_text("# Umranz SD1.5 isolated verified ModelScope weights\n\nSource: https://huggingface.co/"+SOURCE_REPO+"\nRevision: "+revision+"\nDestination: "+MODEL_REPO+"\nEvery staged file has SHA-256 and byte count in manifest.json.\nCPU 8GB only; no GPU, 16GB, fallback or model substitution.\n")
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api=HubApi(); api.login(ms_token)
    try: api.create_model(MODEL_REPO,visibility=Visibility.PRIVATE,license="openrail")
    except Exception as exc:
        msg=str(exc).lower()
        if not any(x in msg for x in ("exist","already","duplicate")): raise
        print("Updating existing private repo",MODEL_REPO,flush=True)
    api.push_model(model_id=MODEL_REPO,model_dir=str(PACKAGE),visibility=Visibility.PRIVATE,license="openrail",commit_message="Mirror verified Umranz weights "+revision[:12])
    print("UMRANZ_MODEL_PUSH=SUCCESS")
    print("UMRANZ_UNET_SHA256="+files["unet/diffusion_pytorch_model.safetensors"]["sha256"])
    print("UMRANZ_FILES="+str(len(files)))

if __name__=="__main__": main()
