"""Dedicated CPU-only epiCRealism image-generation Studio."""
from __future__ import annotations
import hashlib,json,os,re,threading,time,traceback
from pathlib import Path
import gradio as gr
MODEL_ID="emilianJR/epiCRealism"
MODEL_REPO=os.environ.get("PHOTO_MODEL_REPO","novaai2026/epicrealism-image-test-models")
APP_REVISION="epicrealism-image-test-2026-10-31-r1"
ROOT=Path(__file__).resolve().parent
CACHE=ROOT/"epicrealism-model-cache"
OUTPUTS=ROOT/"epicrealism-outputs"
MAX_MEMORY_GB=8.0
MINOR=re.compile(r"\b(?:child|children|minor|underage|teen|teenager|schoolgirl|schoolboy|loli|shota)\b|طفل|طفلة|قاصر|قاصرة|مراهق|مراهقة|تلميذ|تلميذة",re.I)
SEXUAL=re.compile(r"\b(?:nude|naked|nudity|sex|sexual|erotic|porn|explicit|undress)\b|عاري|عارية|تعري|جنس|جنسي|إباحي|إباحية",re.I)
NONCONSENSUAL=re.compile(r"\b(?:non[- ]consensual|without consent|revenge porn|deepfake|undress (?:her|him|them))\b|بدون موافقة|دون موافقة|صور حميمة مسربة|تعرية شخص",re.I)
REAL_PERSON=re.compile(r"\b(?:real person|celebrity|public figure|my ex|my wife|my girlfriend|my colleague)\b|شخص حقيقي|مشهور|مشاهير|زوجتي|طليقتي|حبيبتي|زميلتي|زميلي",re.I)


def _cpu_has_bf16() -> bool:
    """bfloat16 maths is fast only on CPUs with AVX512-BF16 / AMX (the Xeon Studios have both). PHOTO_FAST=0 turns the fast path off."""
    if os.environ.get("PHOTO_FAST", "1") == "0":
        return False
    try:
        flags = open("/proc/cpuinfo", encoding="utf-8", errors="ignore").read()
        return "amx_bf16" in flags or "avx512_bf16" in flags
    except Exception:
        return False


FAST = _cpu_has_bf16()


def _fast_ok(pipe) -> bool:
    """One tiny bf16 generation at load time: the fast path stays on only if it gives a real picture (no NaN / blank); otherwise the proven fp32 path is used."""
    if not FAST:
        return False
    try:
        import torch as _t
        import numpy as _np
        with _t.inference_mode(), _t.autocast("cpu", dtype=_t.bfloat16):
            img = pipe("a red apple on a wooden table, photo", num_inference_steps=3, width=256, height=256,
                       generator=_t.Generator(device="cpu").manual_seed(1)).images[0]
        return float(_np.asarray(img.convert("RGB"), dtype=_np.float32).std()) > 5.0
    except Exception:
        return False


def memory_gb():
    vals=[]
    try:
        import psutil
        vals.append(float(psutil.virtual_memory().total))
    except Exception: pass
    for name in ("/sys/fs/cgroup/memory.max","/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            raw=Path(name).read_text().strip()
            if raw.isdigit() and int(raw)<(1<<60): vals.append(float(raw))
        except Exception: pass
    return round(min(vals)/(1024**3),2) if vals else 0.0

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def memory_telemetry():
    result={"memory_limit_gb":memory_gb()}
    try:
        import resource
        result["process_peak_rss_gb"]=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024**2),3)
    except Exception: result["process_peak_rss_gb"]=None
    for key,path in (("cgroup_memory_current_gb","/sys/fs/cgroup/memory.current"),("cgroup_memory_peak_gb","/sys/fs/cgroup/memory.peak")):
        try: result[key]=round(int(Path(path).read_text().strip())/(1024**3),3)
        except Exception: result[key]=None
    return result

STATE={"phase":"starting","app_revision":APP_REVISION,"candidate":"epicrealism","model_id":MODEL_ID,
       "model_repo":MODEL_REPO,"device":"CPU only","cuda_available":False,"memory_gb":memory_gb(),
       "precision":"float32","safety_checker":"separate component omitted from this image pipeline",
       "default_resolution":"512x768","default_steps":30,"default_cfg":7.0,"error":"","load_seconds":None}
STATE_LOCK=threading.RLock()
INFER_LOCK=threading.Lock()
PIPE=None
MANIFEST=None

def set_state(**values):
    with STATE_LOCK: STATE.update(values)

def status():
    with STATE_LOCK: value=dict(STATE)
    value["memory_gb"]=memory_gb()
    return value

