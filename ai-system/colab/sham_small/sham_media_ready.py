"""
Sham's media with READY, trained weights that live inside Sham's own model repo (novaai2026/sham-v2, folder media/): a distilled one-step diffusion model for
pictures (SDXS-512), an Arabic voice for speech (Piper, ONNX) and a slideshow video (pictures + narration joined by ffmpeg).

The transplanted text body brings language and tools but no trained image decoder (its own decoder gave meaningless blobs), so Sham's `make_media` uses these
weights through Sham's own Studio instead of calling another service. Everything loads lazily, on the first request, and stays loaded; the picture model is
kept in bfloat16 so that it fits beside the 1.7B text body in the free 8 GB Studio.

    root = ready_root(model_dir)          # model_dir/media if it holds sdxs/ and piper/, else None
    reply = make(root, "image", "a rabbit playing")   # {"type": "image", "b64": "<png>"} | audio (wav) | video (mp4) | {"type": "error", "text": ...}
"""
from __future__ import annotations

import base64
import io
import os
import subprocess
import tempfile
import wave
from pathlib import Path

_CACHE: dict = {"pipe": None, "voice": None}


def ready_root(model_dir: str | Path | None) -> Path | None:
    """The folder with the ready weights, when they are part of the model repo (media/sdxs and media/piper)."""
    if not model_dir:
        return None
    for cand in (Path(model_dir) / "media", *Path(model_dir).rglob("media")):
        if (cand / "sdxs").is_dir() and any((cand / "piper").glob("*.onnx")):
            return cand
    return None


def _pipe(root: Path):
    if _CACHE["pipe"] is None:
        import torch
        from diffusers import AutoPipelineForText2Image
        torch.set_num_threads(os.cpu_count() or 2)
        p = AutoPipelineForText2Image.from_pretrained(str(root / "sdxs"), torch_dtype=torch.bfloat16, safety_checker=None)
        p.set_progress_bar_config(disable=True)
        _CACHE["pipe"] = p
    return _CACHE["pipe"]


def _voice(root: Path):
    if _CACHE["voice"] is None:
        from piper import PiperVoice
        _CACHE["voice"] = PiperVoice.load(str(sorted((root / "piper").glob("*.onnx"))[0]))
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
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    seconds = max(1.5, min(6.0, float(seconds or 3)))
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        for i, p in enumerate(prompts[:6]):
            _image(root, p, 512, i).save(dd / f"f{i:02d}.png")
        audio: list[str] = []
        if narration.strip():
            (dd / "a.wav").write_bytes(_speech_wav(root, narration))
            audio = ["-i", str(dd / "a.wav")]
        cmd = [ff, "-y", "-framerate", f"1/{seconds}", "-i", str(dd / "f%02d.png"), *audio, "-vf", "format=yuv420p,scale=512:512",
               "-c:v", "libx264", "-r", "24", *(["-c:a", "aac", "-shortest"] if audio else []), "-movflags", "+faststart", str(dd / "o.mp4")]
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        return (dd / "o.mp4").read_bytes()


def make(root: Path, kind: str, prompt: str) -> dict:
    """One picture / one spoken sentence / one short slideshow, from the ready weights. Never raises: a failure is {"type": "error", "text": ...}."""
    kind = (kind or "").strip().lower()
    prompt = (prompt or "").strip()
    if not prompt:
        return {"type": "error", "text": "prompt is required"}
    try:
        if kind == "image":
            return {"type": "image", "b64": base64.b64encode(_png(_image(root, prompt))).decode()}
        if kind in ("audio", "speech"):
            return {"type": "audio", "b64": base64.b64encode(_speech_wav(root, prompt)).decode()}
        if kind == "video":
            # a slideshow of a few pictures of the same subject (the model decides nothing here: the prompt is the scene list's first line)
            return {"type": "video", "b64": base64.b64encode(_video(root, [prompt], prompt)).decode(), "text": prompt[:120]}
        return {"type": "error", "text": f"unknown kind {kind!r}"}
    except Exception as exc:                                   # noqa: BLE001
        return {"type": "error", "text": f"{type(exc).__name__}: {str(exc)[:200]}"}


if __name__ == "__main__":
    import tempfile as _t
    assert ready_root(None) is None
    with _t.TemporaryDirectory() as d:
        assert ready_root(d) is None                                            # no media folder: not ready
        (Path(d) / "media" / "sdxs").mkdir(parents=True)
        assert ready_root(d) is None                                            # no voice yet: still not ready
        (Path(d) / "media" / "piper").mkdir()
        (Path(d) / "media" / "piper" / "v.onnx").write_bytes(b"x")
        assert ready_root(d) == Path(d) / "media"
        assert make(Path(d) / "media", "image", "")["type"] == "error"          # an empty prompt is refused, never raises
        assert make(Path(d) / "media", "nothing", "x")["type"] == "error"
    print("sham_media_ready OK: ready folder detection, empty prompt and unknown kind refused without raising")
