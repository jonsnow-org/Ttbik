"""
Nova Media Studio — image, speech, and native text-to-video inference on CPU only.

  image   a distilled one-step diffusion model (SDXS-512)
  speech  Piper (ONNX), Arabic voice
  video   Wan2.1 text-to-video diffusion on CPU; deliberately low-resolution/short output because CPU inference is slow; never a slideshow

One job at a time (a busy Studio answers {"type": "busy"} at once instead of queueing: the caller decides). The models are downloaded from modelscope.cn
(this Studio cannot reach huggingface.co or github.com): MEDIA_MODEL_REPO (default novaai2026/nova-media-models) holds  sdxs/  and  piper/ar_JO-kareem-medium.onnx(+.json).

Gradio API (same call protocol as the coder Studio):  /gradio_api/call/{image,speech,video,status}  — each takes one JSON string and answers one JSON string.
  image   {"prompt": "...", "size": 512, "seed": 0}                      -> {"type":"image","b64":"<png>"}
  speech  {"text": "..."}                                               -> {"type":"audio","b64":"<wav>"}
  video   {"prompt": "...", "seconds": 3, "seed": 0}                    -> {"type":"video","b64":"<mp4>"}
"""
import base64
import io
import json
import os
import subprocess
import shutil
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


# --- media_quality BEGIN (identical copy in ai-system/modelscope-media/app.py; keep in sync) ---
import base64 as _b64
import io as _io
import subprocess as _sp
import tempfile as _tf
import wave as _wave

MIN_STD = 8.0            # 0..255 grey-level standard deviation below which a picture is "constant"
MIN_RANGE = 24           # max - min grey level
MIN_NEIGHBOUR_CORR = 0.15  # natural pictures: ~0.8-0.99; white noise: ~0
MIN_AUDIO_SECONDS = 0.2
MIN_AUDIO_PEAK = 0.01    # of full scale
MIN_VIDEO_BYTES = 1024


class MediaQualityError(ValueError):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


def _gray(img):
    """PIL image / ndarray / PNG|JPEG bytes -> float grey array (H, W) in 0..255. Raises invalid_image."""
    import numpy as np
    try:
        if isinstance(img, (bytes, bytearray)):
            from PIL import Image
            img = Image.open(_io.BytesIO(bytes(img)))
            img.load()
        if hasattr(img, "convert"):
            arr = np.asarray(img.convert("RGB"), dtype="float64")
        else:
            arr = np.asarray(img, dtype="float64")
            if arr.ndim == 3 and arr.shape[0] in (1, 3) and arr.shape[-1] not in (1, 3):
                arr = arr.transpose(1, 2, 0)
    except Exception as exc:  # noqa: BLE001
        raise MediaQualityError("invalid_image", f"{type(exc).__name__}") from exc
    if arr.size == 0 or arr.ndim < 2:
        raise MediaQualityError("invalid_image", "empty image")
    if not np.isfinite(arr).all():
        raise MediaQualityError("invalid_image", "NaN/Inf pixels")
    return arr.mean(axis=2) if arr.ndim == 3 else arr


def check_image(img, *, min_std: float = MIN_STD, reject_noise: bool = True) -> dict:
    """Raise MediaQualityError unless the picture has real content; returns its stats."""
    import numpy as np
    g = _gray(img)
    std, lo, hi, mean = float(g.std()), float(g.min()), float(g.max()), float(g.mean())
    stats = {"mean": round(mean, 1), "std": round(std, 1), "min": lo, "max": hi}
    if std < min_std or (hi - lo) < MIN_RANGE:
        raise MediaQualityError("blank_image", f"std={std:.1f} range={hi - lo:.0f} mean={mean:.0f}")
    if reject_noise and g.shape[0] >= 8 and g.shape[1] >= 8:
        def corr(a, b):
            a, b = a.ravel() - a.mean(), b.ravel() - b.mean()
            d = float(np.sqrt((a * a).sum() * (b * b).sum()))
            return float((a * b).sum() / d) if d else 0.0
        c = min(corr(g[:, :-1], g[:, 1:]), corr(g[:-1, :], g[1:, :]))
        stats["neighbour_corr"] = round(c, 3)
        if c < MIN_NEIGHBOUR_CORR:
            raise MediaQualityError("noise_image", f"neighbour_corr={c:.2f}")
    return stats


