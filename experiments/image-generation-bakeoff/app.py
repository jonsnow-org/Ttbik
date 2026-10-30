"""Private, isolated image-model benchmark Studio.

One Studio loads one candidate only. Its model weights never enter Nova, Sham,
or the language-model donor-bakeoff runtime.
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

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "candidate.json").read_text(encoding="utf-8"))
CACHE = ROOT / "model_cache"
RESULTS = ROOT / "visual-test-results"
APP_REVISION = "image-generation-bakeoff-2026-10-31-r1"
MAX_PROMPT_CHARS = 1800

DEFAULT_NEGATIVE = (
    "cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, "
    "plastic skin, waxy skin, airbrushed, synthetic face, deformed eyes, "
    "asymmetrical eyes, bad anatomy, bad proportions, malformed hands, "
    "extra fingers, fused fingers, missing fingers, extra limbs, duplicate "
    "person, blurry, low quality, jpeg artifacts, watermark, logo, text"
)

# Narrow, essential restrictions for the private test surface. This is not a
# general-purpose prompt filter: it blocks sexual depictions of minors and
# non-consensual intimate imagery / sexual deepfakes of real people.
_MINOR_TERMS = (
    r"\b(?:child|children|minor|underage|teen|teenager|schoolgirl|schoolboy|"
    r"loli|shota)\b|طفل|طفلة|قاصر|قاصرة|مراهق|مراهقة|تلميذ|تلميذة"
)
_SEX_TERMS = (
    r"\b(?:nude|naked|nudity|sex|sexual|erotic|porn|explicit|undress)\b|"
    r"عاري|عارية|تعري|جنس|جنسي|إباحي|إباحية"
)
_NONCONSENSUAL_TERMS = (
    r"\b(?:non[- ]consensual|without consent|revenge porn|deepfake|"
    r"undress (?:her|him|them)|make (?:her|him|them) naked)\b|"
    r"بدون موافقة|دون موافقة|صور حميمة مسربة|تعرية شخص|انتهاك الخصوصية"
)
_REAL_PERSON_TERMS = (
    r"\b(?:real person|celebrity|public figure|my ex|my wife|my girlfriend|"
    r"my colleague|my coworker)\b|شخص حقيقي|شخصية عامة|مشهور|مشاهير|زوجتي|"
    r"زوجة|طليقتي|حبيبتي|زميلتي|زميلي"
)


def validate_prompt(prompt: str) -> None:
    lowered = str(prompt or "").casefold()
    if re.search(_MINOR_TERMS, lowered, flags=re.IGNORECASE) and re.search(
        _SEX_TERMS, lowered, flags=re.IGNORECASE
    ):
        raise gr.Error("هذا الطلب يتضمن تصويراً جنسياً لقاصر أو لشخص يبدو قاصراً، ولن يُرسل إلى النموذج.")
    if re.search(_NONCONSENSUAL_TERMS, lowered, flags=re.IGNORECASE) and re.search(
        _REAL_PERSON_TERMS, lowered, flags=re.IGNORECASE
    ):
        raise gr.Error("لا ننشئ صوراً حميمة أو تزييفاً جنسياً لأشخاص حقيقيين دون موافقتهم.")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _available_memory_gb() -> float:
    candidates = []
    try:
        import psutil
        candidates.append(float(psutil.virtual_memory().total))
    except Exception:
        pass
    for path in (
        Path("/sys/fs/cgroup/memory.max"),
        Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    ):
        try:
            raw = path.read_text(encoding="utf-8").strip()
            if raw.isdigit() and int(raw) < 1 << 60:
                candidates.append(float(int(raw)))
        except Exception:
            pass
    return round(min(candidates) / (1024 ** 3), 2) if candidates else 0.0


STATE = {
    "phase": "starting",
    "app_revision": APP_REVISION,
    "candidate": CONFIG["id"],
    "label": CONFIG["label"],
    "repo_id": CONFIG["repo_id"],
    "pipeline": CONFIG["pipeline"],
    "device": "CPU only",
    "minimum_memory_gb": CONFIG["minimum_memory_gb"],
    "available_memory_gb": _available_memory_gb(),
    "checkpoint_sha256": None,
    "load_seconds": None,
    "last_generation_seconds": None,
    "last_generation_error": "",
    "error": "",
}
STATE_LOCK = threading.RLock()
INFER_LOCK = threading.Lock()
PIPE = None


def set_state(**values) -> None:
    with STATE_LOCK:
        STATE.update(values)


def status_json() -> dict:
    with STATE_LOCK:
        result = dict(STATE)
    result["available_memory_gb"] = _available_memory_gb()
    return result


def _download_model():
    CACHE.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import hf_hub_download, snapshot_download

    repo_id = CONFIG["repo_id"]
    revision = CONFIG.get("revision", "main")
    if CONFIG["pipeline"] == "sd15_diffusers":
        folder = snapshot_download(
            repo_id=repo_id,
            revision=revision,
            cache_dir=str(CACHE),
            allow_patterns=[
                "*.json", "*.safetensors", "*.txt", "*.model", "*.bin",
                "scheduler/*", "text_encoder/*", "tokenizer/*", "unet/*",
                "vae/*", "feature_extractor/*", "safety_checker/*",
            ],
        )
        return Path(folder), None

    filename = CONFIG["filename"]
    checkpoint = Path(hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        cache_dir=str(CACHE),
    ))
    return checkpoint.parent, checkpoint


def _load_pipeline():
    global PIPE
    started = time.monotonic()
    set_state(phase="downloading", error="")
    memory_gb = _available_memory_gb()
    required = float(CONFIG["minimum_memory_gb"])
    if memory_gb and memory_gb < required:
        raise RuntimeError(
            f"Insufficient memory for this candidate: {memory_gb:.1f} GB available; "
            f"{required:.1f} GB required. The Studio will not be loaded partially."
        )

    root, checkpoint = _download_model()
    set_state(phase="loading")

    import torch
    from diffusers import (
        DPMSolverMultistepScheduler,
        StableDiffusionPipeline,
        StableDiffusionXLPipeline,
    )

    threads = max(1, min(int(os.cpu_count() or 2), 4))
    torch.set_num_threads(threads)
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass

    dtype_name = str(CONFIG.get("torch_dtype", "float32")).lower()
    dtype = torch.float16 if dtype_name == "float16" else torch.float32

    if CONFIG["pipeline"] == "sd15_diffusers":
        pipe = StableDiffusionPipeline.from_pretrained(
            str(root),
            torch_dtype=dtype,
            use_safetensors=True,
            local_files_only=True,
            low_cpu_mem_usage=True,
        )
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(
            pipe.scheduler.config,
            algorithm_type="dpmsolver++",
            use_karras_sigmas=True,
        )
    elif CONFIG["pipeline"] == "sdxl_single_file_fp8":
        if checkpoint is None or not checkpoint.is_file():
            raise FileNotFoundError("The configured FP8 checkpoint was not downloaded.")
        pipe = StableDiffusionXLPipeline.from_single_file(
            str(checkpoint),
            config=CONFIG["base_config_repo"],
            torch_dtype=dtype,
            use_safetensors=True,
            local_files_only=True,
            low_cpu_mem_usage=True,
        )
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(
            pipe.scheduler.config,
            algorithm_type="sde-dpmsolver++",
            use_karras_sigmas=True,
        )
        set_state(checkpoint_sha256=sha256_file(checkpoint))
    else:
        raise ValueError(f"Unsupported pipeline type: {CONFIG['pipeline']}")

    pipe.set_progress_bar_config(disable=True)
    pipe.enable_attention_slicing("max")
    pipe.enable_vae_slicing()
    try:
        pipe.enable_vae_tiling()
    except Exception:
        pass
    pipe.to("cpu")
    PIPE = pipe

    elapsed = round(time.monotonic() - started, 2)
    set_state(
        phase="ready",
        error="",
        load_seconds=elapsed,
        cpu_threads=threads,
        available_memory_gb=_available_memory_gb(),
        model_revision=CONFIG.get("revision", "main"),
    )


def load_worker() -> None:
    try:
        _load_pipeline()
    except Exception as exc:
        set_state(
            phase="error",
            error=f"{type(exc).__name__}: {exc}"[:1200],
            traceback=traceback.format_exc()[-5000:],
        )


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

    if STATE.get("phase") != "ready" or PIPE is None:
        raise gr.Error("الاستوديو لم يجهز بعد. افحص الحالة وحاول مجدداً.")
    prompt = str(prompt or "").strip()
    if len(prompt) < 8:
        raise gr.Error("اكتب وصفاً أطول للصورة.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise gr.Error(f"وصف الصورة طويل جداً؛ الحد {MAX_PROMPT_CHARS} حرف.")
    validate_prompt(prompt)
    negative_prompt = str(negative_prompt or "").strip()[:MAX_PROMPT_CHARS]
    shapes = CONFIG["resolutions"]
    width, height = shapes.get(aspect, tuple(CONFIG["default_resolution"]))
    steps = max(int(CONFIG["min_steps"]), min(int(CONFIG["max_steps"]), int(steps)))
    guidance = max(float(CONFIG["min_cfg"]), min(float(CONFIG["max_cfg"]), float(guidance)))
    seed = int(seed)

    if not INFER_LOCK.acquire(blocking=False):
        raise gr.Error("يوجد توليد آخر جارٍ على معالج CPU؛ انتظر حتى ينتهي.")
    started = time.monotonic()
    set_state(phase="generating", last_prompt=prompt[:240])
    try:
        generator = torch.Generator(device="cpu").manual_seed(seed)
        with torch.inference_mode():
            image = PIPE(
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=generator,
            ).images[0].convert("RGB")

        gray = np.asarray(image, dtype=np.float32).mean(axis=2)
        stats = {
            "width": image.width,
            "height": image.height,
            "gray_std": round(float(gray.std()), 2),
            "gray_range": round(float(gray.max() - gray.min()), 2),
        }
        if stats["gray_std"] < 8.0 or stats["gray_range"] < 24.0:
            raise gr.Error("الناتج فارغ أو شبه ثابت؛ لم نعتمده كصورة صالحة.")

        RESULTS.mkdir(parents=True, exist_ok=True)
        output = RESULTS / f"{CONFIG['id']}-{seed}-{int(time.time())}.png"
        image.save(output, format="PNG", optimize=True)
        elapsed = round(time.monotonic() - started, 2)
        meta = {
            "result": "image_generated",
            "model": CONFIG["label"],
            "source": CONFIG["repo_id"],
            "model_revision": CONFIG.get("revision", "main"),
            "pipeline": CONFIG["pipeline"],
            "precision": CONFIG.get("torch_dtype", "float32"),
            "sampler": CONFIG["sampler"],
            "steps": steps,
            "guidance_scale": guidance,
            "seed": seed,
            "resolution": f"{width}x{height}",
            "device": "CPU only",
            "seconds": elapsed,
            "basic_image_checks": stats,
            "image_sha256": sha256_file(output),
            "saved_file": str(output),
            "app_revision": APP_REVISION,
            "production_routes_modified": False,
            "visual_review_required": True,
        }
        set_state(
            phase="ready",
            last_generation_seconds=elapsed,
            last_result=str(output),
            last_image_checks=stats,
            last_generation_error="",
        )
        return image, meta
    except gr.Error:
        set_state(phase="ready")
        raise
    except Exception as exc:
        set_state(
            phase="ready",
            last_generation_error=f"{type(exc).__name__}: {exc}"[:700],
        )
        raise gr.Error(f"فشل التوليد: {type(exc).__name__}: {exc}") from exc
    finally:
        INFER_LOCK.release()


with gr.Blocks(title=f"{CONFIG['label']} — isolated image benchmark") as demo:
    gr.Markdown(
        f"# {CONFIG['label']} — اختبار توليد مستقل\n"
        "أوزان مستقلة عن Nova وSham وSham v2. يعمل هذا الاستوديو لهذا المرشح فقط؛ "
        "ولا يستبدل أي مسار إنتاجي."
    )
    state_box = gr.JSON(label="حالة النموذج", value=status_json())
    gr.Button("تحديث الحالة").click(fn=status_json, inputs=[], outputs=state_box, api_name="status")

    prompt_box = gr.Textbox(label="وصف الصورة", lines=5)
    negative_box = gr.Textbox(label="Negative prompt", value=DEFAULT_NEGATIVE, lines=4)
    aspect_box = gr.Dropdown(
        choices=list(CONFIG["resolutions"].keys()),
        value=CONFIG["default_aspect"],
        label="الدقة",
    )
    with gr.Row():
        steps_box = gr.Slider(
            int(CONFIG["min_steps"]), int(CONFIG["max_steps"]),
            value=int(CONFIG["default_steps"]), step=1, label="خطوات التوليد",
        )
        cfg_box = gr.Slider(
            float(CONFIG["min_cfg"]), float(CONFIG["max_cfg"]),
            value=float(CONFIG["default_cfg"]), step=0.5, label="CFG",
        )
        seed_box = gr.Number(value=42, precision=0, label="Seed")

    generate = gr.Button("توليد صورة اختبار", variant="primary")
    image_box = gr.Image(label="الناتج", type="pil")
    meta_box = gr.JSON(label="بيانات التوليد")
    generate.click(
        fn=generate_image,
        inputs=[prompt_box, negative_box, aspect_box, steps_box, cfg_box, seed_box],
        outputs=[image_box, meta_box],
        api_name="image",
    )

threading.Thread(target=load_worker, name="image-candidate-loader", daemon=True).start()
demo.queue(default_concurrency_limit=1, max_size=2)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
