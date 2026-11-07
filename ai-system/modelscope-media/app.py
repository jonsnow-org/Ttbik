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


def _store() -> Path:
    """Weights go under /mnt/workspace, the only folder ModelScope keeps across a Studio restart (falls back to the local folder when it is not writable)."""
    base = Path(os.environ.get("MEDIA_PERSIST_DIR", "/mnt/workspace")) / "media-models"
    try:
        base.mkdir(parents=True, exist_ok=True)
        probe = base / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        import shutil
        if shutil.disk_usage(base).free < 7 * 1024 ** 3 and not any(base.iterdir()):
            return HERE / "_models"                         # not enough room for the weights (~5 GB): keep the old local folder
        return base
    except Exception:                                       # noqa: BLE001
        return HERE / "_models"


MODEL_STORE = _store()
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


def check_mp4(
    data: bytes, *, decode: bool = True, expected_seconds: float | None = None,
    min_width: int = 0, min_height: int = 0,
) -> dict:
    """Validate the MP4 container, requested runtime, actual resolution, decodable frames and real motion."""
    if not data or len(data) < MIN_VIDEO_BYTES:
        raise MediaQualityError("empty_video", f"{len(data or b'')} bytes")
    boxes = _mp4_boxes(data)
    if b"ftyp" not in boxes or b"moov" not in boxes or b"mdat" not in boxes:
        raise MediaQualityError("empty_video", "not a complete MP4 (ftyp/moov/mdat)")
    info = {"bytes": len(data), "decoded": False}
    if not decode:
        if expected_seconds is not None or min_width or min_height:
            raise MediaQualityError(
                "video_validation_unavailable",
                "duration and resolution checks require actual ffmpeg decoding",
            )
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
            raise MediaQualityError("video_validation_unavailable", "ffmpeg decoder is not installed")
        with _tf.TemporaryDirectory() as d:
            src = d + "/in.mp4"
            with open(src, "wb") as fh:
                fh.write(data)
            side = 64
            decoded = _sp.run(
                [exe, "-hide_banner", "-i", src, "-vf", f"scale={side}:{side}",
                 "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                capture_output=True, timeout=90,
            )
        diagnostic = (decoded.stderr or b"").decode("utf-8", "replace")
        if decoded.returncode != 0:
            raise MediaQualityError("empty_video", "ffmpeg could not decode the MP4: " + diagnostic[-180:])
        meta_duration = __import__("re").search(r"Duration:\s*(\d+):(\d+):([\d.]+)", diagnostic)
        video_line = next((line for line in diagnostic.splitlines() if "Video:" in line), "")
        meta_size = __import__("re").search(r"(\d{2,5})x(\d{2,5})", video_line)
        if meta_duration:
            actual_seconds = int(meta_duration.group(1)) * 3600 + int(meta_duration.group(2)) * 60 + float(meta_duration.group(3))
            info["duration_seconds"] = round(actual_seconds, 2)
        if expected_seconds is not None:
            if not meta_duration:
                raise MediaQualityError("video_validation_unavailable", "ffmpeg could not read the video duration")
            if abs(actual_seconds - float(expected_seconds)) > 0.30:
                raise MediaQualityError("duration_mismatch", f"requested={float(expected_seconds):g}s actual={actual_seconds:.2f}s")
        if meta_size:
            width, height = int(meta_size.group(1)), int(meta_size.group(2))
            info.update(width=width, height=height)
        if min_width or min_height:
            if not meta_size:
                raise MediaQualityError("video_validation_unavailable", "ffmpeg could not read the video dimensions")
            if width < int(min_width) or height < int(min_height):
                raise MediaQualityError("low_resolution", f"actual={width}x{height} minimum={int(min_width)}x{int(min_height)}")
        out = decoded.stdout or b""
        if len(out) < side * side or len(out) % (side * side):
            raise MediaQualityError("empty_video", "ffmpeg returned incomplete or fewer than one decoded frame")
        frames = np.frombuffer(out, dtype="u1").reshape(-1, side, side).astype("float64")
    except MediaQualityError:
        # Never swallow duration_mismatch / low_resolution / invalid-video decisions.
        raise
    except Exception as exc:  # noqa: BLE001
        raise MediaQualityError(
            "video_validation_unavailable",
            f"ffmpeg could not verify the video: {type(exc).__name__}: {str(exc)[:140]}",
        ) from exc

    if frames is None or len(frames) < 2:
        raise MediaQualityError("empty_video", "fewer than 2 decodable frames")
    info.update(decoded=True, frames=int(len(frames)))
    blank = [f for f in frames if f.std() < 2.0 or (f.max() - f.min()) < 12]
    if len(blank) == len(frames):
        raise MediaQualityError("static_video", "every frame is blank")
    # Motion = change that is NOT a brightness shift: each frame's mean is removed first, so a clip whose only change is lighting (a flicker/fade) counts as static.
    centred = frames - frames.mean(axis=(1, 2), keepdims=True)
    if float(np.abs(centred[1:] - centred[:-1]).mean()) < 0.35:
        raise MediaQualityError("static_video", "no real motion (only lighting changes or identical frames)")
    return info


_MESSAGES = {
    "blank_image": "لم يُنشئ النموذج صورة صالحة (النتيجة فارغة/سوداء). لم تُرسَل أي صورة. / The model produced a blank image; nothing was sent.",
    "noise_image": "النتيجة ضجيج عشوائي وليست صورة؛ النموذج غير جاهز لهذا الطلب. / The output is pixel noise, not a picture; the model is not ready for this.",
    "invalid_image": "الصورة الناتجة غير صالحة. / The generated image is invalid.",
    "silent_audio": "لم يُنشئ النموذج صوتاً مسموعاً (فارغ/صامت). / The model produced empty or silent audio.",
    "invalid_audio": "الصوت الناتج غير صالح. / The generated audio is invalid.",
    "empty_video": "لم يُنشئ النموذج فيديو صالحاً (فارغ/غير مكتمل). / The model produced an empty or incomplete video.",
    "static_video": "الفيديو الناتج فارغ أو ثابت بلا حركة. / The video is blank or has no motion.",
    "duration_mismatch": "مدة الفيديو الناتج لا تطابق المدة المطلوبة؛ لم يتم إرسال المقطع. / Generated video duration did not match the requested duration.",
    "low_resolution": "دقة الفيديو الناتج أقل من الحد المطلوب؛ لم يتم إرسال المقطع. / Generated video resolution is below the required minimum.",
    "video_validation_unavailable": "تعذّر التحقق من مدة الفيديو ودقته؛ لم يتم إرسال المقطع. / Video duration and resolution could not be verified."
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
    from modelscope_hub.compat import snapshot_download
    token = _token().strip() or None
    try:
        _MODELS["root"] = Path(snapshot_download(REPO, cache_dir=str(MODEL_STORE), token=token))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"ModelScope media repository access failed for {REPO}: "
            f"{type(exc).__name__}: {str(exc)[:300]}"
        ) from exc
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


def _make_image_local(prompt: str, size: int, seed: int):
    import torch
    size = max(256, min(768, int(size) // 64 * 64))
    gen = torch.Generator().manual_seed(int(seed))
    return _pipe()(prompt[:400], num_inference_steps=1, guidance_scale=0.0, height=size, width=size, generator=gen).images[0]


# Pictures are made by a long-lived worker PROCESS, so the parent never holds torch weights: before a video clip the worker is stopped and the
# whole 8 GB is free for AnimateDiff (live 2026-11-04: after a picture made in the parent, the clip was killed -9). The next picture restarts it.
_IMG = {"proc": None, "conn": None}
_IMG_LOCK = threading.Lock()


def _image_worker(conn) -> None:
    while True:
        try:
            req = conn.recv()
        except EOFError:
            return
        try:
            if req.get("warm"):
                _pipe()
                conn.send({"ok": True})
                continue
            conn.send({"png": _png(_make_image_local(req["prompt"], req["size"], req["seed"]))})
        except BaseException as exc:  # noqa: BLE001
            traceback.print_exc()
            conn.send({"err": f"{type(exc).__name__}: {str(exc)[:400]}"})


def _image_call(req: dict, timeout: float = 400.0) -> dict:
    import multiprocessing as _mp
    with _IMG_LOCK:
        proc = _IMG["proc"]
        if proc is None or not proc.is_alive():
            ctx = _mp.get_context("spawn")
            parent, child = ctx.Pipe()
            proc = ctx.Process(target=_image_worker, args=(child,), daemon=True)
            proc.start()
            _IMG["proc"], _IMG["conn"] = proc, parent
        conn = _IMG["conn"]
        conn.send(req)
        if not conn.poll(timeout):
            _stop_image_worker_locked()
            raise TimeoutError(f"picture timed out after {int(timeout)}s")
        try:
            out = conn.recv()
        except EOFError as exc:
            _stop_image_worker_locked()
            raise RuntimeError(f"the picture process ended with code {proc.exitcode} (killed: out of memory?)") from exc
    if out.get("err"):
        raise RuntimeError(out["err"])
    return out


def _stop_image_worker_locked() -> None:
    proc, conn = _IMG["proc"], _IMG["conn"]
    _IMG["proc"] = _IMG["conn"] = None
    try:
        if conn is not None:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    if proc is not None and proc.is_alive():
        proc.kill()
        proc.join(10)


def _stop_image_worker() -> None:
    with _IMG_LOCK:
        _stop_image_worker_locked()


def _make_image(prompt: str, size: int, seed: int):
    if os.environ.get("NOVA_IMAGE_SUBPROCESS", "1") == "0":
        return _make_image_local(prompt, size, seed)
    from PIL import Image
    img = Image.open(io.BytesIO(_image_call({"prompt": str(prompt), "size": int(size), "seed": int(seed)})["png"]))
    img.load()
    return img


# --- cpu_video BEGIN (byte-identical in colab/sham_small/cpu_video.py and modelscope-media/app.py; a test keeps the copies in sync) ---
# Real text-to-video on CPU: AnimateDiff-Lightning (motion adapter, 4 steps) on an SD-1.5 realistic base (epiCRealism). Open weights (CreativeML OpenRAIL-M),
# about 3 GB on disk, run by our own process. The frames come out of one temporal diffusion pass (never stills stitched into a slideshow).
_CV = {"pipe": None, "dtype": None}
CV_MS_BASE = "songkey/epicrealism_naturalSinRC1VAE"
CV_MS_ADAPTER, CV_ADAPTER_FILE = "AI-ModelScope/AnimateDiff-Lightning", "animatediff_lightning_4step_diffusers.safetensors"
_CV_BASE_FILES = ["model_index.json", "scheduler/scheduler_config.json", "feature_extractor/preprocessor_config.json", "tokenizer/*", "text_encoder/config.json",
                  "unet/config.json", "vae/config.json", "text_encoder/*.safetensors", "unet/*.safetensors", "vae/*.safetensors"]


def cv_profile(cpus: int | None = None) -> dict:
    """The installed CPU profile produces 16 frames for a 2 s clip or 32 frames for 4 s at 8 fps.
    It keeps the diffusion grid at native 512x512; it does not claim longer durations or upscale a 256px generation."""
    import os as _os
    n = int(cpus or _os.cpu_count() or 2)
    # Keep the real generation grid at 512 px; upscaling a 256 px diffusion result hid detail rather than creating it.
    side = int(_os.environ.get("CPU_VIDEO_SIDE", "") or 512)
    frames = int(_os.environ.get("CPU_VIDEO_FRAMES", "") or 32)
    return {"side": max(512, min(512, side // 8 * 8)), "max_frames": max(16, min(32, frames)), "threads": max(1, n), "fps": 8, "out_side": 512}


def cv_dtype():
    """Use BF16 when the CPU advertises native AVX512-BF16/AMX support; otherwise use FP32."""
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


CV_REQUIRED_FREE = int(3.05 * 1024 ** 3)
_VIDEO_WEIGHTS_LOCK = threading.Lock()
_VIDEO_WEIGHT_STATE = {"loading": False, "ready": False, "error": ""}


def cv_fetch_weights(root):
    """Serialize background prefetch and request-time fetches of the same local ModelScope video assets."""
    with _VIDEO_WEIGHTS_LOCK:
        return _cv_fetch_weights_locked(root)


def _cv_fetch_weights_locked(root):
    """Download a private local copy of the video weights from ModelScope only."""
    import shutil as _sh
    from pathlib import Path as _P
    dest = _P(root) / "video_animatediff"
    dest.mkdir(parents=True, exist_ok=True)
    existing = cv_find_weights(root, ())
    if existing:
        return existing
    free = _sh.disk_usage(dest).free
    if free < CV_REQUIRED_FREE:
        raise RuntimeError(f"native-video-unavailable: this Studio needs about 3 GiB free disk; only {free / 1024 ** 3:.1f} GiB is free")
    try:
        import os as _os
        from modelscope_hub.compat import snapshot_download
        token = (_os.environ.get("MODELSCOPE_API_TOKEN") or _os.environ.get("MODELSCOPE_TOKEN") or "").strip() or None
        snapshot_download(CV_MS_BASE, local_dir=str(dest / "base"), allow_patterns=_CV_BASE_FILES, token=token)
        snapshot_download(CV_MS_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE], token=token)
        found = cv_find_weights(root, ())
        if found:
            return found
        raise RuntimeError("ModelScope download completed but the required base or AnimateDiff adapter files are missing")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"native-video-unavailable: ModelScope-only video weights could not be prepared: {type(exc).__name__}: {str(exc)[:180]}") from exc

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
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)      # the freed pipeline goes back to the system; without it the next clip stalled (2026-11-04)
    except Exception:  # noqa: BLE001
        pass


def cv_encode_mp4(frames, fps: int = 8, out_side: int = 0) -> bytes:
    """H.264 MP4 of the generated frames (ffmpeg from imageio-ffmpeg or PATH): lanczos upscale to out_side, then double the frame rate with `framerate` (exact duration; `minterpolate` dropped the tail frames and shortened each clip)."""
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
        scale = f"scale={int(out_side)}:{int(out_side)}:flags=lanczos," if out_side and out_side != frames[0].size[0] else ""
        tail = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
        last = None
        for vf in (f"{scale}framerate=fps={fps * 2}", scale.rstrip(",")):
            cmd = [exe, "-y", "-v", "error", "-framerate", str(fps), "-i", f"{d}/f%03d.png"] + (["-vf", vf] if vf else []) + tail
            try:
                _sp.run(cmd, check=True, timeout=120)
                break
            except Exception as exc:  # noqa: BLE001
                last = exc
        else:
            raise RuntimeError(f"native-video-unavailable: ffmpeg encode failed: {last}")
        with open(out, "rb") as fh:
            return fh.read()


CV_SUPPORTED_DURATIONS = (2, 4, 6, 10, 15, 30, 60, 120)


def cv_chunk_plan(seconds: int | float) -> list[int]:
    """Split a requested clip into temporal diffusion passes of `cap` seconds, keeping the final duration exact.
    `CPU_VIDEO_MAX_PASS_S` lowers the cap (2 on an 8 GB Studio: 16 frames is the proven-safe pass size). No pass is
    ever 1 s: a 1 s pass cannot hold a scene, so the model emits a random ghost shot instead of a continuation. The
    remainder of the split therefore joins the LAST pass (2 + 1 = 3 s), never a separate 1 s one."""
    import math
    import os as _os
    if isinstance(seconds, bool):
        raise ValueError("native-video-duration-limit: choose 2, 4, 6, 10, 15, 30, 60 or 120 seconds")
    try:
        requested = float(seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("native-video-duration-limit: choose 2, 4, 6, 10, 15, 30, 60 or 120 seconds") from exc
    if not math.isfinite(requested) or not requested.is_integer() or int(requested) not in CV_SUPPORTED_DURATIONS:
        raise ValueError("native-video-duration-limit: choose 2, 4, 6, 10, 15, 30, 60 or 120 seconds")
    cap = max(2, min(4, int(_os.environ.get("CPU_VIDEO_MAX_PASS_S", "") or 4)))
    remaining = int(requested)
    chunks = [cap] * (remaining // cap)
    tail = remaining % cap
    if tail == 1 and chunks:
        chunks[-1] += 1
    elif tail:
        chunks.append(tail)
    if not chunks:
        chunks = [remaining]
    if any(part < 2 or part > max(cap, 3) for part in chunks) or sum(chunks) != int(seconds):
        raise ValueError("native-video-duration-limit: this duration cannot be split into supported 2-4 second temporal passes")
    return chunks


def cv_requested_frames(seconds: float, profile: dict) -> int:
    """Return frames for one 2-4 second diffusion pass; long requests are segmented by cv_generate_long."""
    import math
    try:
        requested = float(seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("native-video-duration-limit: each diffusion pass must be 2, 3 or 4 seconds") from exc
    fps = int(profile.get("fps") or 8)
    maximum = int(profile.get("max_frames") or 16)
    if not math.isfinite(requested) or requested not in (2.0, 3.0, 4.0):
        raise ValueError("native-video-duration-limit: each temporal pass must be 2, 3 or 4 seconds")
    frames = int(round(requested * fps))
    if frames < 16 or frames > maximum or abs(frames / fps - requested) > 0.05:
        raise ValueError(f"native-video-duration-limit: {requested:g} seconds do not fit this Studio profile (maximum {maximum / fps:g} seconds)")
    return frames


def cv_generate(root, prompt: str, seconds: float = 4.0, seed: int = 0, env_names=("CPU_VIDEO_MODEL_DIR",)) -> bytes:
    """Prompt -> MP4 bytes. 8 fps; frames = seconds x 8 within the CPU profile's limit."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    import torch
    prof = cv_profile()
    pipe = cv_pipe(root, env_names)
    frames = cv_requested_frames(seconds, prof)
    keep = __import__("os").environ.get("CPU_VIDEO_KEEP", "") == "1"
    # The sampling result stays as latents; unless the pipeline is kept, the UNet and text encoder (~2 GB) are dropped BEFORE the float32 VAE decode, and the frames are decoded one at a time.
    # (The Sham v2 Studio holds a text model too, with ~1.4 GB RAM free: the all-in-one decode killed the Studio right after the 4 sampling steps: 502.)
    # AnimateDiff-Lightning (4 steps, guidance 1.0) barely moves a still-looking prompt: ask for visible subject and camera motion explicitly.
    motion_prompt = prompt[:260] + (", the subject is clearly moving, natural body motion, smooth camera pan" if "motion" not in prompt.lower() else "")
    out = pipe(prompt=motion_prompt, guidance_scale=1.0, num_inference_steps=4, num_frames=frames, height=prof["side"], width=prof["side"],
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
    data = cv_encode_mp4(pil_frames, prof["fps"], prof.get("out_side", 0))
    if not keep:
        del pipe
        cv_release()
    return data
CV_XFADE_S = 0.2          # seconds of cross-fade between two temporal passes: hides the hard seam where two independent passes meet


def _cv_ffmpeg_exe():
    import shutil as _sh
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return _sh.which("ffmpeg")


def _cv_join_plain(exe, root, clips):
    """The fallback join: stream-copy the passes one after another (a visible cut at every seam)."""
    entries = []
    for index, data in enumerate(clips):
        path = root / f"segment-{index:03d}.mp4"
        path.write_bytes(data)
        entries.append(f"file '{path.as_posix()}'")
    concat_list = root / "segments.txt"
    concat_list.write_text("\n".join(entries) + "\n", encoding="utf-8")
    output = root / "joined.mp4"
    cmd = [
        exe, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "16", "-movflags", "+faststart",
        str(output),
    ]
    return output, cmd


def _cv_join_xfade(exe, root, clips, segment_seconds, expected_seconds, fade):
    """Cross-fade each pass's tail into the next pass's head so the clip is not separate shots cut together, then hold the last
    frame for the time the dissolves removed, so the joined clip is still exactly `expected_seconds` long."""
    paths = []
    for index, data in enumerate(clips):
        path = root / f"xfade-{index:03d}.mp4"
        path.write_bytes(data)
        paths.append(path)
    filters = []
    prev = "[0:v]"
    merged = float(segment_seconds[0])
    for i in range(1, len(paths)):
        offset = max(0.0, merged - fade)
        label = f"[vx{i}]"
        filters.append(f"{prev}[{i}:v]xfade=transition=fade:duration={fade:.3f}:offset={offset:.3f}{label}")
        prev = label
        merged = merged + float(segment_seconds[i]) - fade
    shortfall = max(0.0, float(expected_seconds) - merged)
    if shortfall > 0.02 and merged > 0:
        # Re-time the joined frames to the exact requested length. `tpad stop_mode=clone` used to hold the last frame
        # instead, which froze the final `fade` seconds of every multi-pass clip (measured 2026-11-06: a 3-pass 6 s
        # clip ended with ~0.4 s of identical frames) — the "stitched frames" look the owner rejected. `setpts`
        # stretches the same real diffusion frames, so the motion stays continuous to the last frame.
        filters.append(f"{prev}setpts=PTS*{float(expected_seconds):.6f}/{merged:.6f}[vout]")
    else:
        filters.append(f"{prev}null[vout]")
    output = root / "joined.mp4"
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-y"]
    for path in paths:
        cmd += ["-i", str(path)]
    cmd += [
        "-filter_complex", ";".join(filters), "-map", "[vout]",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "16", "-t", str(int(expected_seconds)),
        "-movflags", "+faststart", str(output),
    ]
    return output, cmd


def cv_concat_mp4(clips: list[bytes], expected_seconds: int, segment_seconds: list[int] | None = None) -> bytes:
    """Join already-generated H.264 temporal clips into one MP4 without holding decoded full-size frames in RAM.
    When the per-pass lengths are known the seams are cross-faded (smooth) and the tail is held to keep the exact length; any
    xfade failure falls back to a plain concat, so joining never breaks a clip that would otherwise succeed."""
    import subprocess as _sp
    import tempfile as _tf
    exe = _cv_ffmpeg_exe()
    if not exe:
        raise RuntimeError("native-video-unavailable: ffmpeg is required to join the generated video segments")
    if not clips:
        raise RuntimeError("native-video-unavailable: no temporal segments were generated")
    from media_quality import check_mp4
    with _tf.TemporaryDirectory(prefix="sham-video-join-") as directory:
        root = __import__("pathlib").Path(directory)
        segments = [int(x) for x in segment_seconds] if segment_seconds else []
        fade = float(CV_XFADE_S)
        data = None
        if len(clips) > 1 and len(segments) == len(clips) and min(segments) > 2 * fade + 0.2:
            try:
                output, cmd = _cv_join_xfade(exe, root, clips, segments, int(expected_seconds), fade)
                _sp.run(cmd, check=True, stdout=_sp.PIPE, stderr=_sp.PIPE, timeout=max(180, expected_seconds * 5))
                candidate = output.read_bytes()
                check_mp4(candidate, expected_seconds=expected_seconds, min_width=480, min_height=270)
                data = candidate
            except Exception:  # noqa: BLE001
                data = None
        if data is None:
            output, cmd = _cv_join_plain(exe, root, clips)
            try:
                _sp.run(cmd, check=True, stdout=_sp.PIPE, stderr=_sp.PIPE, timeout=max(180, expected_seconds * 5))
            except Exception as exc:  # noqa: BLE001
                detail = getattr(exc, "stderr", b"")
                if isinstance(detail, bytes):
                    detail = detail.decode("utf-8", "replace")
                raise RuntimeError("native-video-unavailable: ffmpeg could not join the generated segments: " + str(detail or exc)[-500:]) from exc
            data = output.read_bytes()
            check_mp4(data, expected_seconds=expected_seconds, min_width=480, min_height=270)
        return data


def cv_generate_long(
    root, prompt: str, seconds: int = 4, seed: int = 0,
    env_names=("CPU_VIDEO_MODEL_DIR",),
) -> bytes:
    """Generate 2/4/10/15/30/60/120 s locally from the installed temporal weights.

    Longer clips are made from real 2-4 s AnimateDiff diffusion passes (not still images),
    then joined and validated as one MP4. The model is deliberately unloaded between passes
    to leave RAM for the VAE decode on the 8 GB Studio.
    """
    import os as _os
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    chunks = cv_chunk_plan(seconds)
    target = sum(chunks)
    old_keep = _os.environ.get("CPU_VIDEO_KEEP")
    _os.environ["CPU_VIDEO_KEEP"] = "0"
    clips: list[bytes] = []
    try:
        for index, duration in enumerate(chunks):
            continuity = (
                " Continue the same scene and same subject from the preceding temporal segment; "
                "preserve subject identity, clothing, lighting, environment and camera direction. "
                "Keep the action moving naturally without a title card or scene reset."
            )
            segment_prompt = prompt[:220] + (continuity if len(chunks) > 1 else "")
            clip = cv_generate(root, segment_prompt, float(duration), int(seed) + index * 1009, env_names)
            from media_quality import check_mp4
            check_mp4(clip, expected_seconds=duration, min_width=480, min_height=270)
            clips.append(clip)
    finally:
        if old_keep is None:
            _os.environ.pop("CPU_VIDEO_KEEP", None)
        else:
            _os.environ["CPU_VIDEO_KEEP"] = old_keep
    if len(clips) == 1:
        from media_quality import check_mp4
        check_mp4(clips[0], expected_seconds=target, min_width=480, min_height=270)
        return clips[0]
    return cv_concat_mp4(clips, target, list(chunks))


# --- cpu_video END ---


def _video_pass_child(prompt: str, seconds: float, seed: int, out_path: str) -> None:
    """Runs in a fresh process: ONE 2-4 s diffusion pass, written to out_path (or the error text to out_path + '.err')."""
    try:
        data = cv_generate(MODEL_STORE, prompt, float(seconds), int(seed), ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))
        with open(out_path, "wb") as fh:
            fh.write(data)
    except BaseException as exc:  # noqa: BLE001
        traceback.print_exc()
        with open(out_path + ".err", "w", encoding="utf-8") as fh:
            fh.write(f"{type(exc).__name__}: {str(exc)[:400]}")


def _trim_heap() -> None:
    import gc
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001
        pass


def _free_parent_ram() -> None:
    """Before a clip, everything heavy leaves the parent: the picture worker process is stopped (it restarts on the next picture) and any
    in-process pipeline is dropped. Live 2026-11-04 (8 GB Studio): the clip process was killed -9 after a picture had been made in the parent,
    whose heap never shrank back; the deploy probe's clip passed (29 frames, 315 s) when the parent had made no picture.
    Live 2026-11-05 (LFM2.5 8 GB Studio): the probe makes an image and Arabic speech first, and Piper was still resident when the clip
    started, so the `job` submit 502'd for minutes while the Studio ran out of memory. The voice reloads lazily, so drop it too."""
    _stop_image_worker()
    _MODELS["pipe"] = None
    _MODELS["voice"] = None
    _CV["pipe"] = None
    _trim_heap()


def _mem_available_gb(read_text=None) -> float:
    """Conservative free-memory estimate: use the minimum of host MemAvailable and the remaining cgroup memory limit."""
    if read_text is None:
        def read_text(path):
            with open(path, "r", encoding="utf-8") as handle:
                return handle.read()
    candidates = []
    try:
        for line in read_text("/proc/meminfo").splitlines():
            if line.startswith("MemAvailable:"):
                candidates.append(max(0.0, float(line.split()[1]) / 1048576.0))
                break
    except Exception:  # noqa: BLE001
        pass
    for limit_path, current_path in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ):
        try:
            raw_limit = read_text(limit_path).strip()
            if not raw_limit or raw_limit.lower() == "max":
                continue
            limit = int(raw_limit)
            if limit <= 0 or limit >= 2 ** 60:
                continue
            current = max(0, int(read_text(current_path).strip()))
            candidates.append(max(0, limit - current) / 1024 ** 3)
        except Exception:  # noqa: BLE001
            continue
    return min(candidates) if candidates else 0.0


def _run_pass(prompt: str, seconds: float, seed: int, d: str, index: int) -> bytes:
    import multiprocessing as _mp
    out = os.path.join(d, f"pass{index}.mp4")
    proc = _mp.get_context("spawn").Process(target=_video_pass_child, args=(prompt, float(seconds), int(seed), out), daemon=True)
    proc.start()
    limit = int(os.environ.get("NOVA_VIDEO_PASS_LIMIT_S", "") or 1200)
    proc.join(limit)
    if proc.is_alive():
        proc.kill()
        proc.join(10)
        raise TimeoutError(f"video pass {index + 1} timed out after {limit}s")
    if os.path.exists(out + ".err"):
        raise RuntimeError(open(out + ".err", encoding="utf-8").read())
    if proc.exitcode != 0 or not os.path.exists(out):
        raise RuntimeError(f"native-video-failed: the clip process ended with code {proc.exitcode} (killed: out of memory?)")
    with open(out, "rb") as fh:
        return fh.read()


def _make_video(prompt: str, seconds: float, seed: int = 0) -> bytes:
    """Use one process for low-memory Studios and isolated fresh processes only when the cgroup has enough headroom."""
    mode = (os.environ.get("NOVA_VIDEO_SUBPROCESS", "auto") or "auto").strip().lower()
    if mode not in ("0", "1", "auto"):
        mode = "auto"
    try:
        chunks = cv_chunk_plan(seconds)
    except ValueError as exc:
        raise RuntimeError(f"ValueError: {exc}") from exc
    prompt = (prompt or "").strip()
    if not prompt:
        raise RuntimeError("native-video-unavailable: a text prompt is required")
    # Free the image worker and its allocator before deciding whether the 8 GB container can afford another Python/Torch process.
    _free_parent_ram()
    low_memory = _mem_available_gb() < 9.0
    if mode == "0" or (mode == "auto" and low_memory):
        # The Studio itself owns the only heavy process; cv_generate_long unloads AnimateDiff and trims libc after EACH pass.
        # On a low-memory Studio use only 2 s (16-frame) passes: a 4 s/32-frame pass died mid-sampling with no traceback (cgroup OOM)
        # while image and speech passed (LFM2.5/Nova video 2026-11-05); 16 frames is the size the 8 GB Studio proved it can finish.
        previous = os.environ.get("CPU_VIDEO_MAX_PASS_S")
        if low_memory:
            os.environ["CPU_VIDEO_MAX_PASS_S"] = "2"
        try:
            return cv_generate_long(MODEL_STORE, prompt, seconds, seed, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))
        finally:
            if previous is None:
                os.environ.pop("CPU_VIDEO_MAX_PASS_S", None)
            else:
                os.environ["CPU_VIDEO_MAX_PASS_S"] = previous
            _CV["pipe"] = None
            _trim_heap()
    from media_quality import check_mp4
    continuity = (" Continue the same scene and same subject from the preceding temporal segment; "
                  "preserve subject identity, clothing, lighting, environment and camera direction. "
                  "Keep the action moving naturally without a title card or scene reset.")
    clips: list[bytes] = []
    with tempfile.TemporaryDirectory(prefix="clip-") as d:
        for index, duration in enumerate(chunks):
            STATE["phase"] = f"video pass {index + 1}/{len(chunks)}"
            clip = _run_pass(prompt[:220] + (continuity if len(chunks) > 1 else ""), float(duration), int(seed) + index * 1009, d, index)
            check_mp4(clip, expected_seconds=duration, min_width=480, min_height=270)
            clips.append(clip)
    STATE["phase"] = "ready"
    target = sum(chunks)
    if len(clips) == 1:
        return clips[0]
    joined = cv_concat_mp4(clips, target, list(chunks))
    check_mp4(joined, expected_seconds=target, min_width=480, min_height=270)
    return joined


def _run(kind: str, payload: dict) -> dict:
    if not _LOCK.acquire(blocking=False):
        return {"type": "busy"}
    t0 = time.time()
    try:
        # Recheck after acquiring the media lock to close the desktop/generation race.
        STATE["phase"] = f"making {kind}"
        if kind == "image":
            img = _make_image(str(payload.get("prompt", "")), payload.get("size", 512), payload.get("seed", 0))
            check_image(img)
            out = {"type": "image", "b64": base64.b64encode(_png(img)).decode()}
        elif kind == "speech":
            wav = _speech_wav(str(payload.get("text", "")))
            check_wav(wav)
            out = {"type": "audio", "b64": base64.b64encode(wav).decode()}
        else:
            prompt = str(payload.get("prompt", "")).strip()
            requested_seconds = float(payload.get("seconds", 4))
            clip = _make_video(prompt, requested_seconds, payload.get("seed", 0))
            # Validate the final artifact at the Studio boundary as well as each
            # temporal segment. Never send a malformed, static, short or low-res MP4.
            check_mp4(clip, expected_seconds=requested_seconds, min_width=480, min_height=270)
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


# --- background video jobs (2026-11-04) ---
# A clip takes minutes (about 2.5 min per 4 s pass on the free CPU). One long SSE read through the ModelScope gateway was cut after ~20 s - 4 min
# ("unreadable" / 502), and with no request in flight the serverless instance stopped giving the job CPU: sampling sat at 0/4 for 13+ minutes
# (run-log 2026-11-04 08:41 Beijing) and every later request answered 500/502. Now the clip runs in a background thread and the caller asks
# `job` back-to-back; each poll holds for at most 5 s, so gateways don't strand a Gradio worker on a long response.
_JOBS: dict = {}
_JOBS_LOCK = threading.Lock()
JOB_KEEP_S = 1800


def _job_gc(now: float) -> None:
    for jid in [j for j, v in _JOBS.items() if v.get("done_at") and now - v["done_at"] > JOB_KEEP_S]:
        _JOBS.pop(jid, None)


def _job_thread(jid: str, payload: dict) -> None:
    try:
        out = _run("video", payload)
    except Exception as exc:  # noqa: BLE001  (_run already catches; this is a last guard)
        out = {"type": "error", "reason": "failed", "text": f"{type(exc).__name__}: {str(exc)[:200]}"}
    with _JOBS_LOCK:                             # a {"type":"busy"} result (a picture took the media lock first) is returned as is; the caller asks again
        job = _JOBS.setdefault(jid, {})
        job["result"], job["done_at"] = out, time.time()
        ev = job.get("event")
    if ev is not None:
        ev.set()


def api_video_start(body: str) -> str:
    """Start one clip in the background: {"type":"job","job":id}, or {"type":"busy"} while another media job holds the Studio."""
    import uuid
    payload = json.loads(body or "{}")
    if _LOCK.locked():
        return json.dumps({"type": "busy"})
    jid = uuid.uuid4().hex[:16]
    with _JOBS_LOCK:
        _job_gc(time.time())
        _JOBS[jid] = {"started": time.time(), "event": threading.Event(), "seconds": payload.get("seconds")}
    threading.Thread(target=_job_thread, args=(jid, payload), daemon=True).start()
    return json.dumps({"type": "job", "job": jid})


def api_job(body: str) -> str:
    """{"job": id, "wait": s<=20} -> the finished result (image/video/error/busy), or {"type":"running","phase":...,"elapsed_s":...}.
    {"type":"error","reason":"job_lost"} when the id is unknown (the Studio restarted, or the result expired)."""
    req = json.loads(body or "{}")
    jid = str(req.get("job") or "")
    # ModelScope's Gradio gateway has been observed to leave 20 s job reads hanging until HTTP 500.
    # Keep each poll below that gateway window; the caller immediately asks again while the CPU job runs.
    wait = max(0.0, min(5.0, float(req.get("wait", 5) or 0)))
    with _JOBS_LOCK:
        job = _JOBS.get(jid)
    if job is None:
        return json.dumps({"type": "error", "reason": "job_lost", "text": "the media job is unknown (the Studio restarted or the result expired)"})
    ev = job.get("event")
    if "result" not in job and ev is not None:
        ev.wait(wait)
    with _JOBS_LOCK:
        job = _JOBS.get(jid) or job
        if "result" in job:
            return json.dumps(job["result"])
    return json.dumps({"type": "running", "phase": STATE.get("phase", ""), "elapsed_s": round(time.time() - job.get("started", time.time()), 1)})


def _disk() -> dict:
    """The Studio's disk in GiB (total / used / free of the volume that holds the weights), for the capacity audit."""
    try:
        d = shutil.disk_usage(HERE)
        return {"total_gb": round(d.total / 2 ** 30, 2), "used_gb": round(d.used / 2 ** 30, 2), "free_gb": round(d.free / 2 ** 30, 2)}
    except OSError:
        return {}


def api_status() -> str:
    ready = bool(_CV["pipe"] is not None or cv_find_weights(MODEL_STORE, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR")))
    return json.dumps({
        **STATE, "repo": REPO, "cpus": os.cpu_count(), "disk": _disk(),
        "video": {"engine": "AnimateDiff-Lightning", "ready": ready, "weights_loading": bool(_VIDEO_WEIGHT_STATE["loading"]),
                  "weights_error": str(_VIDEO_WEIGHT_STATE["error"] or ""), "available_memory_gb": round(_mem_available_gb(), 2),
                  "device": "cpu", "gpu_required": False, "profile": cv_profile(),
                  "mode": "native-diffusion-segments", "supported_seconds": [2, 4, 6, 10, 15, 30, 60, 120], "segment_seconds": [2, 3, 4],
                  "runtime_policy": "in-process below 9 GiB cgroup headroom; isolated pass workers above it",
                  "note": "local AnimateDiff weights are prefetched independently of image/speech; each pass is checked and released before the next"},
    })


def _warm_video_weights() -> None:
    """Fetch only the local AnimateDiff files in the background; never hold the pipeline in RAM during chat/image startup."""
    if _VIDEO_WEIGHT_STATE["loading"] or _VIDEO_WEIGHT_STATE["ready"]:
        return
    _VIDEO_WEIGHT_STATE["loading"] = True
    _VIDEO_WEIGHT_STATE["error"] = ""
    try:
        found = cv_find_weights(MODEL_STORE, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))
        if not found:
            cv_fetch_weights(MODEL_STORE)
        found = cv_find_weights(MODEL_STORE, ("NOVA_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))
        if not found:
            raise RuntimeError("the downloaded AnimateDiff base or motion adapter is missing")
        _VIDEO_WEIGHT_STATE["ready"] = True
    except Exception as exc:  # noqa: BLE001
        _VIDEO_WEIGHT_STATE["error"] = f"{type(exc).__name__}: {str(exc)[:240]}"
        traceback.print_exc()
    finally:
        _VIDEO_WEIGHT_STATE["loading"] = False


def _warm() -> None:
    """Load Nova's image and Arabic speech weights, then prefetch video files without blocking chat readiness."""
    while True:
        try:
            STATE["phase"] = "loading models"
            if os.environ.get("NOVA_IMAGE_SUBPROCESS", "1") == "0":
                _pipe()
            else:
                _image_call({"warm": True}, timeout=1800)
            _voice()
            STATE["phase"] = "ready"
            STATE["error"] = ""
            threading.Thread(target=_warm_video_weights, name="video-weights-warm", daemon=True).start()
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            STATE["phase"] = "waiting for models"
            STATE["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            time.sleep(120)



def _serve_demo(demo) -> None:
    """Bind Gradio before loading multi-GB CPU weights so the platform proxy can reach health/status immediately.

    ModelScope marks a Studio Running before its Gradio process has finished binding. Starting the weight
    warm-up first made the process spend minutes inside Torch/model loading before Gradio served /info,
    which presented as gateway 500/502 across every isolated media Studio. Start the HTTP server first;
    keep the process alive explicitly, then warm weights in the background.
    """
    demo.queue(default_concurrency_limit=4).launch(
        server_name="0.0.0.0",
        server_port=int(os.environ.get("PORT", 7860)),
        show_error=True,
        prevent_thread_lock=True,
    )
    threading.Thread(target=_warm, name="media-warm", daemon=True).start()
    threading.Event().wait()


if __name__ == "__main__":
    import gradio as gr
    with gr.Blocks() as demo:
        gr.Markdown("Nova Media Studio — image, Arabic speech and real video. Computer tools run on the separate isolated computer hub.")
        box = gr.Textbox(visible=False)
        out = gr.Textbox(visible=False)
        for name, fn in (("image", api_image), ("speech", api_speech), ("video", api_video), ("video_start", api_video_start), ("job", api_job)):
            gr.Button(name, visible=False).click(fn, box, out, api_name=name)
        gr.Button("status", visible=False).click(api_status, None, out, api_name="status")
    _serve_demo(demo)
