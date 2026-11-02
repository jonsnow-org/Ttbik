"""Dedicated CPU-only Juggernaut XL Ragnarok FP8 image Studio.

This app loads only Kandoo/Juggernaut-XL-Ragnarok's FP8 single-file checkpoint.
No shared candidate runner, no other model weights, no GPU, and no >8GB runtime.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import traceback
from pathlib import Path

import gradio as gr

MODEL_ID = "Kandoo/Juggernaut-XL-Ragnarok"
MODEL_REPO = os.environ.get("PHOTO_MODEL_REPO", "novaai2026/juggernaut-ragnarok-test-models")
CHECKPOINT_NAME = "juggernautXL_ragnarok_fp8_e4m3fn.safetensors"
APP_REVISION = "juggernaut-ragnarok-cpu8g-2026-10-31-r2"
ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "juggernaut_cache"
OUTPUTS = ROOT / "juggernaut_outputs"
RAM_TARGET_GB = 8.0

MINOR = re.compile(r"\b(?:child|children|minor|underage|teen|teenager|schoolgirl|schoolboy|loli|shota)\b|طفل|طفلة|قاصر|قاصرة|مراهق|مراهقة|تلميذ|تلميذة", re.I)
SEXUAL = re.compile(r"\b(?:nude|naked|nudity|sex|sexual|erotic|porn|explicit|undress)\b|عاري|عارية|تعري|جنس|جنسي|إباحي|إباحية", re.I)
NONCONSENSUAL = re.compile(r"\b(?:non[- ]consensual|without consent|revenge porn|deepfake|undress (?:her|him|them))\b|بدون موافقة|دون موافقة|صور حميمة مسربة|تعرية شخص", re.I)
REAL_PERSON = re.compile(r"\b(?:real person|celebrity|public figure|my ex|my wife|my girlfriend|my colleague)\b|شخص حقيقي|مشهور|مشاهير|زوجتي|طليقتي|حبيبتي|زميلتي|زميلي", re.I)


def memory_gb() -> float:
    values = []
    try:
        import psutil
        values.append(float(psutil.virtual_memory().total))
    except Exception:
        pass
    for name in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            raw = Path(name).read_text().strip()
            if raw.isdigit() and int(raw) < (1 << 60):
                values.append(float(int(raw)))
        except Exception:
            pass
    return round(min(values) / (1024 ** 3), 2) if values else 0.0


STATE = {
    "phase": "starting",
    "app_revision": APP_REVISION,
    "candidate": "juggernaut-ragnarok",
    "model_id": MODEL_ID,
    "model_repo": MODEL_REPO,
    "checkpoint": CHECKPOINT_NAME,
    "checkpoint_bytes": 4539473080,
    "device": "CPU only",
    "cuda_used": False,
    "memory_gb": memory_gb(),
    "ram_target_gb": RAM_TARGET_GB,
    "source_precision": "FP8 e4m3fn UNet / FP16 text encoders / FP32 VAE",
    "runtime_precision": "FP16 CPU compute",
    "default_resolution": "512x512",
    "default_steps": 20,
    "default_cfg": 5.0,
    "error": "",
    "load_seconds": None,
}
STATE_LOCK = threading.RLock()
INFER_LOCK = threading.Lock()
PIPE = None
MANIFEST = None


def set_state(**values):
    with STATE_LOCK:
        STATE.update(values)


def status():
    with STATE_LOCK:
        value = dict(STATE)
    value["memory_gb"] = memory_gb()
    return value


def _load_model_package():
    token = (os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("MODELSCOPE_API_TOKEN is not configured in this private Studio.")
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(token)
    CACHE.mkdir(parents=True, exist_ok=True)
    root = Path(snapshot_download(MODEL_REPO, cache_dir=str(CACHE)))
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("ModelScope model manifest is missing; refusing to load unverified FP8 weights.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source_repo") != MODEL_ID or manifest.get("checkpoint") != CHECKPOINT_NAME:
        raise RuntimeError("Unexpected Juggernaut source/checkpoint in the ModelScope manifest.")
    if not manifest.get("source_revision"):
        raise RuntimeError("Pinned upstream revision is missing from the ModelScope manifest.")
    declared = manifest.get("files")
    if not isinstance(declared, dict) or not declared:
        raise RuntimeError("ModelScope manifest has no file SHA-256 inventory.")
    for relative, expected in declared.items():
        rel = Path(relative)
        if rel.is_absolute() or ".." in rel.parts:
            raise RuntimeError("Unsafe path in Juggernaut model manifest.")
        path = root / rel
        if not path.is_file():
            raise FileNotFoundError(f"ModelScope model file is missing: {relative}")
        if path.stat().st_size != int(expected.get("size_bytes", -1)):
            raise RuntimeError(f"File size mismatch for {relative}; refusing to load.")
        h = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                h.update(chunk)
        if h.hexdigest() != expected.get("sha256"):
            raise RuntimeError(f"SHA-256 mismatch for {relative}; refusing to load.")
    required = (
        CHECKPOINT_NAME, "model_index.json", "scheduler/scheduler_config.json",
        "tokenizer/tokenizer.json", "tokenizer_2/tokenizer.json",
        "text_encoder/config.json", "text_encoder_2/config.json", "unet/config.json", "vae/config.json",
    )
    for relative in required:
        if not (root / relative).is_file():
            raise FileNotFoundError(f"Required Juggernaut SDXL config/checkpoint file is absent: {relative}")
    if manifest["files"][CHECKPOINT_NAME]["size_bytes"] != 4539473080:
        raise RuntimeError("FP8 checkpoint size differs from the expected creator file; refusing to load.")
    return root, manifest


def memory_telemetry():
    result = {"memory_limit_gb": memory_gb()}
    try:
        import resource
        result["process_peak_rss_gb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 2), 3)
    except Exception:
        result["process_peak_rss_gb"] = None
    for key, path in (
        ("cgroup_memory_current_gb", "/sys/fs/cgroup/memory.current"),
        ("cgroup_memory_peak_gb", "/sys/fs/cgroup/memory.peak"),
    ):
        try:
            result[key] = round(int(Path(path).read_text().strip()) / (1024 ** 3), 3)
        except Exception:
            result[key] = None
    return result


def load_model():
    global PIPE, MANIFEST
    started = time.monotonic()
    set_state(phase="downloading", error="", model_repo=MODEL_REPO)
    available = memory_gb()
    if available and available > RAM_TARGET_GB + 0.35:
        raise RuntimeError(
            f"This candidate is pinned to the 8 GB CPU profile. Detected {available:.2f} GB; "
            "the test will not silently use a larger-memory Studio."
        )
    if available and available < 6.8:
        raise RuntimeError(f"Only {available:.2f} GB CPU RAM is visible; the 8 GB test profile is not available.")
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    root, manifest = _load_model_package()
    checkpoint = root / CHECKPOINT_NAME
    actual_size = checkpoint.stat().st_size
    checkpoint_sha = manifest["files"][CHECKPOINT_NAME]["sha256"]
    set_state(
        phase="loading", checkpoint_bytes=actual_size, checkpoint_sha256=checkpoint_sha,
        model_repo=MODEL_REPO, source_revision=manifest["source_revision"],
    )
    import torch
    from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler
    if torch.cuda.is_available():
        raise RuntimeError("CUDA remained visible after CPU-only isolation; refusing GPU execution.")
    torch.set_num_threads(2)
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass
    pipe = StableDiffusionXLPipeline.from_single_file(
        str(checkpoint),
        config=str(root),
        torch_dtype=torch.float16,
        use_safetensors=True,
        local_files_only=True,
        low_cpu_mem_usage=True,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="sde-dpmsolver++", use_karras_sigmas=True
    )
    pipe.set_progress_bar_config(disable=True)
    pipe.enable_attention_slicing("max")
    pipe.enable_vae_slicing()
    try:
        pipe.enable_vae_tiling()
    except Exception:
        pass
    pipe.to("cpu")
    PIPE = pipe
    MANIFEST = manifest
    elapsed = round(time.monotonic() - started, 2)
    set_state(
        phase="ready", error="", load_seconds=elapsed, memory_gb=memory_gb(),
        cpu_threads=2, cuda_used=False, checkpoint_bytes=actual_size,
        checkpoint_sha256=checkpoint_sha, model_repo=MODEL_REPO,
        source_revision=manifest["source_revision"], device="CPU only",
    )


def load_worker():
    try:
        load_model()
    except Exception as exc:
        set_state(
            phase="error",
            error=f"{type(exc).__name__}: {exc}"[:1400],
            traceback=traceback.format_exc()[-5000:],
            memory_gb=memory_gb(),
        )


def generate(prompt: str, negative: str, resolution: str, steps: int, cfg: float, seed: int):
    import numpy as np
    import torch

    if STATE.get("phase") != "ready" or PIPE is None:
        raise gr.Error("استديو Juggernaut لم يصبح جاهزاً على CPU 8GB؛ افحص الحالة.")
    prompt = str(prompt or "").strip()
    if len(prompt) < 8 or len(prompt) > 1800:
        raise gr.Error("طول الوصف يجب أن يكون بين 8 و1800 حرف.")
    if MINOR.search(prompt) and SEXUAL.search(prompt):
        raise gr.Error("لا يمكن إنشاء تصوير جنسي لقاصر أو لشخص يبدو قاصراً.")
    if NONCONSENSUAL.search(prompt) and REAL_PERSON.search(prompt):
        raise gr.Error("لا ننشئ صوراً حميمة أو تزييفاً جنسياً لأشخاص حقيقيين دون موافقتهم.")
    sizes = {"512 × 512": (512, 512), "512 × 768": (512, 768)}
    width, height = sizes.get(resolution, (512, 512))
    steps = max(15, min(25, int(steps)))
    cfg = max(3.0, min(8.0, float(cfg)))
    seed = int(seed)

    if not INFER_LOCK.acquire(blocking=False):
        raise gr.Error("توجد صورة أخرى قيد التوليد على CPU؛ انتظر.")
    set_state(phase="generating", last_prompt=prompt[:180])
    started = time.monotonic()
    try:
        generator = torch.Generator(device="cpu").manual_seed(seed)
        with torch.inference_mode():
            image = PIPE(
                prompt=prompt,
                negative_prompt=str(negative or "")[:1800],
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=generator,
            ).images[0].convert("RGB")
        gray = np.asarray(image, dtype=np.float32).mean(axis=2)
        stats = {"gray_std": round(float(gray.std()), 2), "gray_range": round(float(gray.max()-gray.min()), 2)}
        if stats["gray_std"] < 8 or stats["gray_range"] < 24:
            raise gr.Error("الناتج شبه فارغ؛ لم يُعتمد.")
        OUTPUTS.mkdir(parents=True, exist_ok=True)
        path = OUTPUTS / f"juggernaut-ragnarok-{seed}-{int(time.time())}.png"
        image.save(path, format="PNG", optimize=True)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        elapsed = round(time.monotonic() - started, 2)
        meta = {
            "result": "image_generated",
            "candidate": "juggernaut-ragnarok",
            "model": MODEL_ID,
            "model_repo": MODEL_REPO,
            "source_revision": MANIFEST["source_revision"],
            "checkpoint_sha256": MANIFEST["files"][CHECKPOINT_NAME]["sha256"],
            **memory_telemetry(),
            "checkpoint": CHECKPOINT_NAME,
            "app_revision": APP_REVISION,
            "source_precision": "FP8 e4m3fn UNet / FP16 text encoders / FP32 VAE",
            "runtime_precision": "FP16 CPU compute",
            "device": "CPU only",
            "cuda_used": False,
            "resolution": f"{width}x{height}",
            "steps": steps,
            "cfg": cfg,
            "seed": seed,
            "seconds": elapsed,
            "memory_gb": memory_gb(),
            "image_sha256": digest,
            "basic_image_checks": stats,
            "saved_file": str(path),
            "production_routes_modified": False,
            "visual_review_required": True,
        }
        set_state(phase="ready", last_generation_seconds=elapsed, last_result=str(path), last_image_checks=stats, memory_gb=memory_gb())
        return image, meta
    except gr.Error:
        set_state(phase="ready")
        raise
    except Exception as exc:
        set_state(phase="ready", last_generation_error=f"{type(exc).__name__}: {exc}"[:800], memory_gb=memory_gb())
        raise gr.Error(f"فشل توليد Juggernaut على CPU 8GB: {type(exc).__name__}: {exc}") from exc
    finally:
        INFER_LOCK.release()


with gr.Blocks(title="Juggernaut XL Ragnarok FP8 — dedicated CPU 8GB") as demo:
    gr.Markdown("# Juggernaut XL Ragnarok FP8 — استديو مستقل\nCPU فقط · حد الذاكرة 8GB · لا GPU ولا ترقية إلى 16GB.")
    state_box = gr.JSON(label="حالة تحميل FP8", value=status())
    gr.Button("تحديث الحالة").click(status, inputs=[], outputs=state_box, api_name="status")
    prompt_box = gr.Textbox(label="وصف الصورة", lines=5)
    negative_box = gr.Textbox(label="Negative prompt", value="cartoon, illustration, cgi, deformed, blurry, watermark, text", lines=3)
    with gr.Row():
        resolution_box = gr.Dropdown(["512 × 512", "512 × 768"], value="512 × 512", label="الدقة (مخفضة لاختبار 8GB)")
        steps_box = gr.Slider(15, 25, value=20, step=1, label="Steps")
        cfg_box = gr.Slider(3, 8, value=5.0, step=0.5, label="CFG")
        seed_box = gr.Number(value=42, precision=0, label="Seed")
    button = gr.Button("توليد صورة Juggernaut", variant="primary")
    image_box = gr.Image(type="pil", label="الناتج")
    metadata_box = gr.JSON(label="بيانات الاختبار")
    button.click(generate, inputs=[prompt_box, negative_box, resolution_box, steps_box, cfg_box, seed_box], outputs=[image_box, metadata_box], api_name="image")

threading.Thread(target=load_worker, name="juggernaut-loader", daemon=True).start()
demo.queue(default_concurrency_limit=1, max_size=2)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
