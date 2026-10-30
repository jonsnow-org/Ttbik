"""Dedicated CPU-only Umranz image-generation Studio.

This process downloads and loads only Umranz/SD1.5-Uncensored-Photoreal.
It has its own cache, Gradio API, process state, and output directory.
It never imports another candidate's app or weights.
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

MODEL_ID = "Umranz/SD1.5-Uncensored-Photoreal"
APP_REVISION = "umranz-image-test-2026-10-31-r1"
ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "umranz_model_cache"
OUTPUTS = ROOT / "umranz_outputs"
MAX_MEMORY_GB = 8.0

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
    "candidate": "umranz",
    "model_id": MODEL_ID,
    "device": "CPU only",
    "cuda_available": False,
    "memory_gb": memory_gb(),
    "precision": "float32",
    "default_resolution": "512x512",
    "default_steps": 30,
    "default_cfg": 6.5,
    "error": "",
    "load_seconds": None,
}
LOCK = threading.RLock()
INFER_LOCK = threading.Lock()
PIPE = None


def set_state(**values):
    with LOCK:
        STATE.update(values)


def status():
    with LOCK:
        value = dict(STATE)
    value["memory_gb"] = memory_gb()
    return value


def load_model():
    global PIPE
    started = time.monotonic()
    set_state(phase="downloading", error="")
    available = memory_gb()
    if available and available > MAX_MEMORY_GB + 0.5:
        # Do not silently migrate this candidate to a larger-memory runtime.
        raise RuntimeError(f"Expected the configured 8 GB CPU Studio, detected {available:.2f} GB.")
    if os.environ.get("CUDA_VISIBLE_DEVICES", ""):
        raise RuntimeError("This candidate must run on CPU; CUDA_VISIBLE_DEVICES must be empty.")

    from huggingface_hub import snapshot_download
    from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
    import torch

    torch.set_num_threads(2)
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass

    model_dir = snapshot_download(
        repo_id=MODEL_ID,
        revision="main",
        cache_dir=str(CACHE),
        allow_patterns=[
            "model_index.json", "*.json", "*.safetensors", "*.txt", "*.model", "*.bin",
            "scheduler/*", "text_encoder/*", "tokenizer/*", "unet/*", "vae/*",
        ],
    )
    set_state(phase="loading", download_complete=True)
    pipe = StableDiffusionPipeline.from_pretrained(
        model_dir,
        torch_dtype=torch.float32,
        use_safetensors=True,
        low_cpu_mem_usage=True,
        safety_checker=None,
        feature_extractor=None,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config,
        algorithm_type="dpmsolver++",
        use_karras_sigmas=True,
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
    set_state(
        phase="ready",
        error="",
        load_seconds=round(time.monotonic() - started, 2),
        memory_gb=memory_gb(),
        cpu_threads=2,
    )


def load_worker():
    try:
        load_model()
    except Exception as exc:
        set_state(phase="error", error=f"{type(exc).__name__}: {exc}"[:1200], traceback=traceback.format_exc()[-4000:])


def generate(prompt: str, negative: str, resolution: str, steps: int, cfg: float, seed: int):
    import numpy as np
    import torch

    if STATE.get("phase") != "ready" or PIPE is None:
        raise gr.Error("استديو Umranz لم يصبح جاهزاً بعد؛ افحص الحالة.")
    prompt = str(prompt or "").strip()
    if len(prompt) < 8 or len(prompt) > 1800:
        raise gr.Error("طول الوصف يجب أن يكون بين 8 و1800 حرف.")
    if MINOR.search(prompt) and SEXUAL.search(prompt):
        raise gr.Error("لا يمكن إنشاء تصوير جنسي لقاصر أو لشخص يبدو قاصراً.")
    if NONCONSENSUAL.search(prompt) and REAL_PERSON.search(prompt):
        raise gr.Error("لا ننشئ صوراً حميمة أو تزييفاً جنسياً لأشخاص حقيقيين دون موافقتهم.")
    sizes = {"512 × 512": (512, 512), "512 × 768": (512, 768), "768 × 512": (768, 512)}
    width, height = sizes.get(resolution, (512, 512))
    steps = max(20, min(35, int(steps)))
    cfg = max(3.0, min(9.0, float(cfg)))
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
        path = OUTPUTS / f"umranz-{seed}-{int(time.time())}.png"
        image.save(path, format="PNG", optimize=True)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        elapsed = round(time.monotonic() - started, 2)
        meta = {
            "result": "image_generated",
            "candidate": "umranz",
            "model": MODEL_ID,
            "app_revision": APP_REVISION,
            "device": "CPU only",
            "precision": "float32",
            "resolution": f"{width}x{height}",
            "steps": steps,
            "cfg": cfg,
            "seed": seed,
            "seconds": elapsed,
            "image_sha256": digest,
            "basic_image_checks": stats,
            "production_routes_modified": False,
        }
        set_state(phase="ready", last_generation_seconds=elapsed, last_result=str(path), last_image_checks=stats)
        return image, meta
    except gr.Error:
        set_state(phase="ready")
        raise
    except Exception as exc:
        set_state(phase="ready", last_generation_error=f"{type(exc).__name__}: {exc}"[:600])
        raise gr.Error(f"فشل توليد Umranz: {type(exc).__name__}: {exc}") from exc
    finally:
        INFER_LOCK.release()


with gr.Blocks(title="Umranz — dedicated CPU image test") as demo:
    gr.Markdown("# Umranz SD1.5 — استديو اختبار مستقل\nCPU فقط · 8GB RAM · أوزان وذاكرة وواجهة منفصلة.")
    state_box = gr.JSON(label="الحالة", value=status())
    gr.Button("تحديث الحالة").click(status, inputs=[], outputs=state_box, api_name="status")
    prompt_box = gr.Textbox(label="وصف الصورة", lines=5)
    negative_box = gr.Textbox(label="Negative prompt", value="deformed, distorted, disfigured, bad anatomy, bad eyes, blurry, watermark, text", lines=3)
    with gr.Row():
        resolution_box = gr.Dropdown(["512 × 512", "512 × 768", "768 × 512"], value="512 × 512", label="الدقة")
        steps_box = gr.Slider(20, 35, value=30, step=1, label="Steps")
        cfg_box = gr.Slider(3, 9, value=6.5, step=0.5, label="CFG")
        seed_box = gr.Number(value=42, precision=0, label="Seed")
    button = gr.Button("توليد صورة Umranz", variant="primary")
    image_box = gr.Image(type="pil", label="الناتج")
    metadata_box = gr.JSON(label="بيانات الاختبار")
    button.click(generate, inputs=[prompt_box, negative_box, resolution_box, steps_box, cfg_box, seed_box], outputs=[image_box, metadata_box], api_name="image")

threading.Thread(target=load_worker, name="umranz-loader", daemon=True).start()
demo.queue(default_concurrency_limit=1, max_size=2)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
