"""Spoken replies ("voice in, voice out") with Nova's OWN local voice.

Speech is synthesised by Nova's media Studio (modelscope-media/app.py): the packaged Piper Arabic voice (open weights) run on CPU by our own code.
No external TTS service is called (no Cloudflare Workers AI, no Microsoft Edge TTS, no Google Translate TTS). Text that is not Arabic gets no voice note
(the Arabic voice cannot read it) and the text answer, which was already delivered, stands alone.

Telegram's sendVoice needs OGG/Opus, so the WAV is transcoded with the ffmpeg binary this project already ships (imageio-ffmpeg); without it the WAV is returned
and main.py delivers it as an audio file. Every failure returns None: a voice extra must never turn a delivered answer into an error.
"""
import logging
import os
import re
import subprocess
import tempfile

from app import nova_media_studio

logger = logging.getLogger("nova")

_ARABIC_CHARS = re.compile(r"[\u0600-\u06FF]")
_MAX_CHARS = 600


def _shorten(text: str) -> str:
    clean = (text or "").strip()
    if len(clean) <= _MAX_CHARS:
        return clean
    cut = clean[:_MAX_CHARS]
    for terminator in ("\n", ". ", "\u061f ", "! ", "\u060c "):
        index = cut.rfind(terminator)
        if index > _MAX_CHARS // 2:
            return cut[: index + 1].strip()
    return cut.strip()


def is_arabic(text: str) -> bool:
    return bool(_ARABIC_CHARS.search(text or ""))


def _to_ogg_opus(wav_bytes: bytes) -> bytes | None:
    try:
        import imageio_ffmpeg

        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        logger.info("tts: imageio-ffmpeg unavailable - delivering WAV instead of a voice note")
        return None
    workdir = tempfile.mkdtemp()
    src, dst = os.path.join(workdir, "in.wav"), os.path.join(workdir, "out.ogg")
    try:
        with open(src, "wb") as f:
            f.write(wav_bytes)
        subprocess.run([ffmpeg_exe, "-y", "-i", src, "-c:a", "libopus", "-b:a", "32k", dst], check=True, capture_output=True, timeout=60)
        with open(dst, "rb") as f:
            return f.read()
    except Exception as e:
        logger.info("tts: OGG/Opus transcode failed (%s) - delivering WAV instead", e)
        return None


def synthesize(text: str) -> tuple[bytes, str] | None:
    """(audio_bytes, "ogg"|"wav"), or None when no speech could be produced. Never raises."""
    spoken = _shorten(text)
    if not spoken or not is_arabic(spoken):
        return None
    try:
        wav = nova_media_studio.generate_media("audio", spoken, timeout=120)
    except Exception as e:
        logger.info("tts: Nova's own voice failed (%s) - replying with text only", e)
        return None
    if not wav:
        return None
    ogg = _to_ogg_opus(wav)
    return (ogg, "ogg") if ogg else (wav, "wav")
