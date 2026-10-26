"""Production media adapters for Sham v2.

Images use the bundled SDXS diffusion weights; Arabic speech uses the bundled
Piper ONNX voice. Real motion video is delegated to the project's LTX-Video
ZeroGPU Space (HF_VIDEO_SPACE_ID), because a CPU slideshow is not video
generation. If that Space is not configured or returns an invalid file, the
request fails explicitly instead of pretending a still-image MP4 is a video.
"""
from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import wave
from pathlib import Path
from typing import Any

_CACHE: dict[str, Any] = {"pipe": None, "voice": None, "pipe_error": None}


def _has_image_model(path: Path) -> bool:
    if not path.is_dir() or not (path / "model_index.json").is_file():
        return False
    return any(path.rglob("*.safetensors")) or any(path.rglob("*.bin"))


def _voice_path(root: Path) -> Path | None:
    voice_dir = root / "piper"
    for path in sorted(voice_dir.glob("*.onnx")):
        # Piper needs its model configuration alongside the ONNX weights.
        if path.with_suffix(path.suffix + ".json").is_file():
            return path
    return None


def ready_root(model_dir: str | Path | None) -> Path | None:
    """Find a media folder containing at least one usable, independently checked backend."""
    if not model_dir:
        return None
    base = Path(model_dir)
    candidates = [base / "media", *base.rglob("media")]
    seen: set[Path] = set()
    for cand in candidates:
        if cand in seen or not cand.is_dir():
            continue
        seen.add(cand)
        if _has_image_model(cand / "sdxs") or _voice_path(cand) is not None:
            return cand
    return None


def media_status(model_dir: str | Path | None) -> dict[str, str | bool]:
    """Report image and speech readiness separately; one model being present does not imply the other is usable."""
    root = ready_root(model_dir)
    return {
        "root": str(root) if root else "",
        "image_ready": bool(root and _has_image_model(root / "sdxs")),
        "speech_ready": bool(root and _voice_path(root) is not None),
    }


def video_backend_status() -> dict[str, str | bool]:
    space = os.environ.get("HF_VIDEO_SPACE_ID", "").strip()
    token_configured = bool(os.environ.get("HF_TOKEN", "").strip())
    return {
        "configured": bool(space and token_configured),
        "token_configured": token_configured,
        "backend": "Lightricks/LTX-Video via Hugging Face ZeroGPU",
        "space_id": space or "",
    }


def _pipe(root: Path):
    if _CACHE["pipe"] is None:
        import torch
        from diffusers import AutoPipelineForText2Image

        model_dir = root / "sdxs"
        if not _has_image_model(model_dir):
            raise RuntimeError("أوزان SDXS غير مكتملة: يلزم model_index.json وملفات الأوزان داخل media/sdxs.")
        torch.set_num_threads(max(1, min(os.cpu_count() or 2, 4)))
        # ModelScope Studio is CPU-only. Float32 is the broadly supported CPU
        # dtype; BF16 is not available on every CPU instruction set.
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        pipe = AutoPipelineForText2Image.from_pretrained(
            str(model_dir), torch_dtype=dtype, safety_checker=None, local_files_only=True
        )
        pipe.set_progress_bar_config(disable=True)
        _CACHE["pipe"] = pipe
    return _CACHE["pipe"]


def _voice(root: Path):
    if _CACHE["voice"] is None:
        from piper import PiperVoice

        model = _voice_path(root)
        if model is None:
            raise RuntimeError("أوزان Piper أو ملف إعداد الصوت *.onnx.json غير موجودة داخل media/piper.")
        _CACHE["voice"] = PiperVoice.load(str(model))
    return _CACHE["voice"]


def _png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, format="PNG")
    raw = b.getvalue()
    from PIL import Image

    with Image.open(io.BytesIO(raw)) as check:
        check.verify()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("مولّد الصور لم يُرجع PNG صالحاً.")
    return raw


def _speech_wav(root: Path, text: str) -> bytes:
    text = (text or "").strip()
    if not text:
        raise ValueError("اكتب النص الذي تريد تحويله إلى صوت.")
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        _voice(root).synthesize_wav(text[:1500], w)
    raw = b.getvalue()
    with wave.open(io.BytesIO(raw), "rb") as check:
        if check.getnframes() <= 0 or check.getframerate() <= 0:
            raise RuntimeError("مولّد الصوت أخرج ملف WAV فارغاً.")
    return raw


def _image(root: Path, prompt: str, size: int = 512, seed: int = 0):
    import torch

    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("اكتب وصفاً للصورة.")
    size = max(256, min(768, int(size) // 64 * 64))
    generator = torch.Generator(device="cpu").manual_seed(int(seed))
    result = _pipe(root)(
        prompt[:400], num_inference_steps=1, guidance_scale=0.0,
        height=size, width=size, generator=generator,
    )
    if not getattr(result, "images", None):
        raise RuntimeError("نموذج الصور لم يُرجع صورة.")
    image = result.images[0]
    if image.width < 64 or image.height < 64:
        raise RuntimeError(f"أبعاد الصورة غير صالحة: {image.width}x{image.height}")
    return image


def _extract_video_path(result: Any) -> Path:
    if isinstance(result, dict):
        for key in ("video", "path", "name"):
            if result.get(key):
                result = result[key]
                break
    if not isinstance(result, (str, os.PathLike)):
        raise RuntimeError(f"خدمة الفيديو أعادت نوع نتيجة غير مدعوم: {type(result).__name__}")
    path = Path(result)
    if not path.is_file():
        raise RuntimeError("خدمة الفيديو لم تُرجع مسار ملف محلياً صالحاً.")
    return path


def _validate_mp4(path: Path) -> tuple[bytes, float]:
    import imageio_ffmpeg

    raw = path.read_bytes()
    if len(raw) < 4096:
        raise RuntimeError("ملف الفيديو الناتج فارغ أو أصغر من الحد الأدنى.")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True, timeout=90,
    )
    metadata = probe.stderr or ""
    if probe.returncode != 0 or "Video:" not in metadata:
        raise RuntimeError("ملف MP4 الناتج غير قابل للفك أو لا يحتوي مسار فيديو.")
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", metadata)
    duration = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3)) if match else 0.0
    if duration < 0.5:
        raise RuntimeError("الفيديو الناتج لا يحتوي مدة تشغيل صالحة.")
    # A valid MP4 can still be a repeated still. Sample frames and require visible temporal change.
    frames = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-vf", "fps=2", "-f", "framemd5", "-"],
        capture_output=True, text=True, timeout=90,
    )
    hashes = [line.rsplit(",", 1)[-1].strip() for line in (frames.stdout or "").splitlines()
              if line.strip() and not line.lstrip().startswith("#") and "," in line]
    if frames.returncode != 0 or len(set(hashes)) < 2:
        raise RuntimeError("رفضت شام الفيديو: الإطارات لا تُظهر حركة قابلة للتحقق؛ لن أرسل صورة ثابتة على أنها فيديو.")
    return raw, duration


