"""
Owner spec, 2026-09-13 ("الردود الصوتية"): Nova could already SYNTHESIZE
speech — cloudflare_ai.generate_speech has existed since the Cloudflare
integration — but no user could ever hear it. It was wired only into
video narration, so the "صوت" medium the owner asked for was, in
practice, missing entirely.

The blocker that made this its own module rather than three lines in
main.py is real and was verified, not assumed: the TTS model this
project already configured (CLOUDFLARE_TTS_MODEL, @cf/myshell-ai/melotts)
does NOT support Arabic. MeloTTS's own documentation lists exactly six
languages — English (several accents), Spanish, French, Chinese,
Japanese, Korean. Arabic is not one of them. Since the owner speaks
Arabic, shipping "voice replies" on that model alone would have shipped
a feature that fails for its only real user.

So there are two lanes, chosen by the script of the text itself:

  Arabic  -> gTTS. Genuinely free, no key, real Arabic support. Stated
             plainly: it is an UNOFFICIAL wrapper around Google
             Translate's TTS endpoint with no SLA, and this project has
             already been bitten once by exactly this class of
             dependency (ddgs works fine anywhere except Render's own
             shared cloud IP, which DuckDuckGo blocks). The same may
             well happen here. That is survivable by design — see below.
  Anything else -> Cloudflare's melotts, which is a real hosted model on
             hardware we already have free quota on.

Failure in either lane returns None, and main.py's caller treats that
as "text only", which is exactly today's behavior. So the worst case for
this whole feature is the status quo, never a broken or silent reply.

Telegram's sendVoice specifically requires OGG/Opus; an MP3 sent that
way is rejected. Rather than give up the proper voice-note presentation,
the MP3 is transcoded with the ffmpeg binary this project ALREADY ships
and uses (imageio-ffmpeg, see media_finish.py's identical pattern), and
falls back to reporting "mp3" — which main.py then delivers via
sendAudio — if transcoding is unavailable for any reason.
"""
import io
import logging
import os
import re
import subprocess
import tempfile

from app import cloudflare_ai

logger = logging.getLogger("nova")

_ARABIC_CHARS = re.compile(r"[؀-ۿ]")

# A spoken reply is a courtesy, not a transcript — the full text is
# always delivered alongside it. Capping keeps synthesis fast on a free
# CPU box and keeps the voice note listenable instead of a four-minute
# monologue.
_MAX_CHARS = 600


def _shorten(text: str) -> str:
    clean = (text or "").strip()
    if len(clean) <= _MAX_CHARS:
        return clean
    cut = clean[:_MAX_CHARS]
    for terminator in ("\n", ". ", "؟ ", "! ", "، "):
        index = cut.rfind(terminator)
        if index > _MAX_CHARS // 2:
            return cut[: index + 1].strip()
    return cut.strip()


def is_arabic(text: str) -> bool:
    return bool(_ARABIC_CHARS.search(text or ""))


def _to_ogg_opus(mp3_bytes: bytes) -> bytes | None:
    """Same bundled-static-ffmpeg approach media_finish.finish_video
    already uses — no system package, no new dependency."""
    try:
        import imageio_ffmpeg

        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        logger.info("tts: imageio-ffmpeg unavailable — delivering MP3 instead of a voice note")
        return None

    workdir = tempfile.mkdtemp()
    src = os.path.join(workdir, "in.mp3")
    dst = os.path.join(workdir, "out.ogg")
    try:
        with open(src, "wb") as f:
            f.write(mp3_bytes)
        subprocess.run(
            [ffmpeg_exe, "-y", "-i", src, "-c:a", "libopus", "-b:a", "32k", dst],
            check=True, capture_output=True, timeout=60,
        )
        with open(dst, "rb") as f:
            return f.read()
    except Exception as e:
        logger.info("tts: OGG/Opus transcode failed (%s) — delivering MP3 instead", e)
        return None


def synthesize(text: str) -> tuple[bytes, str] | None:
    """Returns (audio_bytes, "ogg"|"mp3"), or None when speech could not
    be produced at all. Never raises: every caller is on a path that has
    already delivered the real text answer, and a failed voice extra
    must never turn a successful reply into an error."""
    spoken = _shorten(text)
    if not spoken:
        return None

    raw_mp3 = None
    if is_arabic(spoken):
        try:
            from gtts import gTTS

            buffer = io.BytesIO()
            gTTS(text=spoken, lang="ar").write_to_fp(buffer)
            raw_mp3 = buffer.getvalue()
        except Exception as e:
            # Expected failure mode, not an exceptional one — see this
            # module's docstring on Render's shared IP.
            logger.info("tts: Arabic synthesis via gTTS failed (%s) — replying with text only", e)
            return None
    else:
        try:
            raw_mp3 = cloudflare_ai.generate_speech(spoken)
        except Exception as e:
            logger.info("tts: Cloudflare TTS failed (%s) — replying with text only", e)
            return None

    if not raw_mp3:
        return None

    ogg = _to_ogg_opus(raw_mp3)
    return (ogg, "ogg") if ogg else (raw_mp3, "mp3")