def load_package():
    token=(os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token: raise RuntimeError("MODELSCOPE_API_TOKEN is not configured.")
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    api=HubApi(); api.login(token)
    CACHE.mkdir(parents=True,exist_ok=True)
    root=Path(snapshot_download(MODEL_REPO,cache_dir=str(CACHE)))
    mf=root/"manifest.json"
    if not mf.is_file(): raise FileNotFoundError("Private ModelScope manifest missing.")
    manifest=json.loads(mf.read_text(encoding="utf-8"))
    if manifest.get("source_repo")!=MODEL_ID or manifest.get("model_repo")!=MODEL_REPO or not manifest.get("source_revision"):
        raise RuntimeError("Source/model repository identity mismatch.")
    declared=manifest.get("files")
    if not isinstance(declared,dict) or not declared: raise RuntimeError("Empty SHA-256 manifest.")
    for relative,expected in declared.items():
        rel=Path(relative)
        if rel.is_absolute() or ".." in rel.parts: raise RuntimeError("Unsafe manifest path.")
        path=root/rel
        if not path.is_file(): raise FileNotFoundError("Missing model file: "+relative)
        if path.stat().st_size!=int(expected.get("size_bytes",-1)): raise RuntimeError("Size mismatch: "+relative)
        if sha256(path)!=expected.get("sha256"): raise RuntimeError("SHA-256 mismatch: "+relative)
    required=("model_index.json","scheduler/scheduler_config.json","text_encoder/config.json",
              "text_encoder/model.safetensors","tokenizer/vocab.json","tokenizer/merges.txt",
              "tokenizer/tokenizer_config.json","unet/config.json","unet/diffusion_pytorch_model.safetensors",
              "vae/config.json","vae/diffusion_pytorch_model.safetensors")
    for item in required:
        if not (root/item).is_file(): raise FileNotFoundError("Required pipeline file missing: "+item)
    return root,manifest

def load_model():
    global PIPE,MANIFEST
    started=time.monotonic()
    set_state(phase="downloading",error="",model_repo=MODEL_REPO)
    ram=memory_gb()
    if ram and ram>MAX_MEMORY_GB+0.35: raise RuntimeError(f"Expected CPU 8GB, detected {ram:.2f} GB.")
    if ram and ram<6.8: raise RuntimeError(f"CPU memory below 8GB profile: {ram:.2f} GB.")
    os.environ["CUDA_VISIBLE_DEVICES"]=""
    os.environ["HF_HUB_OFFLINE"]="1"
    os.environ["TRANSFORMERS_OFFLINE"]="1"
    root,manifest=load_package()
    set_state(phase="verifying",source_revision=manifest["source_revision"],
              model_file_sha256={k:v["sha256"] for k,v in manifest["files"].items()})
    import torch
    from diffusers import StableDiffusionPipeline,DPMSolverMultistepScheduler
    if torch.cuda.is_available(): raise RuntimeError("CUDA visible; refusing GPU execution.")
    torch.set_num_threads(2)
    try: torch.backends.mkldnn.enabled=True
    except Exception: pass
    pipe=StableDiffusionPipeline.from_pretrained(
        str(root),torch_dtype=torch.float32,use_safetensors=True,low_cpu_mem_usage=True,
        local_files_only=True,safety_checker=None,feature_extractor=None)
    pipe.scheduler=DPMSolverMultistepScheduler.from_config(pipe.scheduler.config,algorithm_type="dpmsolver++",use_karras_sigmas=True)
    pipe.set_progress_bar_config(disable=True)
    global FAST
    FAST = FAST and _fast_ok(pipe)
    if not FAST:
        pipe.enable_attention_slicing("max")      # memory-safe but slow; the fast path uses the fused attention
    pipe.enable_vae_slicing()
    try: pipe.enable_vae_tiling()
    except Exception: pass
    pipe.to("cpu")
    PIPE=pipe; MANIFEST=manifest
    set_state(phase="ready",error="",load_seconds=round(time.monotonic()-started,2),memory_gb=memory_gb(),
              cpu_threads=2,model_repo=MODEL_REPO,source_revision=manifest["source_revision"],
              model_file_sha256={k:v["sha256"] for k,v in manifest["files"].items()},
              checkpoint_sha256=manifest["files"]["unet/diffusion_pytorch_model.safetensors"]["sha256"],
              device="CPU only",cuda_available=False)

def load_worker():
    try: load_model()
    except Exception as exc:
        set_state(phase="error",error=f"{type(exc).__name__}: {exc}"[:1200],
                  traceback=traceback.format_exc()[-4500:],memory_gb=memory_gb())

def generate(prompt,negative,resolution,steps,cfg,seed):
    import numpy as np
    import torch
    if STATE.get("phase")!="ready" or PIPE is None: raise gr.Error("epiCRealism Studio is not ready.")
    prompt=str(prompt or "").strip()
    if len(prompt)<8 or len(prompt)>1800: raise gr.Error("Prompt must be between 8 and 1800 characters.")
    if MINOR.search(prompt) and SEXUAL.search(prompt): raise gr.Error("Sexual depiction of minors is not allowed.")
    if NONCONSENSUAL.search(prompt) and REAL_PERSON.search(prompt): raise gr.Error("Non-consensual intimate imagery of real people is not allowed.")
    sizes={"512 × 512":(512,512),"512 × 768":(512,768),"768 × 512":(768,512)}
    width,height=sizes.get(resolution,(512,768))
    steps=max(18,min(35,int(steps))); cfg=max(3.0,min(9.0,float(cfg))); seed=int(seed)
    if not INFER_LOCK.acquire(blocking=False): raise gr.Error("Another image is running on this CPU Studio.")
    set_state(phase="generating",last_prompt=prompt[:180])
    started=time.monotonic()
    try:
        gen=torch.Generator(device="cpu").manual_seed(seed)
        with torch.inference_mode(), torch.autocast("cpu", dtype=torch.bfloat16, enabled=FAST):
            image=PIPE(prompt=prompt,negative_prompt=str(negative or "")[:1800],width=width,height=height,
                       num_inference_steps=steps,guidance_scale=cfg,generator=gen).images[0].convert("RGB")
        gray=np.asarray(image,dtype=np.float32).mean(axis=2)
        stats={"gray_std":round(float(gray.std()),2),"gray_range":round(float(gray.max()-gray.min()),2)}
        if stats["gray_std"]<8 or stats["gray_range"]<24: raise gr.Error("The output was blank or near-constant.")
        OUTPUTS.mkdir(parents=True,exist_ok=True)
        out=OUTPUTS/f"epicrealism-{seed}-{int(time.time())}.png"
        image.save(out,format="PNG",optimize=True)
        elapsed=round(time.monotonic()-started,2)
        meta={"result":"image_generated","candidate":"epicrealism","model":MODEL_ID,"model_repo":MODEL_REPO,
              "source_revision":MANIFEST["source_revision"],
              "checkpoint_sha256":MANIFEST["files"]["unet/diffusion_pytorch_model.safetensors"]["sha256"],
              "model_file_sha256":{k:v["sha256"] for k,v in MANIFEST["files"].items()},
              **memory_telemetry(),"app_revision":APP_REVISION,"device":"CPU only","cuda_available":False,
              "precision":"float32","safety_checker":"separate safety-checker omitted; platform safeguards remain active",
              "resolution":f"{width}x{height}","steps":steps,"cfg":cfg,"seed":seed,"seconds":elapsed,
              "image_sha256":sha256(out),"basic_image_checks":stats,"saved_file":str(out),
              "production_routes_modified":False,"visual_review_required":True}
        set_state(phase="ready",last_generation_seconds=elapsed,last_result=str(out),last_image_checks=stats,memory_gb=memory_gb())
        return image,meta
    except gr.Error:
        set_state(phase="ready")
        raise
    except Exception as exc:
        set_state(phase="ready",last_generation_error=f"{type(exc).__name__}: {exc}"[:700],memory_gb=memory_gb())
        raise gr.Error(f"epiCRealism failed: {type(exc).__name__}: {exc}") from exc
    finally: INFER_LOCK.release()

with gr.Blocks(title="epiCRealism — dedicated CPU 8GB photo Studio") as demo:
    gr.Markdown("# epiCRealism — independent photorealistic image test\nCPU only · 8GB · private weights and isolated outputs.")
    state=gr.JSON(label="Model status",value=status())
    gr.Button("Refresh status").click(status,inputs=[],outputs=state,api_name="status")
    prompt=gr.Textbox(label="Prompt",lines=5)
    negative=gr.Textbox(label="Negative prompt",value="cartoon, anime, illustration, cgi, plastic skin, deformed hands, extra fingers, blurry, watermark, text",lines=3)
    with gr.Row():
        resolution=gr.Dropdown(["512 × 512","512 × 768","768 × 512"],value="512 × 768",label="Resolution")
        steps=gr.Slider(18,35,value=24,step=1,label="Steps")
        cfg=gr.Slider(3,9,value=7,step=0.5,label="CFG")
        seed=gr.Number(value=42,precision=0,label="Seed")
    button=gr.Button("Generate epiCRealism image",variant="primary")
    image=gr.Image(type="pil",label="Output")
    metadata=gr.JSON(label="Test metadata")
    button.click(generate,inputs=[prompt,negative,resolution,steps,cfg,seed],outputs=[image,metadata],api_name="image")
threading.Thread(target=load_worker,name="epicrealism-loader",daemon=True).start()
demo.queue(default_concurrency_limit=1,max_size=2)
demo.launch(server_name="0.0.0.0",server_port=int(os.environ.get("PORT","7860")))