def _real_video(prompt: str, seconds: float = 4.0) -> dict:
    """Call the dedicated LTX-Video-2B Space; never replace a failed call with a slideshow."""
    space_id = os.environ.get("HF_VIDEO_SPACE_ID", "").strip()
    token = os.environ.get("HF_TOKEN", "").strip()
    if not space_id or not token:
        missing = "HF_VIDEO_SPACE_ID" if not space_id else "HF_TOKEN"
        return {
            "type": "error",
            "text": f"توليد الفيديو الحركي غير مهيأ: اضبط {missing} في إعدادات الاستوديو. لم يُنشأ فيديو شرائح بديلاً.",
            "code": "video_backend_not_configured",
        }
    prompt = (prompt or "").strip()
    if not prompt:
        return {"type": "error", "text": "اكتب وصف الفيديو.", "code": "empty_prompt"}
    try:
        from gradio_client import Client

        client_kwargs = {"hf_token": token} if token else {}
        client = Client(space_id, **client_kwargs)
        seconds = max(1, min(6, int(float(seconds or 4))))
        result = client.predict(prompt[:800], seconds, api_name="/generate")
        path = _extract_video_path(result)
        raw, duration = _validate_mp4(path)
        return {
            "type": "video", "mime": "video/mp4",
            "b64": base64.b64encode(raw).decode("ascii"),
            "duration_seconds": round(duration, 2),
            "backend": "Lightricks/LTX-Video-2B",
            "text": "فيديو مولّد بنموذج فيديو حركي.",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "type": "error",
            "text": f"تعذّر توليد فيديو حركي من خدمة LTX-Video: {type(exc).__name__}: {str(exc)[:180]}",
            "code": "video_generation_failed",
        }


def make(root: Path | None, kind: str, prompt: str) -> dict:
    """Generate media and validate its container before reporting success."""
    kind = (kind or "").strip().lower()
    prompt = (prompt or "").strip()
    if not prompt:
        return {"type": "error", "code": "empty_prompt", "text": "اكتب وصفاً أو نصاً أولاً."}
    if kind not in ("image", "audio", "speech", "video"):
        return {"type": "error", "code": "unknown_kind", "text": f"نوع وسيط غير معروف: {kind}"}
    try:
        if kind == "video":
            return _real_video(prompt)
        if root is None:
            raise RuntimeError("أوزان الوسائط الجاهزة غير متاحة في مستودع شام v2.")
        if kind == "image":
            raw = _png(_image(root, prompt))
            from PIL import Image

            with Image.open(io.BytesIO(raw)) as image:
                width, height = image.size
            return {
                "type": "image", "mime": "image/png",
                "width": width, "height": height,
                "backend": "SDXS-512",
                "b64": base64.b64encode(raw).decode("ascii"),
            }
        if kind in ("audio", "speech"):
            raw = _speech_wav(root, prompt)
            with wave.open(io.BytesIO(raw), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
            return {
                "type": "audio", "mime": "audio/wav",
                "duration_seconds": round(duration, 2),
                "backend": "Piper ONNX",
                "b64": base64.b64encode(raw).decode("ascii"),
            }
        return {"type": "error", "code": "unknown_kind", "text": f"نوع وسيط غير معروف: {kind}"}
    except Exception as exc:  # noqa: BLE001
        return {"type": "error", "code": "media_generation_failed",
                "text": f"{type(exc).__name__}: {str(exc)[:220]}"}


if __name__ == "__main__":
    import tempfile

    assert ready_root(None) is None
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "media" / "sdxs").mkdir(parents=True)
        assert ready_root(root) is None
        sdxs = root / "media" / "sdxs"
        (sdxs / "model_index.json").write_text("{}", encoding="utf-8")
        (sdxs / "model.safetensors").write_bytes(b"weights")
        assert ready_root(root) == root / "media"
        piper = root / "media" / "piper"
        piper.mkdir()
        (piper / "voice.onnx").write_bytes(b"weights")
        (piper / "voice.onnx.json").write_text("{}", encoding="utf-8")
        assert ready_root(root) == root / "media"
        assert make(None, "video", "")["code"] == "empty_prompt"
        assert make(root / "media", "image", "")["code"] == "empty_prompt"
        assert make(root / "media", "unknown", "x")["code"] == "unknown_kind"
        assert make(root / "media", "video", "a cat")["type"] in ("error", "video")
    print("sham_media_ready: structural checks passed")
