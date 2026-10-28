"""
Nova Media Studio — image, speech, and native text-to-video inference on CPU only.

  image   a distilled one-step diffusion model (SDXS-512)
  speech  Piper (ONNX), Arabic voice
  video   AnimateDiff-Lightning text-to-video diffusion on CPU (open weights, ~3 GB, 8 fps, 1-2 s clips); never a slideshow

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
_MODELS = {"pipe": None, "voice": None, "root": None}


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


# --- cpu_video BEGIN (byte-identical in colab/sham_small/cpu_video.py and modelscope-media/app.py; a test keeps the copies in sync) ---
# Real text-to-video on CPU: AnimateDiff-Lightning (motion adapter, 4 steps) on an SD-1.5 realistic base (epiCRealism). Open weights (CreativeML OpenRAIL-M),
# about 3 GB on disk, run by our own process. The frames come out of one temporal diffusion pass (never stills stitched into a slideshow).
_CV = {"pipe": None, "dtype": None}
CV_MS_BASE, CV_HF_BASE = "songkey/epicrealism_naturalSinRC1VAE", "emilianJR/epiCRealism"
CV_MS_ADAPTER, CV_HF_ADAPTER, CV_ADAPTER_FILE = "AI-ModelScope/AnimateDiff-Lightning", "ByteDance/AnimateDiff-Lightning", "animatediff_lightning_4step_diffusers.safetensors"
_CV_BASE_FILES = ["model_index.json", "scheduler/scheduler_config.json", "feature_extractor/preprocessor_config.json", "tokenizer/*", "text_encoder/config.json",
                  "unet/config.json", "vae/config.json", "text_encoder/*.safetensors", "unet/*.safetensors", "vae/*.safetensors"]


def cv_profile(cpus: int | None = None) -> dict:
    """Frame size / frame count that a CPU can finish in about a minute or two: 512px x 16 frames with 6+ cores, 384px x 8 frames with fewer. CPU_VIDEO_SIDE / CPU_VIDEO_FRAMES override."""
    import os as _os
    n = int(cpus or _os.cpu_count() or 2)
    side = int(_os.environ.get("CPU_VIDEO_SIDE", "") or (512 if n >= 6 else 384))
    frames = int(_os.environ.get("CPU_VIDEO_FRAMES", "") or (16 if n >= 6 else 8))
    return {"side": max(256, min(512, side // 8 * 8)), "max_frames": max(8, min(16, frames)), "threads": max(1, n), "fps": 8}


def cv_dtype():
    """bfloat16 when this CPU has native bf16 (AVX512-BF16 / AMX): half the RAM and ~3x faster; float32 otherwise."""
    import torch
    try:
        flags = open("/proc/cpuinfo", encoding="utf-8").read()
    except OSError:
        flags = ""
    forced = __import__("os").environ.get("CPU_VIDEO_DTYPE", "").lower()
    if forced in ("float32", "fp32"):
        return torch.float32
    if forced in ("bfloat16", "bf16") or "avx512_bf16" in flags or "amx_bf16" in flags:
        return torch.bfloat16
    return torch.float32


def cv_find_weights(root, env_names=("CPU_VIDEO_MODEL_DIR",)):
    """(base_dir, adapter_file) when the weights are already on disk: an env dir, or <root>/video_animatediff/{base,adapter/...}. Else None."""
    import os as _os
    from pathlib import Path as _P
    cands = [_P(_os.environ[n]).expanduser() for n in env_names if _os.environ.get(n, "").strip()] + [_P(root) / "video_animatediff"]
    for c in cands:
        base, ad = c / "base", c / "adapter" / CV_ADAPTER_FILE
        if (base / "model_index.json").is_file() and ad.is_file() and any((base / "unet").glob("*.safetensors")):
            return base, ad
    return None


CV_HF_LEAN_BASE = "stable-diffusion-v1-5/stable-diffusion-v1-5"      # the same SD-1.5 family, published with fp16 files: ~2.1 GB instead of 4.3 GB
_CV_LEAN_FILES = ["model_index.json", "scheduler/scheduler_config.json", "feature_extractor/preprocessor_config.json", "tokenizer/*", "text_encoder/config.json",
                  "unet/config.json", "vae/config.json", "text_encoder/model.fp16.safetensors", "unet/diffusion_pytorch_model.fp16.safetensors", "vae/diffusion_pytorch_model.fp16.safetensors"]
CV_FULL_NEED, CV_LEAN_NEED = 6 * 1024 ** 3, int(3.05 * 1024 ** 3)


def cv_fetch_weights(root):
    """Download the (open) weights once into <root>/video_animatediff. epiCRealism (fp16-sized files, ~2.1 GB) + the 0.9 GB adapter from ModelScope (~2.9 GiB in total); Hugging Face is the fallback (with a small disk: the fp16 SD-1.5 base). Weights only; all inference stays local."""
    import shutil as _sh
    from pathlib import Path as _P
    dest = _P(root) / "video_animatediff"
    dest.mkdir(parents=True, exist_ok=True)
    free = _sh.disk_usage(dest).free
    if free < CV_LEAN_NEED:
        raise RuntimeError(f"native-video-unavailable: the video model needs about 3 GiB free disk; only {free / 1024 ** 3:.1f} GiB is free")
    lean = free < CV_FULL_NEED
    errors = []
    for source in ("modelscope", "huggingface"):          # ModelScope first: epiCRealism there is already fp16-sized (unet 1.72 GB), ~2.9 GiB with the adapter; the Studios cannot always reach Hugging Face
        try:
            if source == "modelscope":
                from modelscope import snapshot_download
                snapshot_download(CV_MS_BASE, local_dir=str(dest / "base"), allow_patterns=_CV_BASE_FILES)
                snapshot_download(CV_MS_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
            else:
                from huggingface_hub import snapshot_download as hf_download
                hf_download(CV_HF_LEAN_BASE if lean else CV_HF_BASE, local_dir=str(dest / "base"), allow_patterns=_CV_LEAN_FILES if lean else _CV_BASE_FILES)
                if lean:                                            # the adapter is the same file on ModelScope; use it first, it is closer to the Studio
                    try:
                        from modelscope import snapshot_download
                        snapshot_download(CV_MS_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
                    except Exception:  # noqa: BLE001
                        hf_download(CV_HF_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
                else:
                    hf_download(CV_HF_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
            found = cv_find_weights(root)
            if found:
                return found
            errors.append(f"{source}: files incomplete")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source}: {type(exc).__name__}: {str(exc)[:120]}")
    raise RuntimeError("native-video-unavailable: could not fetch the video weights (" + "; ".join(errors) + ")")


def cv_pipe(root, env_names=("CPU_VIDEO_MODEL_DIR",)):
    if _CV["pipe"] is not None:
        return _CV["pipe"]
    import torch
    from diffusers import AnimateDiffPipeline, EulerDiscreteScheduler, MotionAdapter
    from safetensors.torch import load_file
    base, adapter = cv_find_weights(root, env_names) or cv_fetch_weights(root)
    prof = cv_profile()
    torch.set_num_threads(prof["threads"])
    dtype = cv_dtype()
    fp16_files = any((base / "unet").glob("*.fp16.safetensors"))
    # built with bfloat16 as the default dtype so the random-init step never holds a float32 copy (peak ~6 GB instead of ~11 GB); a CPU without native bf16 is upcast afterwards
    old = torch.get_default_dtype()
    torch.set_default_dtype(torch.bfloat16)
    try:
        motion = MotionAdapter()
        motion.load_state_dict(load_file(str(adapter)))
        pipe = AnimateDiffPipeline.from_pretrained(str(base), motion_adapter=motion, torch_dtype=torch.bfloat16, variant="fp16" if fp16_files else None,
                                                   safety_checker=None, local_files_only=True)
    finally:
        torch.set_default_dtype(old)
    if dtype != torch.bfloat16:
        pipe.to(dtype=dtype)
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing", beta_schedule="linear")
    pipe.vae.to(dtype=torch.float32)       # the decoder runs in float32: a bfloat16 decode left a coloured stripe in single frames
    _decode = pipe.vae.decode
    pipe.vae.decode = lambda z, *a, **k: _decode(z.to(torch.float32), *a, **k)
    pipe.vae.enable_slicing()
    pipe.enable_attention_slicing()
    pipe.to("cpu")
    _CV["pipe"], _CV["dtype"] = pipe, dtype
    return pipe


def cv_release():
    """Free the pipeline's RAM (the Studio also holds a text model). CPU_VIDEO_KEEP=1 keeps it loaded between requests."""
    import gc
    _CV["pipe"] = None
    gc.collect()


