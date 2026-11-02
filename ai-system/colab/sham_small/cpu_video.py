"""Sham v2 real text-to-video on CPU (its own copy: Nova has its own in modelscope-media/app.py; neither imports the other).

AnimateDiff-Lightning + an SD-1.5 realistic base, open weights, ~3 GB. Used by sham_media_ready.py.
"""
from __future__ import annotations

# --- cpu_video BEGIN (byte-identical in colab/sham_small/cpu_video.py and modelscope-media/app.py; a test keeps the copies in sync) ---
# Real text-to-video on CPU: AnimateDiff-Lightning (motion adapter, 4 steps) on an SD-1.5 realistic base (epiCRealism). Open weights (CreativeML OpenRAIL-M),
# about 3 GB on disk, run by our own process. The frames come out of one temporal diffusion pass (never stills stitched into a slideshow).
_CV = {"pipe": None, "dtype": None, "free_noise": False}
CV_MS_BASE, CV_HF_BASE = "songkey/epicrealism_naturalSinRC1VAE", "emilianJR/epiCRealism"
CV_MS_ADAPTER, CV_HF_ADAPTER, CV_ADAPTER_FILE = "AI-ModelScope/AnimateDiff-Lightning", "ByteDance/AnimateDiff-Lightning", "animatediff_lightning_4step_diffusers.safetensors"
_CV_BASE_FILES = ["model_index.json", "scheduler/scheduler_config.json", "feature_extractor/preprocessor_config.json", "tokenizer/*", "text_encoder/config.json",
                  "unet/config.json", "vae/config.json", "text_encoder/*.safetensors", "unet/*.safetensors", "vae/*.safetensors"]


