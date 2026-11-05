"""Sham v2 real text-to-video on CPU (its own copy: Nova has its own in modelscope-media/app.py; neither imports the other).

AnimateDiff-Lightning + an SD-1.5 realistic base, open weights, ~3 GB. Used by sham_media_ready.py.
"""
from __future__ import annotations

import threading

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
    """H.264 MP4 of the generated frames (ffmpeg from imageio-ffmpeg or PATH): lanczos upscale to out_side, then motion-compensated interpolation to double the frame rate (smooth motion; skipped if ffmpeg cannot do it)."""
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
        for vf in (f"{scale}minterpolate=fps={fps * 2}:mi_mode=mci:mc_mode=aobmc:vsbmc=1", scale.rstrip(",")):
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
    """Split a requested clip into temporal diffusion passes of 2-4 s, keeping the final duration exact.
    `CPU_VIDEO_MAX_PASS_S` lowers the cap (2 on an 8 GB Studio: 16 frames is the proven-safe pass size)."""
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
    chunks = []
    while remaining > cap:
        chunks.append(cap)
        remaining -= cap
    if remaining == 1:
        # An odd tail (15 s with a 2 s cap): make the previous pass 3 s instead of leaving an impossible 1 s pass.
        if chunks:
            chunks.pop()
            remaining += cap
        chunks.append(remaining)
    elif remaining:
        chunks.append(remaining)
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
def cv_concat_mp4(clips: list[bytes], expected_seconds: int) -> bytes:
    """Join already-generated H.264 temporal clips into one MP4 without holding decoded full-size frames in RAM."""
    import shutil as _sh
    import subprocess as _sp
    import tempfile as _tf
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        exe = _sh.which("ffmpeg")
    if not exe:
        raise RuntimeError("native-video-unavailable: ffmpeg is required to join the generated video segments")
    if not clips:
        raise RuntimeError("native-video-unavailable: no temporal segments were generated")
    with _tf.TemporaryDirectory(prefix="sham-video-join-") as directory:
        root = __import__("pathlib").Path(directory)
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
        try:
            _sp.run(cmd, check=True, stdout=_sp.PIPE, stderr=_sp.PIPE, timeout=max(180, expected_seconds * 5))
        except Exception as exc:  # noqa: BLE001
            detail = getattr(exc, "stderr", b"")
            if isinstance(detail, bytes):
                detail = detail.decode("utf-8", "replace")
            raise RuntimeError("native-video-unavailable: ffmpeg could not join the generated segments: " + str(detail or exc)[-500:]) from exc
        data = output.read_bytes()
        from media_quality import check_mp4
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
    return cv_concat_mp4(clips, target)


# --- cpu_video END ---