def check_wav(data: bytes) -> dict:
    """Raise MediaQualityError unless the WAV has audible, non-constant samples of a sensible length."""
    import numpy as np
    if not data or len(data) < 64:
        raise MediaQualityError("silent_audio", "empty audio")
    try:
        with _wave.open(_io.BytesIO(data), "rb") as w:
            n, rate, width, ch = w.getnframes(), w.getframerate(), w.getsampwidth(), w.getnchannels()
            raw = w.readframes(n)
    except Exception as exc:  # noqa: BLE001
        raise MediaQualityError("invalid_audio", type(exc).__name__) from exc
    if n <= 0 or rate <= 0 or n / rate < MIN_AUDIO_SECONDS:
        raise MediaQualityError("silent_audio", f"{n} frames at {rate} Hz")
    if width == 2:
        x = np.frombuffer(raw, dtype="<i2").astype("float64") / 32768.0
    elif width == 1:
        x = (np.frombuffer(raw, dtype="u1").astype("float64") - 128.0) / 128.0
    elif width == 4:
        x = np.frombuffer(raw, dtype="<i4").astype("float64") / 2147483648.0
    else:
        raise MediaQualityError("invalid_audio", f"sample width {width}")
    if x.size == 0 or not np.isfinite(x).all():
        raise MediaQualityError("invalid_audio", "NaN/Inf samples")
    peak, std = float(np.abs(x).max()), float(x.std())
    if peak < MIN_AUDIO_PEAK or std < MIN_AUDIO_PEAK / 4:
        raise MediaQualityError("silent_audio", f"peak={peak:.4f} std={std:.5f}")
    return {"seconds": round(n / rate, 2), "peak": round(peak, 3), "channels": ch}


def _mp4_boxes(data: bytes) -> set:
    names, i = set(), 0
    while i + 8 <= len(data) and len(names) < 32:
        size = int.from_bytes(data[i:i + 4], "big")
        names.add(data[i + 4:i + 8])
        if size == 1 and i + 16 <= len(data):
            size = int.from_bytes(data[i + 8:i + 16], "big")
        if size < 8:
            break
        i += size
    return names


