"""
Nova Media Studio — makes pictures, speech and short videos on a free ModelScope CPU Studio (2 vCPU), for Nova's `make_media` tool.

  image   a distilled one-step diffusion model (SDXS-512): measured ~6 s per 512 px picture on 2 cores
  speech  Piper (ONNX), Arabic voice: measured 7.8 s of audio in 0.5 s
  video   a slideshow: several pictures + optional narration, joined with ffmpeg (no video-diffusion model fits a free CPU)

One job at a time (a busy Studio answers {"type": "busy"} at once instead of queueing: the caller decides). The models are downloaded from modelscope.cn
(this Studio cannot reach huggingface.co or github.com): MEDIA_MODEL_REPO (default novaai2026/nova-media-models) holds  sdxs/  and  piper/ar_JO-kareem-medium.onnx(+.json).

Gradio API (same call protocol as the coder Studio):  /gradio_api/call/{image,speech,video,status}  — each takes one JSON string and answers one JSON string.
  image   {"prompt": "...", "size": 512, "seed": 0}                      -> {"type":"image","b64":"<png>"}
  speech  {"text": "..."}                                               -> {"type":"audio","b64":"<wav>"}
  video   {"prompts": ["...", ...], "narration": "...", "seconds": 3}   -> {"type":"video","b64":"<mp4>"}
"""
import base64
import io
import json
import os
import subprocess
import tempfile
import threading
import time
import traceback
import wave
from pathlib import Path

os.environ["no_proxy"] = "127.0.0.1,localhost"
HERE = Path(__file__).resolve().parent
REPO = os.environ.get("MEDIA_MODEL_REPO", "novaai2026/nova-media-models")
STATE = {"phase": "starting", "error": "", "images": 0, "speech": 0, "videos": 0, "last_s": 0.0}
_LOCK = threading.Lock()
_MODELS = {"pipe": None, "voice": None, "root": None, "video_pipe": None, "video_root": None}


def _token() -> str:
    return os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""


def _root() -> Path:
    if _MODELS["root"]:
        return _MODELS["root"]
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    try:                                                    # the repo is public: anonymous first (a login can poison the download)
        _MODELS["root"] = Path(snapshot_download(REPO, cache_dir=str(HERE / "_models")))
    except Exception:                                       # noqa: BLE001
        tok = _token()
        if tok:
            HubApi().login(tok)
        _MODELS["root"] = Path(snapshot_download(REPO, cache_dir=str(HERE / "_models")))
    return _MODELS["root"]


def _pipe():
    if _MODELS["pipe"] is None:
        import torch
        from diffusers import AutoPipelineForText2Image
        torch.set_num_threads(os.cpu_count() or 2)
        p = AutoPipelineForText2Image.from_pretrained(str(_root() / "sdxs"), torch_dtype=torch.float32, safety_checker=None)
        p.set_progress_bar_config(disable=True)
        _MODELS["pipe"] = p
    return _MODELS["pipe"]


def _voice():
    if _MODELS["voice"] is None:
        from piper import PiperVoice
        _MODELS["voice"] = PiperVoice.load(str(_root() / "piper" / "ar_JO-kareem-medium.onnx"))
    return _MODELS["voice"]


def _png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def _speech_wav(text: str) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        _voice().synthesize_wav(text[:1500], w)
    return b.getvalue()


