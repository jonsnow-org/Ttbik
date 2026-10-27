"""
Media quality gate: never hand a user a blank / constant / noise image, silent or empty audio, or an empty / frozen video.

Used by every place that RETURNS generated media (Sham Studio, Sham v2 ready path, smoke tests). A failed check raises MediaQualityError (or, through
gate_reply, becomes {"type": "error", "reason": <code>, "text": <Arabic + English message>}), so the caller shows a clear error instead of a black picture.

Reason codes (stable; the clients map them to messages):
  blank_image      constant / near-constant picture (black, white, any single colour, or std < MIN_STD)
  noise_image      uncorrelated pixel noise: what an untrained image decoder produces for random tokens
  invalid_image    not a decodable image / NaN or Inf pixels
  silent_audio     empty, too short, or silent / constant WAV
  invalid_audio    not a readable WAV
  empty_video      empty / truncated / not an MP4, or (when it can be decoded) fewer than 2 frames
  static_video     decodable, but every frame is blank or all frames are identical

This file is stdlib + numpy (+ Pillow for images). Nova's media Studio carries a byte-identical copy of the block between the BEGIN / END markers
(ai-system/modelscope-media/app.py) because it is deployed on its own and must not import Sham code; a unit test keeps the two in sync.
"""
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
            open(src, "wb").write(data)
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
