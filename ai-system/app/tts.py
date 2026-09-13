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

  Arabic  -> edge-tts FIRST, gTTS as a real fallback.
             Owner report, 2026-09-13 (real evidence: a voice reply said
             "شاكرنن" instead of "شاكراً"): gTTS is literally Google
             Translate's simple TTS endpoint — built for reading a
             translated phrase aloud, never for Arabic grammar (tanween,
             case endings), so it mangles exactly the kind of ending
             that complaint shows. edge-tts is a real, free, no-key
             wrapper around Microsoft Edge's own online TTS service —
             the same real neural voices Edge/Word's "Read Aloud"
             feature uses commercially (EDGE_TTS_ARABIC_VOICE in
             config.py), genuinely better at Arabic prosody. Still
             stated plainly: it is an UNOFFICIAL client for a Microsoft
             endpoint (rany2/edge-tts on GitHub) with no SLA, same real
             risk class already hit once in this project (ddgs works
             everywhere except Render's own shared cloud IP, which
             DuckDuckGo blocks) — so gTTS is kept as the real second
             attempt, not deleted, and both fail soft to text-only.
  Anything else -> Cloudflare's melotts, which is a real hosted model on
             hardware we already have free quota on.

Failure in every lane returns None, and main.py's caller treats that as
"text only", which is exactly today's behavior. So the worst case for
this whole feature is the status quo, never a broken or silent reply.

Telegram's sendVoice specifically requires OGG/Opus; an MP3 sent that
way is rejected. Rather than give up the proper voice-note presentation,
the MP3 is transcoded with the ffmpeg binary this project ALREADY ships
and uses (imageio-ffmpeg, see media_finish.py's identical pattern), and
falls back to reporting "mp3" — which main.py then delivers via
sendAudio — if transcoding is unavailable for any reason.
"""
import asyncio
import io
import logging
import os
import re
import subprocess
import tempfile

from app import cloudflare_ai
from app.concurrency import with_hard_deadline
from app.config import EDGE_TTS_ARABIC_VOICE

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


def _edge_tts_blocking(text: str) -> bytes | None:
    """Runs the async edge-tts client to completion in THIS thread via
    asyncio.run() — safe here specifically because tts.synthesize is
    always called from a plain worker thread (a FastAPI BackgroundTask
    running a sync function goes through run_in_threadpool, never the
    main event loop), so there is no already-running loop to conflict
    with. Writes to a real temp file because Communicate.save() is
    itself a file-writing coroutine, not something that hands back
    bytes directly."""
    import edge_tts

    async def _run() -> bytes:
        workdir = tempfile.mkdtemp()
        out_path = os.path.join(workdir, "out.mp3")
        communicate = edge_tts.Communicate(text, EDGE_TTS_ARABIC_VOICE, connect_timeout=10, receive_timeout=20)
        await communicate.save(out_path)
        with open(out_path, "rb") as f:
            return f.read()

    return asyncio.run(_run())


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
        # edge-tts first (real neural voice, correct grammar/prosody —
        # see this module's docstring), gTTS as the real second attempt
        # since edge-tts is itself an unofficial client with no SLA of
        # its own. A 25s outer deadline (module already sets its own
        # ~20s receive_timeout; wrapped again here for the same reason
        # every other real network call in this project is: a hung
        # thread inside asyncio has, in the past, outlasted a library's
        # own nominal timeout).
        try:
            raw_mp3 = with_hard_deadline(_edge_tts_blocking, spoken, timeout=25)
        except Exception as e:
            logger.info("tts: edge-tts failed (%s) — trying gTTS next", e)
            raw_mp3 = None
        if not raw_mp3:
            try:
                from gtts import gTTS

                buffer = io.BytesIO()
                gTTS(text=spoken, lang="ar").write_to_fp(buffer)
                raw_mp3 = buffer.getvalue()
            except Exception as e:
                # Expected failure mode, not an exceptional one — see
                # this module's docstring on Render's shared IP.
                logger.info("tts: Arabic synthesis via gTTS also failed (%s) — replying with text only", e)
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