def cv_encode_mp4(frames, fps: int = 8) -> bytes:
    """H.264 MP4 of the generated frames (ffmpeg from imageio-ffmpeg or PATH)."""
    import shutil as _sh
    import subprocess as _sp
    import tempfile as _tf
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        exe = _sh.which("ffmpeg")
    if not exe:
        raise RuntimeError("native-video-unavailable: ffmpeg is not installed (pip install imageio-ffmpeg)")
    with _tf.TemporaryDirectory() as d:
        for i, f in enumerate(frames):
            f.save(f"{d}/f{i:03d}.png")
        out = f"{d}/out.mp4"
        _sp.run([exe, "-y", "-v", "error", "-framerate", str(fps), "-i", f"{d}/f%03d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
                check=True, timeout=120)
        with open(out, "rb") as fh:
            return fh.read()


def cv_generate(root, prompt: str, seconds: float = 2.0, seed: int = 0, env_names=("CPU_VIDEO_MODEL_DIR",)) -> bytes:
    """Prompt -> MP4 bytes. 8 fps; frames = seconds x 8 within the CPU profile's limit."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    import torch
    prof = cv_profile()
    pipe = cv_pipe(root, env_names)
    frames = max(8, min(prof["max_frames"], int(round(float(seconds or 2) * prof["fps"]))))
    keep = __import__("os").environ.get("CPU_VIDEO_KEEP", "") == "1"
    # The sampling result stays as latents; unless the pipeline is kept, the UNet and text encoder (~2 GB) are dropped BEFORE the float32 VAE decode, and the frames are decoded one at a time.
    # (The Sham v2 Studio holds a text model too, with ~1.4 GB RAM free: the all-in-one decode killed the Studio right after the 4 sampling steps: 502.)
    out = pipe(prompt=prompt[:300], guidance_scale=1.0, num_inference_steps=4, num_frames=frames, height=prof["side"], width=prof["side"],
               generator=torch.Generator(device="cpu").manual_seed(int(seed)), output_type="latent")
    latents = out.frames
    del out
    if not keep:
        import gc
        pipe.unet = None
        pipe.text_encoder = None
        gc.collect()
    with torch.inference_mode():
        video = pipe.decode_latents(latents, decode_chunk_size=1)
        pil_frames = pipe.video_processor.postprocess_video(video=video, output_type="pil")[0]
    del video, latents
    data = cv_encode_mp4(pil_frames, prof["fps"])
    if not keep:
        del pipe
        cv_release()
    return data
# --- cpu_video END ---


def _make_video(prompt: str, seconds: float, seed: int = 0) -> bytes:
    """Real text-to-video on CPU (AnimateDiff-Lightning): one temporal diffusion pass, never stills stitched into a video. Weights live under HERE/video_animatediff."""
    return cv_generate(HERE, prompt, seconds, seed, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))


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


def _disk() -> dict:
    """The Studio's disk in GiB (total / used / free of the volume that holds the weights), for the capacity audit."""
    try:
        d = shutil.disk_usage(HERE)
        return {"total_gb": round(d.total / 2 ** 30, 2), "used_gb": round(d.used / 2 ** 30, 2), "free_gb": round(d.free / 2 ** 30, 2)}
    except OSError:
        return {}


def api_status() -> str:
    ready = bool(_CV["pipe"] is not None or cv_find_weights(HERE, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR")))
    return json.dumps({
        **STATE, "repo": REPO, "cpus": os.cpu_count(), "disk": _disk(),
        "video": {"engine": "AnimateDiff-Lightning", "ready": ready, "device": "cpu", "gpu_required": False, "profile": cv_profile(),
                  "mode": "native-diffusion-only", "note": "weights are fetched once on the first video request; 8 fps, 1-2 s clips"},
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
