"""
Sham v2's own local media path: SDXS for images, Piper ONNX for Arabic speech, and AnimateDiff-Lightning text-to-video diffusion on CPU (cpu_video.py). Video is never assembled from still images.

The transplanted text body does not provide a usable image decoder, so Sham v2 uses its own bundled donor weights for image/speech and its own open video weights (~3 GB, fetched once into <model_dir>/media/video_animatediff) for true video. Every pipeline loads lazily and runs on CPU.

    root = ready_root(model_dir)          # model_dir/media if it holds sdxs/ and piper/, else None
    reply = make(root, "image", "a rabbit playing")   # {"type": "image", "b64": "<png>"} | audio (wav) | video (mp4) | {"type": "error", "text": ...}
"""
from __future__ import annotations

import base64
import io
import os
import shutil
import tempfile
import wave
from pathlib import Path

from media_quality import MediaQualityError, check_image, check_mp4, check_wav, classify_exception, quality_error

_CACHE: dict = {"pipe": None, "voice": None}


def inspect_ready_assets(model_dir: str | Path | None) -> dict:
    """Inspect local donor weights without downloading anything or loading them into RAM."""
    if not model_dir:
        return {"ready": False, "root": "", "image_bytes": 0, "audio_bytes": 0, "reason": "model directory missing"}
    base = Path(model_dir)
    # The publishing workflow guarantees a single root-level media/ folder; avoid a full recursive walk of the 8 GiB snapshot.
    for cand in (base / "media",):
        sdxs = cand / "sdxs"
        piper = cand / "piper"
        if not sdxs.is_dir() or not piper.is_dir():
            continue
        # A directory name alone is not proof of a usable model: require a Diffusers
        # model index + actual checkpoint tensors, and a Piper ONNX model + config.
        index_ok = (sdxs / "model_index.json").is_file()
        image_weights = [p for p in sdxs.rglob("*") if p.is_file() and p.suffix.lower() in {".safetensors", ".bin", ".ckpt"}]
        voices = [p for p in piper.glob("*.onnx") if Path(str(p) + ".json").is_file() or p.with_suffix(".onnx.json").is_file()]
        if not index_ok or not image_weights or not voices:
            continue
        voice_files = set(voices)
        for voice in voices:
            for cfg in (Path(str(voice) + ".json"), voice.with_suffix(".onnx.json")):
                if cfg.is_file():
                    voice_files.add(cfg)  # the two Piper config spellings can resolve to the same file
        return {
            "ready": True,
            "root": str(cand),
            "image_bytes": sum(p.stat().st_size for p in image_weights),
            "audio_bytes": sum(p.stat().st_size for p in voice_files),
            "image_weight_files": len(image_weights),
            "voice_models": len(voices),
            "reason": "",
        }
    return {"ready": False, "root": "", "image_bytes": 0, "audio_bytes": 0,
            "reason": "valid local Diffusers image weights or Piper ONNX+JSON voice weights not found"}


def ready_root(model_dir: str | Path | None) -> Path | None:
    """Return only a complete local image+speech model bundle; never infer readiness from empty folders."""
    info = inspect_ready_assets(model_dir)
    return Path(info["root"]) if info["ready"] else None


def _scene_prompts(prompt: str, count: int = 4) -> list[str]:
    """Turn one idea into a small, explicit multi-shot storyboard for the local image model."""
    prompt = prompt.strip()
    shots = [
        "wide establishing shot",
        "medium shot showing the main subject clearly",
        "close-up detail shot",
        "wide closing shot with a changed composition",
    ]
    return [f"{prompt}. Cinematic storyboard, {shots[i]}." for i in range(count)]


def _pipe(root: Path):
    if _CACHE["pipe"] is None:
        import torch
        from diffusers import AutoPipelineForText2Image
        torch.set_num_threads(os.cpu_count() or 2)
        p = AutoPipelineForText2Image.from_pretrained(str(root / "sdxs"), torch_dtype=torch.bfloat16, safety_checker=None, local_files_only=True)
        p.set_progress_bar_config(disable=True)
        _CACHE["pipe"] = p
    return _CACHE["pipe"]


def _voice(root: Path):
    if _CACHE["voice"] is None:
        from piper import PiperVoice
        voices = sorted((root / "piper").glob("*.onnx"))
        preferred = root / "piper" / "ar_JO-kareem-medium.onnx"
        voice_path = preferred if preferred in voices else (voices[0] if voices else None)
        if voice_path is None:
            raise FileNotFoundError("No local Piper ONNX voice model was found")
        _CACHE["voice"] = PiperVoice.load(str(voice_path))
    return _CACHE["voice"]


