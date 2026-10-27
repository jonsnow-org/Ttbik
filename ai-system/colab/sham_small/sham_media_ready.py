"""
Sham v2's own local media path: SDXS for images, Piper ONNX for Arabic speech, and native Wan text-to-video diffusion on CPU. Video is never assembled from still images.

The transplanted text body does not provide a usable image decoder, so Sham v2 uses its own bundled donor weights for image/speech and its own local Wan checkpoint for true video. Every pipeline loads lazily and runs on CPU. Video diffusion is resource-intensive; the implementation starts with short 256px clips and very few steps.

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

_CACHE: dict = {"pipe": None, "voice": None, "video_pipe": None, "video_root": None}


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
    return b.getvalue()


def _image(root: Path, prompt: str, size: int = 512, seed: int = 0):
    import torch
    size = max(256, min(768, int(size) // 64 * 64))
    gen = torch.Generator().manual_seed(int(seed))
    return _pipe(root)(prompt[:400], num_inference_steps=1, guidance_scale=0.0, height=size, width=size, generator=gen).images[0]


def _video(root: Path, prompts: list[str], narration: str, seconds: float = 3.0) -> bytes:
    """Generate a temporally coherent video directly from text with Wan on CPU; never use a slideshow."""
    import torch
    from diffusers import WanPipeline
    from diffusers.utils import export_to_video

    if _CACHE["video_pipe"] is None:
        local_dir = os.environ.get("SHAM_VIDEO_MODEL_DIR", "").strip()
        if local_dir:
            model_dir = Path(local_dir).expanduser().resolve()
        else:
            model_dir = root / "wan"
            if not (model_dir / "model_index.json").is_file():
                # Wan's full Diffusers snapshot is about 17.6 GB; do not fill/crash a small CPU Studio trying to fetch it.
                free_bytes = shutil.disk_usage(root.parent).free
                required_bytes = 20 * (1024 ** 3)
                if free_bytes < required_bytes:
                    raise RuntimeError(
                        f"native-video-unavailable: CPU mode needs at least 20 GiB free disk for local Wan weights; "
                        f"only {free_bytes / (1024 ** 3):.1f} GiB is free. Set SHAM_VIDEO_MODEL_DIR to an existing local checkpoint."
                    )
                # Download weights only. Generation remains local to Sham v2's own Studio process.
                from modelscope import snapshot_download
                model_dir = Path(snapshot_download(
                    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
                    cache_dir=str(root.parent / "_video_models"),
                ))
        if not model_dir.is_dir() or not (model_dir / "model_index.json").is_file():
            raise RuntimeError(f"native-video-unavailable: Wan Diffusers weights not found at {model_dir}")
        torch.set_num_threads(max(1, min(os.cpu_count() or 2, 4)))
        pipe = WanPipeline.from_pretrained(str(model_dir), torch_dtype=torch.float32, local_files_only=True)
        pipe.to("cpu")
        _CACHE["video_pipe"] = pipe
        _CACHE["video_root"] = str(model_dir)

    prompt = (prompts[0] if prompts else "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    seconds = max(1.0, min(2.0, float(seconds or 2)))
    frame_count = 9 if seconds <= 1.5 else 13
    generator = torch.Generator(device="cpu").manual_seed(0)
    result = _CACHE["video_pipe"](
        prompt=prompt[:800],
        height=256,
        width=256,
        num_frames=frame_count,
        num_inference_steps=2,
        guidance_scale=3.0,
        generator=generator,
    )
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "sham-v2-native-video.mp4"
        export_to_video(result.frames[0], str(target), fps=8)
        return target.read_bytes()


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
            # One prompt goes directly into Wan's temporal diffusion model. No image storyboard fallback.
            clip = _video(root, [prompt], narration, seconds=2.0)
            return {
                "type": "video",
                "mime": "video/mp4",
                "b64": base64.b64encode(clip).decode(),
                "text": "فيديو مولّد مباشرة من الوصف بنموذج Wan على CPU.",
            }
        return {"type": "error", "text": f"unknown kind {kind!r}"}
    except Exception as exc:                                   # noqa: BLE001
        return {"type": "error", "text": f"{type(exc).__name__}: {str(exc)[:200]}"}


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
