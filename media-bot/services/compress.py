"""Make a streaming copy of a big video so the Mini App can play it.

Telegram's Bot API only lets a bot download files up to 20MB (getFile: "file is too big"), and the Mini App streams
every clip through that call. The bot still sends users the ORIGINAL file (up to MAX_FILE_BYTES); for the public feed we
publish this smaller copy instead, so every clip can be played inside the Mini App.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Bot API getFile limit is 20 MiB; leave headroom for container overhead.
STREAM_LIMIT_BYTES = int(os.environ.get("STREAM_LIMIT_BYTES", str(19 * 1024 * 1024)))
AUDIO_BPS = 64_000
MIN_VIDEO_BPS = 120_000
COMPRESS_TIMEOUT = int(os.environ.get("COMPRESS_TIMEOUT", "600"))


def pick_height(video_bps: int) -> int:
    """Resolution that stays watchable at the bitrate we can afford."""
    if video_bps >= 1_400_000:
        return 720
    if video_bps >= 800_000:
        return 540
    if video_bps >= 400_000:
        return 480
    return 360


def plan_bitrate(duration_sec: float, limit_bytes: int = STREAM_LIMIT_BYTES, shrink: float = 1.0) -> int:
    """Video bitrate (bits/s) that fits `limit_bytes` for `duration_sec`, with 8% container overhead."""
    if duration_sec <= 0:
        return MIN_VIDEO_BPS
    total_bps = (limit_bytes * 8 * 0.92) / duration_sec * shrink
    return max(MIN_VIDEO_BPS, int(total_bps - AUDIO_BPS))


async def probe_duration(path: Path) -> float:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        return float(out.decode().strip() or 0)
    except Exception as e:
        logger.warning("ffprobe failed for %s: %s", path.name, e)
        return 0.0


async def _encode(src: Path, dst: Path, video_bps: int) -> bool:
    height = pick_height(video_bps)
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", str(src),
        "-vf", f"scale=-2:'min({height},ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-b:v", str(video_bps),
        "-maxrate", str(int(video_bps * 1.25)), "-bufsize", str(video_bps * 2),
        "-c:a", "aac", "-b:a", str(AUDIO_BPS), "-ac", "2",
        "-movflags", "+faststart", "-pix_fmt", "yuv420p", str(dst),
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=COMPRESS_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        logger.warning("ffmpeg timed out compressing %s", src.name)
        return False
    if proc.returncode != 0:
        logger.warning("ffmpeg failed (%s): %s", proc.returncode, (err or b"").decode(errors="replace")[:300])
        return False
    return dst.is_file() and dst.stat().st_size > 1000


async def make_stream_copy(src: Path, limit_bytes: int = STREAM_LIMIT_BYTES) -> tuple[Path | None, float]:
    """Return (path to a copy <= limit_bytes, duration). If `src` already fits, returns (src, duration).
    The caller deletes the returned file when it is not `src` (it lives in its own temp directory)."""
    duration = await probe_duration(src)
    if src.stat().st_size <= limit_bytes:
        return src, duration
    if shutil.which("ffmpeg") is None or duration <= 0:
        return None, duration
    tmpdir = Path(tempfile.mkdtemp(prefix="stream_"))
    dst = tmpdir / "stream.mp4"
    shrink = 1.0
    for _attempt in range(3):
        if await _encode(src, dst, plan_bitrate(duration, limit_bytes, shrink)) and dst.stat().st_size <= limit_bytes:
            return dst, duration
        shrink *= 0.72  # still too big: aim lower and retry
    shutil.rmtree(tmpdir, ignore_errors=True)
    return None, duration


def drop_stream_copy(copy: Path | None, original: Path) -> None:
    if copy is not None and copy != original:
        shutil.rmtree(copy.parent, ignore_errors=True)