def _png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def _speech_wav(root: Path, text: str) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        _voice(root).synthesize_wav(text[:1500], w)
    data = b.getvalue()
    check_wav(data)             # empty or silent audio is an error, never a reply
    return data


# Measured (scripts/modes-bench/image_bench.py, CPU, SDXS): 512 = 1.8 s, 640 = 2.7 s, 768 = 3.8 s per picture. 640 gives visibly more detail; 768 starts to repeat subjects (the model was trained at 512) and 2-3 steps DESTROY
# the picture (SDXS is a one-step distilled model: noise), so the step count stays 1 and only the side moves, 512 -> 640.
# SDXS is trained at 512 px; stay at its native resolution by default to reduce off-distribution subject repetition.
IMAGE_SIDE = int(os.environ.get("SHAM_IMAGE_SIDE", "512"))


def _image(root: Path, prompt: str, size: int = 0, seed: int = 0):
    import torch
    size = max(256, min(704, (int(size) or IMAGE_SIDE) // 64 * 64))
    gen = torch.Generator().manual_seed(int(seed))
    image = _pipe(root)(prompt[:400], num_inference_steps=1, guidance_scale=0.0, height=size, width=size, generator=gen).images[0]
    check_image(image)          # a black / constant / noise picture is an error, never a reply
    return image


def _video(root: Path, prompts: list[str], narration: str, seconds: float = 2.0) -> bytes:
    """Real text-to-video on CPU (AnimateDiff-Lightning, cpu_video.py): one temporal diffusion pass, never a slideshow of stills."""
    from cpu_video import cv_generate

    prompt = (prompts[0] if prompts else "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    data = cv_generate(root, prompt, seconds, 0, ("SHAM_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR"))
    check_mp4(data)             # empty / frozen / blank video is an error, never a reply
    return data


def make(root: Path, kind: str, prompt: str, scenes: list[str] | None = None, narration: str = "") -> dict:
    """Create media with packaged local weights; video accepts up to six optional shots and local speech narration."""
    kind = (kind or "").strip().lower()
    prompt = (prompt or "").strip()
    scenes = [str(item).strip()[:300] for item in (scenes or []) if str(item).strip()][:6]
    narration = (narration or "").strip()[:1500]
    if not prompt:
        return {"type": "error", "text": "prompt is required"}
    try:
        if kind == "image":
            return {"type": "image", "b64": base64.b64encode(_png(_image(root, prompt))).decode()}
        if kind in ("audio", "speech"):
            spoken = narration or prompt
            return {"type": "audio", "b64": base64.b64encode(_speech_wav(root, spoken)).decode()}
        if kind == "video":
            # One prompt goes directly into the temporal diffusion model. No image storyboard fallback.
            clip = _video(root, [prompt], narration, seconds=2.0)
            return {
                "type": "video",
                "mime": "video/mp4",
                "b64": base64.b64encode(clip).decode(),
                "text": "فيديو مولّد مباشرة من الوصف بنموذج AnimateDiff على CPU.",
            }
        return {"type": "error", "text": f"unknown kind {kind!r}"}
    except MediaQualityError as exc:
        return quality_error(exc.reason, exc.detail)
    except Exception as exc:                                   # noqa: BLE001
        # one stable reason code (busy / disk / unavailable / timeout / failed) so clients show a clear message, not a blank picture
        return {"type": "error", "reason": classify_exception(exc), "text": f"{type(exc).__name__}: {str(exc)[:200]}"}


if __name__ == "__main__":
    import tempfile as _t
    assert ready_root(None) is None
    with _t.TemporaryDirectory() as d:
        assert ready_root(d) is None
        media = Path(d) / "media"
        sdxs, piper = media / "sdxs", media / "piper"
        sdxs.mkdir(parents=True)
        piper.mkdir()
        assert ready_root(d) is None                                # empty folders are not models
        (sdxs / "model_index.json").write_text("{}", encoding="utf-8")
        (sdxs / "model.safetensors").write_bytes(b"weights")
        voice = piper / "ar_voice.onnx"
        voice.write_bytes(b"voice")
        assert ready_root(d) is None                                # ONNX without its Piper config is not ready
        Path(str(voice) + ".json").write_text("{}", encoding="utf-8")
        assert ready_root(d) == media
        info = inspect_ready_assets(d)
        assert info["ready"] and info["image_bytes"] == 7 and info["audio_bytes"] == 7
        assert len(_scene_prompts("a cat")) == 4
        assert len(set(_scene_prompts("a cat"))) == 4
        assert make(media, "image", "")["type"] == "error"
        assert make(media, "nothing", "x")["type"] == "error"
    print("sham_media_ready OK: validates actual local weight files, asset sizes, storyboard prompts, and invalid requests")