def cv_profile(cpus: int | None = None) -> dict:
    """8 fps real clips. FreeNoise extends the 16-frame motion context to at most 40 frames (5 s); lower CPU profiles can lower CPU_VIDEO_FRAMES explicitly."""
    import os as _os
    n = int(cpus or _os.cpu_count() or 2)
    side = int(_os.environ.get("CPU_VIDEO_SIDE", "") or (512 if n >= 6 else 256))
    frames = int(_os.environ.get("CPU_VIDEO_FRAMES", "") or 40)
    return {"side": max(256, min(512, side // 8 * 8)), "max_frames": max(8, min(40, frames)), "threads": max(1, n), "fps": 8, "out_side": 512, "max_seconds": max(1, min(5, frames / 8))}


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


def _cv_download_repo(repo_id, target, patterns):
    """Download into this Studio's own persistent folder; use the shared ModelScope endpoint/Git-LFS recovery helper when deployed."""
    import os as _os
    from pathlib import Path as _P
    target = _P(target)
    try:
        from model_download import download_model_repo
    except ImportError:  # local notebook / legacy runtime without the deployed helper
        from modelscope import snapshot_download
        snapshot_download(repo_id, local_dir=str(target), allow_patterns=patterns)
        return target
    return download_model_repo(
        repo_id,
        target.parent / "hub-cache",
        token=(_os.environ.get("MODELSCOPE_API_TOKEN") or _os.environ.get("MODELSCOPE_TOKEN") or "").strip(),
        allow_patterns=patterns,
        local_dir=target,
        allow_git_fallback=True,
        timeout_seconds=1800,
    )


def cv_fetch_weights(root):
    """Download this Studio's local copy of the open video weights. The Hub API is tried on both official endpoints, then its Git/LFS transport."""
    import shutil as _sh
    from pathlib import Path as _P
    dest = _P(root) / "video_animatediff"
    dest.mkdir(parents=True, exist_ok=True)
    free = _sh.disk_usage(dest).free
    if free < CV_LEAN_NEED:
        raise RuntimeError(f"native-video-unavailable: the video model needs about 3 GiB free disk; only {free / 1024 ** 3:.1f} GiB is free")
    lean = free < CV_FULL_NEED
    errors = []
    for source in ("modelscope", "huggingface"):
        try:
            if source == "modelscope":
                _cv_download_repo(CV_MS_BASE, dest / "base", _CV_BASE_FILES)
                _cv_download_repo(CV_MS_ADAPTER, dest / "adapter", [CV_ADAPTER_FILE])
            else:
                from huggingface_hub import snapshot_download as hf_download
                hf_download(CV_HF_LEAN_BASE if lean else CV_HF_BASE, local_dir=str(dest / "base"), allow_patterns=_CV_LEAN_FILES if lean else _CV_BASE_FILES)
                if lean:
                    try:
                        _cv_download_repo(CV_MS_ADAPTER, dest / "adapter", [CV_ADAPTER_FILE])
                    except Exception:  # noqa: BLE001
                        hf_download(CV_HF_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
                else:
                    hf_download(CV_HF_ADAPTER, local_dir=str(dest / "adapter"), allow_patterns=[CV_ADAPTER_FILE])
            found = cv_find_weights(root)
            if found:
                return found
            errors.append(f"{source}: files incomplete")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source}: {type(exc).__name__}: {str(exc)[:160]}")
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
    free_noise = False
    enable_free_noise = getattr(pipe, "enable_free_noise", None)
    if callable(enable_free_noise):
        try:
            enable_free_noise(context_length=16, context_stride=4)
        except TypeError:
            enable_free_noise()
        free_noise = True
        split_inference = getattr(pipe, "enable_free_noise_split_inference", None)
        if callable(split_inference):
            try:
                split_inference(spatial_split_size=256, temporal_split_size=16)
            except Exception:  # noqa: BLE001 - optional memory optimization
                pass
        chunking = getattr(pipe.unet, "enable_forward_chunking", None)
        if callable(chunking):
            try:
                chunking(16)
            except Exception:  # noqa: BLE001 - optional memory optimization
                pass
    pipe.to("cpu")
    _CV["pipe"], _CV["dtype"], _CV["free_noise"] = pipe, dtype, free_noise
    return pipe


def cv_release():
    """Free the pipeline's RAM (the Studio also holds a text model). CPU_VIDEO_KEEP=1 keeps it loaded between requests."""
    import gc
    _CV["pipe"] = None
    gc.collect()


def cv_encode_mp4(frames, fps: int = 8, out_side: int = 0) -> bytes:
    """H.264 MP4. Short clips are motion-interpolated; long FreeNoise clips stay at native 8 fps to avoid expensive CPU interpolation."""
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
        scale = f"scale={int(out_side)}:{int(out_side)}:flags=lanczos" if out_side and out_side != frames[0].size[0] else ""
        tail = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
        filters = []
        if scale:
            filters.append(scale)
        if len(frames) <= 16:
            filters.append(f"minterpolate=fps={fps * 2}:mi_mode=mci:mc_mode=aobmc:vsbmc=1")
        cmd = [exe, "-y", "-v", "error", "-framerate", str(fps), "-i", f"{d}/f%03d.png"] + (["-vf", ",".join(filters)] if filters else []) + tail
        try:
            _sp.run(cmd, check=True, timeout=120)
        except Exception as exc:  # noqa: BLE001
            if len(frames) > 16 or not filters:
                raise RuntimeError(f"native-video-unavailable: ffmpeg encode failed: {exc}") from exc
            # Interpolation is optional for short clips. Re-encode at native 8 fps.
            fallback_filters = [scale] if scale else []
            cmd = [exe, "-y", "-v", "error", "-framerate", str(fps), "-i", f"{d}/f%03d.png"] + (["-vf", ",".join(fallback_filters)] if fallback_filters else []) + tail
            _sp.run(cmd, check=True, timeout=120)
        with open(out, "rb") as fh:
            return fh.read()


def cv_generate(root, prompt: str, seconds: float = 3.0, seed: int = 0, env_names=("CPU_VIDEO_MODEL_DIR",)) -> bytes:
    """Prompt -> MP4 bytes at 8 fps, up to 5 seconds. Longer than 16 frames requires FreeNoise; never silently shortens a requested clip."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("native-video-unavailable: a text prompt is required")
    import torch
    prof = cv_profile()
    pipe = cv_pipe(root, env_names)
    requested_frames = max(8, min(40, int(round(float(seconds or 3) * prof["fps"]))))
    if requested_frames > prof["max_frames"]:
        raise RuntimeError(f"native-video-unavailable: this Studio profile supports at most {prof['max_seconds']} seconds; requested {requested_frames / prof['fps']:.1f}s")
    frames = requested_frames
    if frames > 16 and not _CV.get("free_noise"):
        raise RuntimeError("native-video-unavailable: this Diffusers build could not enable FreeNoise for clips longer than 2 seconds")
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
    data = cv_encode_mp4(pil_frames, prof["fps"], prof.get("out_side", 0))
    if not keep:
        del pipe
        cv_release()
    return data
# --- cpu_video END ---