def _make_image(prompt: str, size: int, seed: int):
    import torch
    size = max(256, min(768, int(size) // 64 * 64))
    gen = torch.Generator().manual_seed(int(seed))
    return _pipe()(prompt[:400], num_inference_steps=1, guidance_scale=0.0, height=size, width=size, generator=gen).images[0]


def _video_pipe():
    """Load a real text-to-video diffusion model from local ModelScope weights, never a remote inference API."""
    if _MODELS["video_pipe"] is not None:
        return _MODELS["video_pipe"]
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "native-video-unavailable: Wan2.1 requires a CUDA GPU; this Studio is currently CPU-only. "
            "No slideshow or external generator will be used."
        )
    local_dir = os.environ.get("NOVA_VIDEO_MODEL_DIR", "").strip()
    if not local_dir:
        raise RuntimeError(
            "native-video-unavailable: set NOVA_VIDEO_MODEL_DIR to a locally mounted Wan2.1-T2V-1.3B "
            "Diffusers checkpoint. Model downloads are not performed during user requests."
        )
    model_dir = Path(local_dir).expanduser().resolve()
    if not model_dir.is_dir() or not (model_dir / "model_index.json").is_file():
        raise RuntimeError(f"native-video-unavailable: Diffusers checkpoint not found at {model_dir}")
    from diffusers import WanPipeline
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    pipe = WanPipeline.from_pretrained(
        str(model_dir),
        torch_dtype=dtype,
        local_files_only=True,
    )
    pipe.enable_model_cpu_offload()
    _MODELS["video_pipe"] = pipe
    _MODELS["video_root"] = str(model_dir)
    return pipe


def _make_video(prompt: str, seconds: float, seed: int = 0) -> bytes:
    """Generate temporal motion with Wan diffusion; never assemble generated still images into a video."""
    import torch
    from diffusers.utils import export_to_video
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    seconds = max(2.0, min(5.0, float(seconds or 3)))
    frames = max(33, min(81, int(round(seconds * 16 / 4)) * 4 + 1))
    pipe = _video_pipe()
    generator = torch.Generator(device="cuda").manual_seed(int(seed))
    result = pipe(
        prompt=prompt[:800],
        negative_prompt="static image, frozen motion, slideshow, low quality, blurry, watermark, text",
        height=480,
        width=832,
        num_frames=frames,
        num_inference_steps=20,
        guidance_scale=5.0,
        generator=generator,
    )
    video_frames = result.frames[0]
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "nova-native-video.mp4"
        export_to_video(video_frames, str(target), fps=16)
        return target.read_bytes()


def _run(kind: str, payload: dict) -> dict:
    if not _LOCK.acquire(blocking=False):
        return {"type": "busy"}
    t0 = time.time()
    try:
        STATE["phase"] = f"making {kind}"
        if kind == "image":
            out = {"type": "image", "b64": base64.b64encode(_png(_make_image(str(payload.get("prompt", "")), payload.get("size", 512), payload.get("seed", 0)))).decode()}
        elif kind == "speech":
            out = {"type": "audio", "b64": base64.b64encode(_speech_wav(str(payload.get("text", "")))).decode()}
        else:
            prompt = str(payload.get("prompt", "")).strip()
            out = {"type": "video", "b64": base64.b64encode(
                _make_video(prompt, payload.get("seconds", 3), payload.get("seed", 0))
            ).decode(), "text": prompt[:120]}
        STATE[{"image": "images", "speech": "speech", "video": "videos"}[kind]] += 1
        STATE["last_s"] = round(time.time() - t0, 1)
        return out
    except Exception as e:                                                    # noqa: BLE001
        traceback.print_exc()
        STATE["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        return {"type": "error", "text": STATE["error"]}
    finally:
        STATE["phase"] = "ready"
        _LOCK.release()


def api_image(body: str) -> str:
    return json.dumps(_run("image", json.loads(body or "{}")))


def api_speech(body: str) -> str:
    return json.dumps(_run("speech", json.loads(body or "{}")))


def api_video(body: str) -> str:
    return json.dumps(_run("video", json.loads(body or "{}")))


def api_status() -> str:
    try:
        import torch
        gpu = bool(torch.cuda.is_available())
        gpu_name = torch.cuda.get_device_name(0) if gpu else None
    except Exception:
        gpu, gpu_name = False, None
    video_dir = os.environ.get("NOVA_VIDEO_MODEL_DIR", "").strip()
    video_ready = bool(gpu and video_dir and (Path(video_dir) / "model_index.json").is_file())
    return json.dumps({
        **STATE, "repo": REPO, "cpus": os.cpu_count(),
        "video": {"engine": "WanPipeline", "ready": video_ready, "gpu": gpu, "gpu_name": gpu_name,
                  "model_dir_configured": bool(video_dir), "mode": "native-diffusion-only"},
    })


def _warm() -> None:
    """Load Nova's local image and speech weights; retry without recursive stack growth."""
    while True:
        try:
            STATE["phase"] = "loading models"
            _pipe()
            _voice()
            STATE["phase"] = "ready"
            STATE["error"] = ""
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            STATE["phase"] = "waiting for models"
            STATE["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            time.sleep(120)


if __name__ == "__main__":
    import gradio as gr
    threading.Thread(target=_warm, daemon=True).start()
    with gr.Blocks() as demo:
        gr.Markdown("Nova Media Studio — image / speech / video for Nova's make_media tool.")
        box = gr.Textbox(visible=False)
        out = gr.Textbox(visible=False)
        for name, fn in (("image", api_image), ("speech", api_speech), ("video", api_video)):
            gr.Button(name, visible=False).click(fn, box, out, api_name=name)
        gr.Button("status", visible=False).click(api_status, None, out, api_name="status")
    demo.queue(default_concurrency_limit=4).launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)), show_error=True)