def check_mp4(data: bytes, *, decode: bool = True) -> dict:
    """Structure check always (ftyp + moov + mdat, not tiny); when ffmpeg is available also decode a few frames and require real, non-blank, changing frames."""
    if not data or len(data) < MIN_VIDEO_BYTES:
        raise MediaQualityError("empty_video", f"{len(data or b'')} bytes")
    boxes = _mp4_boxes(data)
    if b"ftyp" not in boxes or b"moov" not in boxes or b"mdat" not in boxes:
        raise MediaQualityError("empty_video", "not a complete MP4 (ftyp/moov/mdat)")
    info = {"bytes": len(data), "decoded": False}
    if not decode:
        return info
    try:
        import numpy as np
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:  # noqa: BLE001
            import shutil
            exe = shutil.which("ffmpeg")
        if not exe:
            return info
        with _tf.TemporaryDirectory() as d:
            src = d + "/in.mp4"
            with open(src, "wb") as fh:
                fh.write(data)
            side = 64
            out = _sp.run([exe, "-v", "error", "-i", src, "-vf", f"scale={side}:{side}", "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                          capture_output=True, timeout=90).stdout
        frames = np.frombuffer(out, dtype="u1").reshape(-1, side, side).astype("float64") if len(out) >= side * side else None
    except Exception:  # noqa: BLE001  (a broken decoder is not proof the clip is bad: the structure check above stands)
        return info
    if frames is None or len(frames) < 2:
        raise MediaQualityError("empty_video", "fewer than 2 decodable frames")
    info.update(decoded=True, frames=int(len(frames)))
    blank = [f for f in frames if f.std() < 2.0 or (f.max() - f.min()) < 12]
    if len(blank) == len(frames):
        raise MediaQualityError("static_video", "every frame is blank")
    if float(np.abs(frames[1:] - frames[:-1]).mean()) < 0.05:
        raise MediaQualityError("static_video", "all frames are identical (no motion)")
    return info


_MESSAGES = {
    "blank_image": "لم يُنشئ النموذج صورة صالحة (النتيجة فارغة/سوداء). لم تُرسَل أي صورة. / The model produced a blank image; nothing was sent.",
    "noise_image": "النتيجة ضجيج عشوائي وليست صورة؛ النموذج غير جاهز لهذا الطلب. / The output is pixel noise, not a picture; the model is not ready for this.",
    "invalid_image": "الصورة الناتجة غير صالحة. / The generated image is invalid.",
    "silent_audio": "لم يُنشئ النموذج صوتاً مسموعاً (فارغ/صامت). / The model produced empty or silent audio.",
    "invalid_audio": "الصوت الناتج غير صالح. / The generated audio is invalid.",
    "empty_video": "لم يُنشئ النموذج فيديو صالحاً (فارغ/غير مكتمل). / The model produced an empty or incomplete video.",
    "static_video": "الفيديو الناتج فارغ أو ثابت بلا حركة. / The video is blank or has no motion.",
}


def quality_error(reason: str, detail: str = "") -> dict:
    return {"type": "error", "reason": reason, "text": _MESSAGES.get(reason, reason), **({"detail": detail[:160]} if detail else {})}


def gate_reply(reply):
    """The one chokepoint for a media reply dict {"type": image|audio|video, "b64": ...}: returns it unchanged when it passes, else a typed error.
    Non-media replies (text, notice, busy, error, ...) and replies that are already errors pass through untouched."""
    if not isinstance(reply, dict) or reply.get("type") not in ("image", "audio", "video"):
        return reply
    kind = reply["type"]
    keep = {k: reply[k] for k in ("backend", "route") if k in reply}
    try:
        raw = _b64.b64decode(str(reply.get("b64") or "").split(",")[-1], validate=False)
        if kind == "image":
            check_image(raw)
        elif kind == "audio":
            check_wav(raw)
        else:
            check_mp4(raw)
    except MediaQualityError as exc:
        return {**quality_error(exc.reason, exc.detail), **keep}
    except Exception as exc:  # noqa: BLE001
        return {**quality_error({"image": "invalid_image", "audio": "invalid_audio", "video": "empty_video"}[kind], type(exc).__name__), **keep}
    return reply


def classify_exception(exc: BaseException) -> str:
    """One stable reason code for a generation failure (busy / disk / untrained / timeout / unavailable / failed) instead of an opaque string."""
    s = f"{type(exc).__name__}: {exc}".lower()
    if isinstance(exc, MediaQualityError):
        return exc.reason
    if "timeout" in s or "timed out" in s:
        return "timeout"
    if "disk" in s or "no space" in s or "free disk" in s:
        return "disk"
    if "native-video-unavailable" in s or "weights not found" in s or "not found" in s and "model" in s:
        return "unavailable"
    if "untrained" in s:
        return "untrained"
    if "busy" in s:
        return "busy"
    return "failed"
# --- media_quality END ---


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
    """Load Nova's own local Wan checkpoint and run its temporal diffusion on CPU only."""
    if _MODELS["video_pipe"] is not None:
        return _MODELS["video_pipe"]
    import torch
    torch.set_num_threads(max(1, min(os.cpu_count() or 2, 4)))
    local_dir = os.environ.get("NOVA_VIDEO_MODEL_DIR", "").strip()
    if local_dir:
        model_dir = Path(local_dir).expanduser().resolve()
    else:
        # Wan's full Diffusers snapshot is about 17.6 GB; refuse before download if this CPU host cannot store it.
        free_bytes = shutil.disk_usage(HERE).free
        required_bytes = 20 * (1024 ** 3)
        if free_bytes < required_bytes:
            raise RuntimeError(
                f"native-video-unavailable: CPU mode needs at least 20 GiB free disk for local Wan weights; "
                f"only {free_bytes / (1024 ** 3):.1f} GiB is free. Set NOVA_VIDEO_MODEL_DIR to an existing local checkpoint."
            )
        # Retrieve weights only. All prompts and inference remain inside Nova's own process.
        from modelscope import snapshot_download
        model_dir = Path(snapshot_download(
            "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            cache_dir=str(HERE / "_video_models"),
        ))
    if not model_dir.is_dir() or not (model_dir / "model_index.json").is_file():
        raise RuntimeError(f"native-video-unavailable: local Diffusers checkpoint not found at {model_dir}")
    from diffusers import WanPipeline
    pipe = WanPipeline.from_pretrained(
        str(model_dir),
        torch_dtype=torch.float32,
        local_files_only=True,
    )
    pipe.to("cpu")
    _MODELS["video_pipe"] = pipe
    _MODELS["video_root"] = str(model_dir)
    return pipe


def _make_video(prompt: str, seconds: float, seed: int = 0) -> bytes:
    """Generate real temporal motion with Wan on CPU; never assemble generated still images into a video."""
    import torch
    from diffusers.utils import export_to_video
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    # CPU-safe starter settings: short, low-resolution clips. Runtime can be long on 2-vCPU hosts.
    seconds = max(1.0, min(2.0, float(seconds or 2)))
    frames = 9 if seconds <= 1.5 else 13
    pipe = _video_pipe()
    generator = torch.Generator(device="cpu").manual_seed(int(seed))
    result = pipe(
        prompt=prompt[:800],
        height=256,
        width=256,
        num_frames=frames,
        num_inference_steps=2,
        guidance_scale=3.0,
        generator=generator,
    )
    video_frames = result.frames[0]
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "nova-native-video.mp4"
        export_to_video(video_frames, str(target), fps=8)
        return target.read_bytes()


def _run(kind: str, payload: dict) -> dict:
    if not _LOCK.acquire(blocking=False):
        return {"type": "busy"}
    t0 = time.time()
    try:
        STATE["phase"] = f"making {kind}"
        if kind == "image":
            img = _make_image(str(payload.get("prompt", "")), payload.get("size", 512), payload.get("seed", 0))
            check_image(img)                                       # a black / constant / noise picture is an error, never a reply
            out = {"type": "image", "b64": base64.b64encode(_png(img)).decode()}
        elif kind == "speech":
            wav = _speech_wav(str(payload.get("text", "")))
            check_wav(wav)                                         # empty or silent audio is an error
            out = {"type": "audio", "b64": base64.b64encode(wav).decode()}
        else:
            prompt = str(payload.get("prompt", "")).strip()
            clip = _make_video(prompt, payload.get("seconds", 3), payload.get("seed", 0))
            check_mp4(clip)                                        # an empty / frozen video is an error
            out = {"type": "video", "b64": base64.b64encode(clip).decode(), "text": prompt[:120]}
        STATE[{"image": "images", "speech": "speech", "video": "videos"}[kind]] += 1
        STATE["last_s"] = round(time.time() - t0, 1)
        return out
    except Exception as e:                                                    # noqa: BLE001
        traceback.print_exc()
        STATE["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        if isinstance(e, MediaQualityError):
            return quality_error(e.reason, e.detail)
        return {"type": "error", "reason": classify_exception(e), "text": STATE["error"]}
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
    cached_video = bool(_MODELS.get("video_root") and Path(_MODELS["video_root"]).is_dir())
    configured_video = bool(video_dir and Path(video_dir).is_dir() and (Path(video_dir) / "model_index.json").is_file())
    return json.dumps({
        **STATE, "repo": REPO, "cpus": os.cpu_count(),
        "video": {"engine": "WanPipeline", "ready": bool(_MODELS.get("video_pipe") or cached_video or configured_video),
                  "device": "cpu", "gpu_required": False, "model_dir_configured": bool(video_dir),
                  "mode": "native-diffusion-only", "note": "CPU inference is slow; short low-resolution clips are used"},
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
