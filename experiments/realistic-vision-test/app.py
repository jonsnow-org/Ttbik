"""Isolated, CPU-only Realistic Vision V6.0 visual-test Studio.

This application never imports or calls Nova, Sham v2, old Sham, SDXS, or any
production media route. It loads exactly one checkpoint plus the documented
MSE VAE from a private ModelScope model repository.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import traceback
from pathlib import Path

import gradio as gr

HERE = Path(__file__).resolve().parent
MODEL_REPO = os.environ.get(
    "PHOTO_MODEL_REPO", "novaai2026/realistic-vision-v6-test-models"
)
CACHE = HERE / "_photo_model_cache"
CHECKPOINT_REL = "checkpoint/Realistic_Vision_V6.0_NV_B1_fp16.safetensors"
VAE_REL = "vae/vae-ft-mse-840000-ema-pruned.safetensors"
DEFAULT_NEGATIVE = (
    "(deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, "
    "cartoon, drawing, anime), text, cropped, out of frame, worst quality, "
    "low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated, extra "
    "fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, "
    "deformed, blurry, dehydrated, bad anatomy, bad proportions, extra limbs, "
    "cloned face, disfigured, gross proportions, malformed limbs, missing arms, "
    "missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck"
)

_STATE = {
    "phase": "starting",
    "model_repo": MODEL_REPO,
    "model": "Realistic Vision V6.0 B1 noVAE FP16",
    "checkpoint": CHECKPOINT_REL,
    "vae": VAE_REL,
    "device": "CPU only",
    "sampler": "DPM++ SDE Karras",
    "default_steps": 25,
    "error": "",
    "load_seconds": None,
    "last_generation_seconds": None,
}
_STATE_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()
_PIPE = None
_MANIFEST = None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _set_state(**values) -> None:
    with _STATE_LOCK:
        _STATE.update(values)


def _model_root() -> Path:
    token = (
        os.environ.get("MODELSCOPE_API_TOKEN")
        or os.environ.get("MODELSCOPE_TOKEN")
        or ""
    ).strip()
    if not token:
        raise RuntimeError("MODELSCOPE_API_TOKEN is not configured in this private Studio.")

    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi

    api = HubApi()
    api.login(token)
    CACHE.mkdir(parents=True, exist_ok=True)
    return Path(snapshot_download(MODEL_REPO, cache_dir=str(CACHE)))


def _verify_package(root: Path) -> dict:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("Model manifest is missing; refusing to load unverified weights.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    checkpoint = root / CHECKPOINT_REL
    vae = root / VAE_REL
    for name, path, expected in (
        ("checkpoint", checkpoint, manifest.get("checkpoint_sha256")),
        ("VAE", vae, manifest.get("vae_sha256")),
    ):
        if not path.is_file() or path.stat().st_size < 100_000_000:
            raise FileNotFoundError(f"{name} file is missing or unexpectedly small.")
        actual = _sha256(path)
        if not expected or actual != expected:
            raise RuntimeError(f"{name} SHA-256 mismatch; refusing to load the package.")
    if manifest.get("model_source") != "SG161222/Realistic_Vision_V6.0_B1_noVAE":
        raise RuntimeError("Unexpected checkpoint source in manifest.")
    if manifest.get("vae_source") != "stabilityai/sd-vae-ft-mse-original":
        raise RuntimeError("Unexpected VAE source in manifest.")
    return manifest


def _load_pipeline():
    global _PIPE, _MANIFEST

    started = time.monotonic()
    _set_state(phase="downloading", error="")
    root = _model_root()
    _set_state(phase="verifying")
    manifest = _verify_package(root)
    config_root = root / "config"
    if not (config_root / "model_index.json").is_file():
        raise FileNotFoundError("Diffusers model config is missing from the ModelScope package.")

    _set_state(
        phase="loading",
        checkpoint_sha256=manifest["checkpoint_sha256"],
        vae_sha256=manifest["vae_sha256"],
        checkpoint_bytes=manifest["checkpoint_bytes"],
        vae_bytes=manifest["vae_bytes"],
    )

    import torch
    from diffusers import AutoencoderKL, DPMSolverMultistepScheduler, StableDiffusionPipeline

    threads = max(1, min(4, int(os.environ.get("PHOTO_CPU_THREADS", "2"))))
    torch.set_num_threads(threads)
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass

    checkpoint = root / CHECKPOINT_REL
    vae_file = root / VAE_REL
    vae_config = config_root / "vae" / "config.json"

    # The Studio cannot access Hugging Face. All configs and weights are local.
    # The separately supplied VAE replaces the checkpoint's no-VAE placeholder.
    vae = AutoencoderKL.from_single_file(
        str(vae_file),
        config=str(vae_config),
        torch_dtype=torch.float32,
        local_files_only=True,
        use_safetensors=True,
    )
    pipe = StableDiffusionPipeline.from_single_file(
        str(checkpoint),
        config=str(config_root),
        vae=vae,
        torch_dtype=torch.float32,
        local_files_only=True,
        use_safetensors=True,
        safety_checker=None,
        feature_extractor=None,
        requires_safety_checker=False,
        low_cpu_mem_usage=True,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config,
        algorithm_type="sde-dpmsolver++",
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

    _PIPE = pipe
    _MANIFEST = manifest
    elapsed = round(time.monotonic() - started, 2)
    _set_state(
        phase="ready",
        error="",
        load_seconds=elapsed,
        sampler="DPM++ SDE Karras",
        scheduler="DPMSolverMultistepScheduler / sde-dpmsolver++ / Karras sigmas",
        cpu_threads=threads,
        modelscope_model_repo=MODEL_REPO,
        checkpoint_sha256=manifest["checkpoint_sha256"],
        vae_sha256=manifest["vae_sha256"],
    )


def _load_worker() -> None:
    try:
        _load_pipeline()
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        _set_state(phase="error", error=detail[:1200], traceback=traceback.format_exc()[-5000:])


def status_json() -> dict:
    with _STATE_LOCK:
        return dict(_STATE)


def generate_image(
    prompt: str,
    negative_prompt: str,
    aspect: str,
    steps: int,
    guidance: float,
    seed: int,
):
    import numpy as np
    import torch
    from PIL import Image

    if _STATE.get("phase") != "ready" or _PIPE is None:
        raise gr.Error("الاستوديو لم يجهز بعد. افحص الحالة وحاول مجدداً.")
    prompt = str(prompt or "").strip()
    if len(prompt) < 8:
        raise gr.Error("اكتب وصفاً أطول للصورة.")
    if len(prompt) > 1800:
        raise gr.Error("وصف الصورة طويل جداً؛ الحد 1800 حرف.")
    negative_prompt = str(negative_prompt or "").strip()[:1800]
    shapes = {
        "512 × 512": (512, 512),
        "512 × 768": (512, 768),
        "768 × 512": (768, 512),
    }
    width, height = shapes.get(aspect, (512, 512))
    steps = max(25, min(35, int(steps)))
    guidance = max(3.0, min(8.0, float(guidance)))
    seed = int(seed)
    started = time.monotonic()

    if not _INFER_LOCK.acquire(blocking=False):
        raise gr.Error("يوجد توليد آخر جارٍ على معالج CPU؛ انتظر حتى ينتهي.")
    _set_state(phase="generating", last_prompt=prompt[:240])
    try:
        generator = torch.Generator(device="cpu").manual_seed(seed)
        with torch.inference_mode():
            result = _PIPE(
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
            ).images[0]

        image = result.convert("RGB")
        gray = np.asarray(image, dtype=np.float32).mean(axis=2)
        stats = {
            "width": image.width,
            "height": image.height,
            "gray_std": round(float(gray.std()), 2),
            "gray_range": round(float(gray.max() - gray.min()), 2),
        }
        if stats["gray_std"] < 8.0 or stats["gray_range"] < 24.0:
            raise gr.Error("الناتج فارغ أو شبه ثابت؛ لم نعتمده كصورة صالحة.")

        output_dir = HERE / "visual-test-results"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"realistic-v6-{seed}-{int(time.time())}.png"
        image.save(output_path, format="PNG", optimize=True)
        elapsed = round(time.monotonic() - started, 2)
        meta = {
            "result": "image_generated",
            "model": "Realistic Vision V6.0 B1 noVAE FP16",
            "model_repo": MODEL_REPO,
            "checkpoint_sha256": _MANIFEST["checkpoint_sha256"],
            "vae": "stabilityai/sd-vae-ft-mse-original",
            "vae_file": VAE_REL,
            "vae_sha256": _MANIFEST["vae_sha256"],
            "sampler": "DPM++ SDE Karras",
            "steps": steps,
            "guidance_scale": guidance,
            "seed": seed,
            "resolution": f"{width}x{height}",
            "device": "CPU only",
            "seconds": elapsed,
            "basic_image_checks": stats,
            "saved_file": str(output_path),
            "visual_review_required": True,
            "production_routes_modified": False,
        }
        _set_state(
            phase="ready",
            last_generation_seconds=elapsed,
            last_result=str(output_path),
            last_image_checks=stats,
        )
        return image, meta
    except gr.Error:
        _set_state(phase="ready")
        raise
    except Exception as exc:
        _set_state(phase="ready", last_generation_error=f"{type(exc).__name__}: {exc}"[:600])
        raise gr.Error(f"فشل التوليد: {type(exc).__name__}: {exc}") from exc
    finally:
        _INFER_LOCK.release()


with gr.Blocks(title="Realistic Vision V6.0 — isolated visual test") as demo:
    gr.Markdown(
        "# Realistic Vision V6.0 — مختبر الصور الواقعية\n"
        "استوديو اختبار منفصل تماماً، يعمل على CPU المجاني. "
        "لا يغيّر Nova أو Sham v2 أو Sham القديم أو مسارات SDXS الإنتاجية.\n\n"
        "يتم التحقق من SHA-256 للـ checkpoint والـ VAE قبل تحميلهما. "
        "الفحص الآلي يرفض الصورة الفارغة فقط؛ الحكم على واقعية الوجه واليدين والتفاصيل بصري."
    )
    state_box = gr.JSON(label="حالة تحميل النموذج", value=status_json())
    refresh = gr.Button("تحديث حالة الاستوديو")
    refresh.click(fn=status_json, inputs=[], outputs=state_box, api_name="status")

    with gr.Row():
        prompt_box = gr.Textbox(
            label="وصف الصورة",
            placeholder="A candid RAW photo of ...",
            lines=5,
        )
        negative_box = gr.Textbox(
            label="Negative prompt",
            value=DEFAULT_NEGATIVE,
            lines=5,
        )
    with gr.Row():
        aspect_box = gr.Dropdown(
            choices=["512 × 512", "512 × 768", "768 × 512"],
            value="512 × 512",
            label="الدقة",
        )
        steps_box = gr.Slider(25, 35, value=25, step=1, label="خطوات التوليد")
        guidance_box = gr.Slider(3, 8, value=5.5, step=0.5, label="CFG")
        seed_box = gr.Number(value=42, precision=0, label="Seed")
    generate = gr.Button("توليد صورة اختبار", variant="primary")
    output_image = gr.Image(label="الناتج", type="pil")
    output_meta = gr.JSON(label="تفاصيل التوليد والتحقق")
    generate.click(
        fn=generate_image,
        inputs=[prompt_box, negative_box, aspect_box, steps_box, guidance_box, seed_box],
        outputs=[output_image, output_meta],
        api_name="image",
    )
    gr.Markdown(
        "إعداد البداية: 25 خطوة، DPM++ SDE Karras، VAE: "
        "vae-ft-mse-840000-ema-pruned. التوليد على CPU قد يستغرق عدة دقائق."
    )

threading.Thread(target=_load_worker, name="photo-model-loader", daemon=True).start()
demo.queue(default_concurrency_limit=1, max_size=2)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
