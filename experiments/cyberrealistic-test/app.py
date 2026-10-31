"""Isolated CPU Studio for CyberRealistic FINAL FP16.

This Studio loads only the creator's CyberRealistic checkpoint and its baked VAE.
It does not import/call Realistic Vision, Nova, Sham v2, old Sham, or production
media routing.
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
MODEL_REPO = os.environ.get("PHOTO_MODEL_REPO", "novaai2026/cyberrealistic-final-test-models")
CACHE = HERE / "_cyberrealistic_model_cache"
CHECKPOINT_REL = "checkpoint/CyberRealistic_FINAL_FP16.safetensors"
EXPECTED_SHA256 = "2209c07b331a06cb28cf7c830ec758ae5b49eb97fab21f5de6b18c7be8b41554"

DEFAULT_NEGATIVE = (
    "(cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, "
    "plastic skin, waxy skin, airbrushed, synthetic face), deformed eyes, "
    "asymmetrical eyes, bad anatomy, bad proportions, malformed hands, "
    "extra fingers, fused fingers, missing fingers, extra limbs, duplicate "
    "person, blurry, low quality, jpeg artifacts, watermark, logo, text"
)

_STATE = {
    "phase": "starting",
    "model_repo": MODEL_REPO,
    "model": "CyberRealistic FINAL FP16",
            "precision": "bfloat16 autocast" if used_fast else "float32",
    "checkpoint": CHECKPOINT_REL,
    "checkpoint_sha256": None,
    "creator_sha256_verified": False,
    "architecture": "Stable Diffusion 1.5",
    "vae": "baked into checkpoint; no external VAE",
    "device": "CPU only",
    "sampler": "DPM++ SDE Karras",
    "default_steps": 30,
    "default_cfg": 5.0,
    "default_resolution": "512x768",
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


def _fast_cpu() -> bool:
    """bfloat16 maths pays off only on CPUs with AVX512-BF16 / AMX (the Xeon Studios have both). PHOTO_FAST=0 turns the fast path off."""
    if os.environ.get("PHOTO_FAST", "1") == "0":
        return False
    try:
        flags = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore")
        return "amx_bf16" in flags or "avx512_bf16" in flags
    except Exception:
        return False


FAST = _fast_cpu()


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

    if not checkpoint.is_file() or checkpoint.stat().st_size < 1_000_000_000:
        raise FileNotFoundError("CyberRealistic checkpoint is missing or unexpectedly small.")
    actual = _sha256(checkpoint)
    expected = manifest.get("checkpoint_sha256")
    if actual.lower() != EXPECTED_SHA256 or expected != EXPECTED_SHA256:
        raise RuntimeError("Creator SHA-256 mismatch; refusing to load the checkpoint.")
    if manifest.get("model_source") != "cyberdelia/CyberRealistic":
        raise RuntimeError("Unexpected checkpoint source in manifest.")
    if manifest.get("vae") != "baked into the creator checkpoint; no external VAE attached":
        raise RuntimeError("Unexpected VAE configuration; refusing to mix weight sets.")
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
        raise FileNotFoundError("SD 1.5 Diffusers config is missing from the private package.")

    _set_state(
        phase="loading",
        checkpoint_sha256=manifest["checkpoint_sha256"],
        creator_sha256_verified=True,
    )

    import torch
    from diffusers import DPMSolverMultistepScheduler, StableDiffusionPipeline

    threads = max(1, min(4, int(os.environ.get("PHOTO_CPU_THREADS", "2"))))
    torch.set_num_threads(threads)
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass

    checkpoint = root / CHECKPOINT_REL
    # No external VAE is supplied: CyberRealistic's own baked VAE remains intact.
    pipe = StableDiffusionPipeline.from_single_file(
        str(checkpoint),
        config=str(config_root),
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
    if not FAST:
        pipe.enable_attention_slicing("max")      # the memory-safe (slow) path; the fast path uses PyTorch's fused attention, which does not build the full matrix
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
        cpu_threads=threads,
        checkpoint_sha256=manifest["checkpoint_sha256"],
        creator_sha256_verified=True,
        modelscope_model_repo=MODEL_REPO,
    )


def _load_worker() -> None:
    try:
        _load_pipeline()
    except Exception as exc:
        _set_state(
            phase="error",
            error=f"{type(exc).__name__}: {exc}"[:1200],
            traceback=traceback.format_exc()[-5000:],
        )


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

    if _STATE.get("phase") != "ready" or _PIPE is None:
        raise gr.Error("الاستوديو لم يجهز بعد. افحص الحالة وحاول مجدداً.")
    prompt = str(prompt or "").strip()
    if len(prompt) < 8:
        raise gr.Error("اكتب وصفاً أطول للصورة.")
    if len(prompt) > 1800:
        raise gr.Error("وصف الصورة طويل جداً؛ الحد 1800 حرف.")
    negative_prompt = str(negative_prompt or "").strip()[:1800]

    shapes = {
        "512 × 768 (author recommended)": (512, 768),
        "512 × 512": (512, 512),
        "768 × 512": (768, 512),
    }
    width, height = shapes.get(aspect, (512, 768))
    steps = max(18, min(35, int(steps)))
    guidance = max(3.0, min(8.0, float(guidance)))
    seed = int(seed)
    started = time.monotonic()

    if not _INFER_LOCK.acquire(blocking=False):
        raise gr.Error("يوجد توليد آخر جارٍ على معالج CPU؛ انتظر حتى ينتهي.")
    _set_state(phase="generating", last_prompt=prompt[:240])
    try:
        def run_once(fast: bool):
            generator = torch.Generator(device="cpu").manual_seed(seed)
            with torch.inference_mode(), torch.autocast("cpu", dtype=torch.bfloat16, enabled=fast):
                picture = _PIPE(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    generator=generator,
                ).images[0]
            rgb = picture.convert("RGB")
            gray_values = np.asarray(rgb, dtype=np.float32).mean(axis=2)
            return rgb, {
                "width": rgb.width,
                "height": rgb.height,
                "gray_std": round(float(gray_values.std()), 2),
                "gray_range": round(float(gray_values.max() - gray_values.min()), 2),
            }

        used_fast = FAST
        try:
            image, stats = run_once(FAST)
            if FAST and (stats["gray_std"] < 8.0 or stats["gray_range"] < 24.0):
                raise ValueError("fast path produced a blank image")
        except Exception:
            if not FAST:
                raise
            used_fast = False                      # any problem on the fast path: run the proven path once
            image, stats = run_once(False)
        if stats["gray_std"] < 8.0 or stats["gray_range"] < 24.0:
            raise gr.Error("الناتج فارغ أو شبه ثابت؛ لم نعتمده كصورة صالحة.")

        output_dir = HERE / "visual-test-results"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"cyberrealistic-{seed}-{int(time.time())}.png"
        image.save(output_path, format="PNG", optimize=True)
        elapsed = round(time.monotonic() - started, 2)
        meta = {
            "result": "image_generated",
            "model": "CyberRealistic FINAL FP16",
            "model_repo": MODEL_REPO,
            "source": "cyberdelia/CyberRealistic",
            "checkpoint_sha256": _MANIFEST["checkpoint_sha256"],
            "creator_sha256_verified": True,
            "vae": "baked into the checkpoint; no external VAE",
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


with gr.Blocks(title="CyberRealistic FINAL — isolated photo test") as demo:
    gr.Markdown(
        "# CyberRealistic FINAL FP16 — مختبر الصور البشرية الواقعية\n"
        "استوديو منفصل وأوزان مستقلة عن Realistic Vision. "
        "يستخدم VAE المدمج داخل checkpoint نفسه ولا يضيف VAE من نموذج آخر.\n\n"
        "يتم التحقق من SHA-256 الرسمي قبل التحميل. "
        "الحكم على واقعية الوجه واليدين والتشريح يبقى مراجعة بصرية."
    )
    state_box = gr.JSON(label="حالة تحميل النموذج", value=status_json())
    refresh = gr.Button("تحديث حالة الاستوديو")
    refresh.click(fn=status_json, inputs=[], outputs=state_box, api_name="status")

    with gr.Row():
        prompt_box = gr.Textbox(label="وصف الصورة", placeholder="A natural RAW photograph of ...", lines=5)
        negative_box = gr.Textbox(label="Negative prompt", value=DEFAULT_NEGATIVE, lines=5)
    with gr.Row():
        aspect_box = gr.Dropdown(
            choices=["512 × 768 (author recommended)", "512 × 512", "768 × 512"],
            value="512 × 768 (author recommended)",
            label="الدقة",
        )
        steps_box = gr.Slider(18, 35, value=24, step=1, label="خطوات التوليد")
        guidance_box = gr.Slider(3, 8, value=5.0, step=0.5, label="CFG")
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
        "الإعداد المبدئي مطابق لإرشادات المطوّر: DPM++ SDE Karras، 30 خطوة، CFG 5، 512×768. "
        "التوليد على CPU قد يستغرق عدة دقائق."
    )


threading.Thread(target=_load_worker, name="cyberrealistic-model-loader", daemon=True).start()
demo.queue(default_concurrency_limit=1, max_size=2)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
