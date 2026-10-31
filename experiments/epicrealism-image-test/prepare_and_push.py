"""Mirror official epiCRealism Diffusers weights into a private ModelScope model repo."""
from __future__ import annotations
import hashlib,json,os,shutil
from pathlib import Path
from huggingface_hub import HfApi,snapshot_download

SOURCE_REPO="emilianJR/epiCRealism"
MODEL_REPO=os.environ.get("PHOTO_MODEL_REPO","novaai2026/epicrealism-image-test-models")
PACKAGE=Path("epicrealism-modelscope-package")
CACHE=Path("epicrealism-hf-cache")
ALLOW=["model_index.json","scheduler/*","text_encoder/*","tokenizer/*","unet/config.json","unet/diffusion_pytorch_model.safetensors","vae/config.json","vae/diffusion_pytorch_model.safetensors"]
REQUIRED=("model_index.json","scheduler/scheduler_config.json","text_encoder/config.json","text_encoder/model.safetensors","tokenizer/vocab.json","tokenizer/merges.txt","tokenizer/tokenizer_config.json","unet/config.json","unet/diffusion_pytorch_model.safetensors","vae/config.json","vae/diffusion_pytorch_model.safetensors")
WEIGHTS={"text_encoder/model.safetensors","unet/diffusion_pytorch_model.safetensors","vae/diffusion_pytorch_model.safetensors"}

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def field(obj,name,default=None):
    return obj.get(name,default) if isinstance(obj,dict) else getattr(obj,name,default)

def main():
    ms_token=os.environ.get("MODELSCOPE_TOKEN","").strip()
    if not ms_token: raise RuntimeError("MODELSCOPE_TOKEN is required.")
    hf_token=os.environ.get("HF_TOKEN","").strip() or None
    hub=HfApi(token=hf_token)
    info=hub.model_info(repo_id=SOURCE_REPO,revision="main",files_metadata=True)
    revision=info.sha
    if not revision: raise RuntimeError("Could not pin epiCRealism source revision.")
    print("EPICREALISM_SOURCE_REVISION",revision,flush=True)
    shutil.rmtree(PACKAGE,ignore_errors=True)
    snap=Path(snapshot_download(repo_id=SOURCE_REPO,revision=revision,cache_dir=str(CACHE),allow_patterns=ALLOW,token=hf_token))
    PACKAGE.mkdir(parents=True,exist_ok=True)
    upstream={item.rfilename:item for item in (info.siblings or [])}
    for src in sorted(p for p in snap.rglob("*") if p.is_file()):
        rel=src.relative_to(snap).as_posix()
        dst=PACKAGE/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(src,dst)
    index_path=PACKAGE/"model_index.json"
    index=json.loads(index_path.read_text(encoding="utf-8"))
    index["safety_checker"]=[None,None]
    index["feature_extractor"]=[None,None]
    index["requires_safety_checker"]=False
    index_path.write_text(json.dumps(index,indent=2)+"\n",encoding="utf-8")
    files={}
    for path in sorted(p for p in PACKAGE.rglob("*") if p.is_file()):
        rel=path.relative_to(PACKAGE).as_posix()
        actual=digest(path)
        sibling=upstream.get(rel)
        lfs=field(sibling,"lfs") if sibling else None
        source_sha=field(lfs,"sha256") if lfs else None
        if rel in WEIGHTS and not source_sha: raise RuntimeError("Missing upstream LFS SHA-256 for "+rel)
        if source_sha and actual.lower()!=str(source_sha).lower(): raise RuntimeError("Upstream SHA-256 mismatch: "+rel)
        size=field(sibling,"size") if sibling else None
        if rel!="model_index.json" and size is not None and path.stat().st_size!=int(size): raise RuntimeError("Source byte-size mismatch: "+rel)
        files[rel]={"size_bytes":path.stat().st_size,"sha256":actual}
    missing=[name for name in REQUIRED if name not in files]
    if missing: raise FileNotFoundError("Missing epiCRealism files: "+", ".join(missing))
    manifest={"schema_version":1,"candidate":"epicrealism-sd15","source_repo":SOURCE_REPO,"source_revision":revision,
              "model_repo":MODEL_REPO,"architecture":"Stable Diffusion 1.5","license":"creativeml-openrail-m",
              "safety_checker":"separate upstream component omitted from the image pipeline",
              "device_policy":"CPU 8GB only; no GPU/16GB/fallback","files":files}
    (PACKAGE/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    (PACKAGE/"README.md").write_text(
        "# epiCRealism isolated ModelScope package\n\nSource: https://huggingface.co/"+SOURCE_REPO+
        "\nPinned revision: "+revision+"\nPrivate model repo: "+MODEL_REPO+
        "\nEvery included file has SHA-256 and byte size in manifest.json.\n"
        "The separate Diffusers safety-checker files are omitted; platform safeguards remain active.\nCPU 8GB only.\n",
        encoding="utf-8")
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api=HubApi(); api.login(ms_token)
    try: api.create_model(MODEL_REPO,visibility=Visibility.PRIVATE,license="openrail")
    except Exception as exc:
        msg=str(exc).lower()
        if not any(x in msg for x in ("exist","already","duplicate")): raise
        print("Updating existing private model repo",MODEL_REPO,flush=True)
    api.push_model(model_id=MODEL_REPO,model_dir=str(PACKAGE),visibility=Visibility.PRIVATE,license="openrail",
                   commit_message="Mirror verified epiCRealism "+revision[:12])
    print("EPICREALISM_MODEL_PUSH=SUCCESS")
    print("EPICREALISM_UNET_SHA256="+files["unet/diffusion_pytorch_model.safetensors"]["sha256"])
    print("EPICREALISM_FILES="+str(len(files)))

if __name__=="__main__": main()
