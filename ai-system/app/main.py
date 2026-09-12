"""
Nova AI — the single "brain" FastAPI service. Every client channel
(the NOVA_BOT Telegram template inside Ttbik, the Streamlit web UI, and
external API consumers) calls this same /chat endpoint — no AI logic
is duplicated anywhere else, so there is exactly one place to fix bugs
or improve the council/RAG/routing.

Run locally:  uvicorn app.main:app --reload --port 8000
Deploy free:  Render.com (Docker web service, free instance type) — see
              ai-system/README.md. (Not Hugging Face Spaces — HF now
              gates Docker/Gradio Spaces behind a paid PRO plan; HF is
              still used for free model storage only, via the Colab
              notebook pushing to HF Hub.)
"""
import base64
import logging
import re
import threading

import requests
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import council, files, quota, rag, router
from app.config import NOVA_BOT_TOKEN, NOVA_INTERNAL_SECRET

# Without this, logger.info() calls throughout this file and council.py
# (added 2026-09-06 to show which model actually answered each message)
# are silently dropped — Python's root logger defaults to WARNING, so
# INFO-level records never reach any handler unless a level is set
# explicitly. Uvicorn's own "INFO:  ...200 OK" lines you see in Render's
# Logs are unaffected either way — those come from uvicorn's own loggers,
# configured independently of this one.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nova")
app = FastAPI(title="Nova AI")


# Same stripping novaBotLogic.ts's old stripMarkdown() used to do
# before that file stopped rendering answers itself — needed here now
# instead, since every answer (text and image alike) is delivered
# straight to Telegram from this backend (see _send_telegram_message
# below) rather than routed back through the Next.js webhook, which
# used to be the only place doing this.
def _strip_markdown(text: str) -> str:
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text)
    return text


def _send_telegram_message(chat_id: str, text: str) -> None:
    if not NOVA_BOT_TOKEN:
        logger.warning("NOVA_BOT_TOKEN not set on Render — cannot deliver async answer to Telegram chat_id=%s", chat_id)
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{NOVA_BOT_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=15,
        )
    except Exception:
        logger.exception("Failed to deliver async answer to Telegram chat_id=%s", chat_id)


def _send_telegram_photo(chat_id: str, photo_bytes: bytes, caption: str) -> None:
    """Same async-delivery shape as _send_telegram_message above, but
    for a generated image — sendPhoto needs a real multipart file
    upload, not a JSON body. Added 2026-09-09 alongside moving image
    generation from Hugging Face's free tier (which refuses to serve
    our own repo — real evidence, not guessed) to our own ModelScope
    Studio: CPU-only Stable Diffusion inference is genuinely slow, so
    /generate-image is no longer synchronous either (see that endpoint
    below) — the old assumption that it would "answer inline fast
    enough" only held while it was calling a third party's own
    infrastructure, not ours."""
    if not NOVA_BOT_TOKEN:
        logger.warning("NOVA_BOT_TOKEN not set on Render — cannot deliver async photo to Telegram chat_id=%s", chat_id)
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{NOVA_BOT_TOKEN}/sendPhoto",
            data={"chat_id": chat_id, "caption": caption},
            files={"photo": ("nova.png", photo_bytes, "image/png")},
            timeout=60,
        )
    except Exception:
        logger.exception("Failed to deliver async photo to Telegram chat_id=%s", chat_id)


def _send_telegram_video(chat_id: str, video_bytes: bytes, caption: str) -> None:
    """Same async-delivery shape as _send_telegram_message above, but
    for a generated video file — sendVideo needs a real multipart file
    upload, not a JSON body, and a longer timeout since video files run
    much larger than a text payload."""
    if not NOVA_BOT_TOKEN:
        logger.warning("NOVA_BOT_TOKEN not set on Render — cannot deliver async video to Telegram chat_id=%s", chat_id)
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{NOVA_BOT_TOKEN}/sendVideo",
            data={"chat_id": chat_id, "caption": caption},
            files={"video": ("nova.mp4", video_bytes, "video/mp4")},
            timeout=60,
        )
    except Exception:
        logger.exception("Failed to deliver async video to Telegram chat_id=%s", chat_id)


def _keep_typing_loop(chat_id: str, stop_event: threading.Event, interval: int = 4, action: str = "typing") -> None:
    """Owner spec, 2026-09-08 (Gemini architecture review, "مؤشر الانتظار
    المستمر"): Telegram's own "typing..." indicator auto-expires after
    ~5s, but real generation on ModelScope's free CPU-only box takes
    45-95s+ — far longer than one indicator covers. novaBotLogic.ts
    (Vercel) can't just keep resending it either: that function already
    returns immediately after one initial ping, precisely so Vercel's
    own 60s ceiling never has to wait for the real answer (see chat()
    below) — by the time the real work is happening, Vercel's request
    has already ended. So this has to run right here, in the background
    task that's actually alive for the whole duration.
    Uses threading (not asyncio) since _process_chat_and_deliver and its
    siblings below are plain sync functions run by FastAPI's own
    BackgroundTasks threadpool, not async ones — an asyncio event loop
    would need its own thread anyway, so a plain Event+sleep loop is the
    direct fit for the code already here, not a rewrite for its own sake."""
    if not NOVA_BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{NOVA_BOT_TOKEN}/sendChatAction"
    while not stop_event.is_set():
        try:
            requests.post(url, json={"chat_id": chat_id, "action": action}, timeout=5)
        except Exception:
            pass  # a dropped ping is never worth interrupting the loop over
        stop_event.wait(interval)


def _start_typing_loop(chat_id: str, action: str = "typing") -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    thread = threading.Thread(target=_keep_typing_loop, args=(chat_id, stop_event), kwargs={"action": action}, daemon=True)
    thread.start()
    return stop_event, thread


def _stop_typing_loop(stop_event: threading.Event, thread: threading.Thread) -> None:
    stop_event.set()
    thread.join(timeout=5)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Without this, any unhandled exception (e.g. a missing env var like
    # SUPABASE_URL) falls through to Starlette's default plain-text 500
    # response, which isn't valid JSON — every client here (novaBotLogic.ts,
    # streamlit_app.py) parses the body as JSON and reads `.detail`, so an
    # unparseable body silently became a generic "حدث خطأ" with zero
    # diagnostic info. This logs the real exception server-side (visible in
    # Render's logs) and returns a JSON body every caller can actually read.
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


class ChatRequest(BaseModel):
    channel: str  # TELEGRAM | WEB | API
    message: str
    telegram_id: str | None = None
    email: str | None = None
    # TELEGRAM only — when set, the answer is delivered directly to this
    # chat once ready instead of being returned in this response (see
    # chat() below). WEB/API never send this and always get answer
    # inline, same as before.
    chat_id: str | None = None


class ChatResponse(BaseModel):
    accepted: bool
    quota_message: str
    answer: str | None = None
    query_type: str | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


def _authorize(channel: str, authorization: str | None, x_internal_secret: str | None) -> str | None:
    """Returns the apiKey to use for API channel, or None. Raises 401
    on any authorization failure."""
    if channel in ("TELEGRAM", "WEB"):
        if not NOVA_INTERNAL_SECRET or x_internal_secret != NOVA_INTERNAL_SECRET:
            raise HTTPException(
                status_code=401,
                detail="missing/invalid X-Internal-Secret — only Ttbik's own NOVA_BOT/Streamlit servers may call this channel",
            )
        return None

    if channel == "API":
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing Authorization: Bearer <apiKey>")
        return authorization.removeprefix("Bearer ").strip()

    raise HTTPException(status_code=400, detail=f"unknown channel: {channel}")


def _resolve_and_authorize(
    channel: str,
    telegram_id: str | None,
    email: str | None,
    authorization: str | None,
    x_internal_secret: str | None,
) -> dict:
    api_key = _authorize(channel, authorization, x_internal_secret)
    try:
        return quota.resolve_or_create_user(channel, telegram_id=telegram_id, email=email, api_key=api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _enforce_quota(user: dict, kind: str = "TEXT") -> str:
    allowed, _remaining, quota_message = quota.check_and_reserve_quota(user, kind)
    if not allowed:
        raise HTTPException(status_code=429, detail=quota_message)
    return quota_message


def _maybe_flag_previous_answer(user_id: str, new_message: str) -> None:
    """Silent thumbs-down detector (owner spec 2026-09-08, replacing
    visible 👍/👎 buttons — real risk of an accidental tap, and one
    fewer screen element for the user to deal with). Runs right before
    generating the NEW answer, so it judges the PREVIOUS turn based on
    how the user actually reacted to it — see
    council.detect_dissatisfaction. Never raises; a failure here just
    means one fewer DPO example, never a blocked chat."""
    try:
        prev = quota.get_last_usage_log(user_id)
        if not prev or prev.get("rating") or not prev.get("answer"):
            return
        if council.detect_dissatisfaction(prev["answer"], new_message):
            quota.set_feedback(prev["id"], "DOWN")
            logger.info("passive feedback: flagged log %s as DOWN from the user's own follow-up message", prev["id"])
    except Exception:
        logger.exception("passive feedback detection failed — skipping")


def _run_text_pipeline(user: dict, channel: str, message: str) -> tuple[str, str, str]:
    """The one shared brain path: flag previous answer if the user's
    new message reads as a complaint about it -> classify -> build
    context (memory + live search/knowledge bank) -> council answer ->
    log + remember. Used directly for WEB/API channels, and inside a
    FastAPI BackgroundTask for TELEGRAM (see chat()/voice()/
    file_endpoint() below) — no BackgroundTasks parameter here on
    purpose, since this function itself now runs *as* a background
    task on the TELEGRAM path and there is no request/response cycle
    left to defer onto by that point.

    Owner report, 2026-09-08: real Render log evidence — the
    self-critique response format (ModelScope app.py's <تفكير>/<اجابة>
    tags) pushed real text generation time to 70-95s+ per answer,
    confirmed live ("ModelScope POST" to "answer: served by OUR OWN
    model" timestamps 89s, 96s, 69s apart). That is past both
    novaBotLogic.ts's 55s fetch abort and Vercel's 60s maxDuration —
    the exact same failure mode /image already hit (see that
    endpoint's docstring) and was fixed the same way: schedule the
    real work as a background task and deliver the answer straight to
    Telegram once it's ready, instead of racing a deadline that no
    longer fits.

    Owner spec, 2026-09-08 (Gemini architecture review — real semantic
    caching): before paying that 45-95s generation cost at all, check
    rag.recall_cached_answer for a near-duplicate question already
    answered (CODE/GENERAL only — see that function's own comment for
    the conservative distance threshold and why). A cache hit skips
    build_context/council.answer entirely and returns the past answer
    verbatim in effectively zero time; a miss falls through to the
    normal path exactly as before this existed."""
    _maybe_flag_previous_answer(user["id"], message)
    query_type = router.classify(message)

    cached_answer = rag.recall_cached_answer(message, query_type)
    if cached_answer:
        logger.info("chat answer: served from semantic cache — model call skipped")
        log_id = quota.log_usage(user["id"], channel, query_type, message, cached_answer)
        rag.remember(user["id"], message, cached_answer)
        return cached_answer, query_type, log_id

    context = rag.build_context(user["id"], message, query_type)
    # Owner spec, 2026-09-12 ("نريد جعل نوفا يتعرف علي كمالك"): distinct
    # from the quota/plan exemption above (quota.is_platform_owner
    # already existed and is unrelated to this) — this is about how
    # Nova ADDRESSES the owner in conversation, not what they're allowed
    # to do. Same real check quota.py already uses for the plan
    # exemption, reused here rather than a second, drifting definition.
    final_answer = council.answer(message, context, query_type=query_type, is_owner=quota.is_platform_owner(user))
    log_id = quota.log_usage(user["id"], channel, query_type, message, final_answer)
    rag.remember(user["id"], message, final_answer)
    rag.remember_shared(message, final_answer, query_type)
    return final_answer, query_type, log_id


def _recent_context_for_intent(user_id: str) -> str:
    """Feeds council.classify_intent the same kind of memory a person
    would use to understand a short follow-up ("قطة سوداء تحت المطر"
    right after the assistant asked what to draw) — see that
    function's own docstring for why this replaced keyword-matching and
    the bot's old force_reply trick."""
    prev = quota.get_last_usage_log(user_id)
    if not prev:
        return ""
    return f"آخر رسالة من المستخدم: {prev.get('message') or ''}\nآخر رد من المساعد: {prev.get('answer') or ''}"


def _dispatch_media_intent(user: dict, channel: str, chat_id: str, message: str, intent: str, expanded_prompt: str) -> None:
    """council.classify_intent already decided (via real model
    understanding, not a keyword match) that this message is an
    image/video request and already produced the professional prompt —
    this just reserves the correct quota bucket and hands off to the
    same background generation pipelines /generate-image and
    /generate-video use, passing expanded_prompt through so it's never
    computed twice."""
    seconds = 0
    if intent == "VIDEO":
        requested_seconds = _parse_requested_seconds(message)
        duration_ok, seconds, duration_message = quota.check_video_duration(user, requested_seconds)
        if not duration_ok:
            _send_telegram_message(chat_id, duration_message)
            return

    allowed, _remaining, quota_message = quota.check_and_reserve_quota(user, "IMAGE")
    if not allowed:
        _send_telegram_message(chat_id, quota_message)
        return

    if intent == "IMAGE":
        _send_telegram_message(chat_id, "🖼 جارٍ توليد الصورة — قد يستغرق الأمر بضع دقائق، ستصلك هنا فور الانتهاء.")
        _process_image_gen_and_deliver(user["id"], channel, chat_id, message, expanded_prompt=expanded_prompt)
    else:
        _send_telegram_message(chat_id, "🎬 جارٍ توليد الفيديو — قد يستغرق الأمر عدة دقائق، سيصلك هنا فور الانتهاء.")
        _process_video_and_deliver(user["id"], channel, chat_id, message, seconds, expanded_prompt=expanded_prompt)


def _process_chat_and_deliver(user: dict, channel: str, message: str, chat_id: str) -> None:
    # This runs inside a FastAPI BackgroundTask, AFTER the HTTP response
    # (accepted: true) has already gone out — there is no request/response
    # cycle left for an exception here to surface on. Without this
    # try/except, any failure in _run_text_pipeline (council.answer,
    # quota.log_usage, rag.remember/remember_shared all hit a live network
    # call or DB and can throw) would propagate out of this function,
    # Starlette would just log it internally, and the user would be left
    # staring at the "🤔 جارٍ التفكير..." ack forever with nothing ever
    # arriving — a real silent-failure risk with zero visibility outside
    # Render's own logs, unlike the sync WEB/API path which still has
    # unhandled_exception_handler above to turn it into a real response.

    # Owner correction, 2026-09-09 ("ليس هدفنا البوت... اذا وضعنا اوامر
    # اجبارية... سيكون مبرمج على الاجبار وليس الذكاء المعرفي"): every
    # plain-text message — not just ones with a recognized verb, not
    # just replies to a force_reply marker — is understood here by OUR
    # OWN model exactly the way a real assistant would, using
    # conversation memory instead of rigid syntax. See
    # council.classify_intent's docstring for the full reasoning.
    #
    # Real regression fix, 2026-09-09 (evidence: "مرحبا" and "الووو" both
    # got zero reply for minutes): a bare word or two structurally cannot
    # be a real image/video description (a real one needs at least a
    # subject), so skipping classification for anything this short isn't
    # a content-based keyword decision — it's the same kind of "too short
    # to be that" reasoning a person applies before even considering
    # whether "hi" might be an image request. Saves a whole model call
    # (this session's other fix already made it Groq-first/fast, but
    # skipping it entirely for real non-candidates is strictly safer on
    # an already-strained free CPU box) for the overwhelming majority of
    # ordinary chat turns.
    if len(message.strip()) < 8:
        intent_result = {"intent": "TEXT", "prompt": ""}
    else:
        try:
            intent_result = council.classify_intent(message, _recent_context_for_intent(user["id"]))
        except Exception:
            logger.exception("intent classification failed for chat_id=%s — defaulting to a normal text answer", chat_id)
            intent_result = {"intent": "TEXT", "prompt": ""}

    if intent_result["intent"] in ("IMAGE", "VIDEO"):
        # chat() below already reserved one TEXT quota unit before
        # scheduling this background task — refund it now that real
        # understanding says this is actually a media request, then
        # _dispatch_media_intent reserves the correct IMAGE/VIDEO unit.
        quota.refund_quota(user["id"], "TEXT")
        _dispatch_media_intent(user, channel, chat_id, message, intent_result["intent"], intent_result["prompt"])
        return

    stop_typing, typing_thread = _start_typing_loop(chat_id)
    try:
        final_answer, _query_type, _log_id = _run_text_pipeline(user, channel, message)
    except Exception:
        logger.exception("background chat pipeline failed for chat_id=%s — sending an error message instead of leaving the user with silence", chat_id)
        final_answer = "حدث خطأ أثناء توليد الإجابة — حاول مرة أخرى."
    finally:
        _stop_typing_loop(stop_typing, typing_thread)
    _send_telegram_message(chat_id, _strip_markdown(final_answer))


@app.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """TELEGRAM (chat_id set): schedules the answer as a background task
    and returns immediately — see _run_text_pipeline's docstring for
    why. WEB/API: answers inline as before, since Streamlit/external
    callers have no chat_id to push a deferred answer to and must get
    it back in this same response."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    if req.channel == "TELEGRAM" and req.chat_id:
        background_tasks.add_task(_process_chat_and_deliver, user, req.channel, req.message, req.chat_id)
        return ChatResponse(accepted=True, quota_message=quota_message)

    final_answer, query_type, _log_id = _run_text_pipeline(user, req.channel, req.message)
    return ChatResponse(accepted=True, answer=final_answer, query_type=query_type, quota_message=quota_message)


class VoiceRequest(BaseModel):
    channel: str
    audio_base64: str
    filename: str = "voice.ogg"
    telegram_id: str | None = None
    email: str | None = None
    chat_id: str | None = None  # TELEGRAM only — see ChatRequest.chat_id


class VoiceResponse(BaseModel):
    accepted: bool
    quota_message: str
    transcript: str | None = None
    answer: str | None = None
    query_type: str | None = None


@app.post("/voice", response_model=VoiceResponse)
def voice(
    req: VoiceRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """Free voice-message support via Groq's own hosted Whisper (same
    API key, no extra cost): transcribe (fast), then run the transcript
    through the exact same pipeline /chat uses — deferred for TELEGRAM,
    inline for WEB/API, same reasoning as chat() above."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    audio_bytes = base64.b64decode(req.audio_base64)
    transcript = council.transcribe_voice(audio_bytes, req.filename)
    if not transcript.strip():
        raise HTTPException(status_code=422, detail="تعذّر فهم الرسالة الصوتية — حاول مرة أخرى بوضوح أكبر.")

    if req.channel == "TELEGRAM" and req.chat_id:
        background_tasks.add_task(_process_chat_and_deliver, user, req.channel, transcript, req.chat_id)
        return VoiceResponse(accepted=True, quota_message=quota_message, transcript=transcript)

    final_answer, query_type, _log_id = _run_text_pipeline(user, req.channel, transcript)
    return VoiceResponse(accepted=True, transcript=transcript, answer=final_answer, query_type=query_type, quota_message=quota_message)


class ImageRequest(BaseModel):
    channel: str
    image_base64: str
    caption: str | None = None
    mime_type: str = "image/jpeg"
    telegram_id: str | None = None
    email: str | None = None
    # Telegram chat id to deliver the answer to once it's actually ready
    # (see image() below for why this is no longer returned inline in
    # the HTTP response). Only set by novaBotLogic.ts today — /image has
    # no other caller (Streamlit only ever calls /chat).
    chat_id: str | None = None


class ImageResponse(BaseModel):
    accepted: bool
    quota_message: str


def _process_image_and_deliver(
    user_id: str, channel: str, chat_id: str | None, prompt: str, image_base64: str, mime_type: str
) -> None:
    """The actual slow work, run in a FastAPI BackgroundTask (see image()
    below) — Render is a persistent process, not a serverless function,
    so there is no execution-time ceiling here once the HTTP response
    has already gone out."""
    # Same reasoning as _process_chat_and_deliver above: this also runs
    # as a FastAPI BackgroundTask after the HTTP response is already
    # gone, so an uncaught exception here (base64 decode, quota.log_usage
    # or rag.remember hitting a dead DB, etc.) would otherwise vanish
    # into Starlette's own logs with the user never hearing back at all.
    stop_typing, typing_thread = _start_typing_loop(chat_id) if chat_id else (None, None)
    try:
        answer_text = council.call_modelscope_specialist(prompt, "", image_base64=image_base64)
        if answer_text:
            logger.info("image answer: served by OUR OWN model (ModelScope)")
        else:
            image_bytes = base64.b64decode(image_base64)
            answer_text = council.call_gemini_vision(image_bytes, prompt, mime_type)
            logger.info("image answer: our own model unavailable — served by Gemini fallback" if answer_text else "image answer: both our model and Gemini fallback failed")
        if answer_text is None:
            answer_text = "تعذّر تحليل الصورة حالياً — تأكد من ضبط MODELSCOPE_SPACE_URL أو GEMINI_API_KEY على الخادم، أو حاول مرة أخرى لاحقاً."

        quota.log_usage(user_id, channel, "IMAGE", f"[صورة] {prompt}", answer_text)
        rag.remember(user_id, f"[صورة] {prompt}", answer_text)
    except Exception:
        logger.exception("background image pipeline failed for chat_id=%s — sending an error message instead of leaving the user with silence", chat_id)
        answer_text = "تعذّر تحليل الصورة حالياً — حدث خطأ غير متوقع، حاول مرة أخرى لاحقاً."
    finally:
        if stop_typing:
            _stop_typing_loop(stop_typing, typing_thread)

    if chat_id:
        _send_telegram_message(chat_id, _strip_markdown(answer_text))


@app.post("/image", response_model=ImageResponse)
def image(
    req: ImageRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """OUR OWN model answers image questions first (see council.py's
    module docstring) — served the same way text is, via the
    ModelScope-hosted Qwen2.5-VL Studio (call_modelscope_specialist
    with image_base64 set). Gemini's free multimodal tier is only the
    same emergency fallback Groq is for text: used before our own
    vision-capable model has been trained/configured, or if it's
    genuinely unreachable.

    Owner report, 2026-09-07: measured live via the Studio's own
    runtime log — the vision encoder alone (clip_encode) took ~241s for
    one photo on this box's CPU-only hardware, before a single answer
    token is generated. That's far past Vercel's 60s function ceiling
    novaBotLogic.ts's webhook route is bound by (confirmed live: the
    real Telegram request failed with "تعذر الاتصال بخادم Nova AI" —
    the caller's own fetch had already given up long before the model
    was done). Computing the answer inline and returning it in this
    response can therefore never work for vision, no matter how the
    timeouts here are tuned — so this endpoint now only *schedules* the
    real work as a background task and returns immediately; the actual
    answer is delivered straight to Telegram once it's ready (see
    _process_image_and_deliver / _send_telegram_message above), fully
    decoupled from this request's own lifetime."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user, "IMAGE")

    prompt = req.caption or "صف هذه الصورة بالتفصيل وأجب عن أي سؤال ضمني فيها."
    background_tasks.add_task(
        _process_image_and_deliver, user["id"], req.channel, req.chat_id, prompt, req.image_base64, req.mime_type
    )

    return ImageResponse(accepted=True, quota_message=quota_message)


class GenerateImageRequest(BaseModel):
    channel: str
    prompt: str
    telegram_id: str | None = None
    email: str | None = None
    # Owner spec, 2026-09-09: async now, chat_id required — see
    # _process_image_gen_and_deliver's docstring for why (moved off
    # Hugging Face's free tier, which refuses our own repo, onto our
    # own CPU-only ModelScope Studio, which is genuinely slow).
    chat_id: str


class GenerateImageResponse(BaseModel):
    accepted: bool
    quota_message: str


def _process_image_gen_and_deliver(
    user_id: str, channel: str, chat_id: str, prompt: str, expanded_prompt: str | None = None
) -> None:
    """Runs in a FastAPI BackgroundTask — see _process_video_and_deliver
    above for why this needs its own try/except (no HTTP response left
    to surface an exception on once this starts).

    Owner spec, 2026-09-09: this used to be synchronous, answering
    inline in the HTTP response — that assumption held only while
    council.generate_image() was calling a third party's own hosted
    Stable Diffusion (fast). Real evidence (Render logs, same day) that
    Hugging Face's free tier refuses our own repo moved this to our own
    ModelScope Studio instead, where CPU-only inference is genuinely
    slow — same fix, same async-delivery shape as /image and
    /generate-video above, for the same underlying reason.

    expanded_prompt: pre-computed professional prompt, passed in when
    council.classify_intent already produced one during real intent
    understanding (see _dispatch_media_intent below) — avoids paying
    for a second, redundant model call. None (the explicit /صورة
    command path, which never goes through classify_intent) still
    expands it here exactly as before."""
    try:
        # Owner spec, 2026-09-09 ("ليصبح انشاء الوسائط... مفهوم واكثر
        # دقة واحترافية"): the Stable Diffusion weights themselves are
        # never fine-tuned by us — the real, cheap lever is having OUR
        # OWN text model (already fine-tuned weekly) turn a short
        # request into a detailed professional prompt first. Real cost
        # stated plainly: this adds a full extra model call (another
        # 45-95s+ on this CPU box) before generation even starts.
        expanded_prompt = expanded_prompt or council.expand_media_prompt(prompt, "image")
        if expanded_prompt != prompt:
            # Logged as a real (instruction, expansion) training pair
            # into the SAME NovaUsageLog table and weekly fetch every
            # other real conversation already feeds into training
            # (merge_and_finetune.ipynb's cell 4 has no query_type
            # filter) — no new Kaggle-side code needed for this skill
            # to keep improving. Skipped when expansion fell back to
            # the raw prompt (both our model and Groq failed) — that
            # would just teach the model to echo input unchanged.
            #
            # Owner report, 2026-09-09 (real evidence, screenshot): this
            # internal instruction/expansion pair was showing up in
            # "📜 سجل المحادثات" and the web dashboard as if it were a
            # real user question — both read NovaUsageLog rows with
            # message IS NOT NULL and no queryType filter at all. Real
            # fix: a dedicated queryType ("PROMPT_EXPANSION", not
            # "GENERAL") that src/app/api/nova/me/route.ts now excludes
            # from recentLogs — training still ingests it fine since
            # that fetch has no queryType filter either.
            quota.log_usage(
                user_id, channel, "PROMPT_EXPANSION",
                f"حوّل هذا الطلب إلى وصف احترافي مفصّل لتوليد صورة بالذكاء الاصطناعي: {prompt}",
                expanded_prompt,
            )
        image_bytes = council.generate_image(expanded_prompt)
        if image_bytes is None:
            # Owner report, 2026-09-09 (real evidence): a failure here
            # is almost always the ModelScope Studio still rebuilding
            # after a code push (this endpoint is new), not a missing
            # config value — MODELSCOPE_SPACE_URL/TOKEN are already
            # confirmed working for text chat on this same server. The
            # quota unit this request already reserved (see
            # main.py's generate_image() endpoint below /
            # quota.check_and_reserve_quota) is refunded here since this
            # failure is never the user's fault.
            quota.refund_quota(user_id, "IMAGE")
            # Owner report, 2026-09-09 (real evidence): the server had
            # been confirmed up and stable for 30+ minutes, ruling out
            # the old message's guessed "still restarting" cause — that
            # guess is gone. council.generate_image now logs the real
            # POST/GET status and, on a stream that ends with no usable
            # result, the raw SSE lines too (see that function), so the
            # next failure is diagnosable from Render's own logs instead
            # of guessed at again.
            _send_telegram_message(
                chat_id,
                "تعذّر توليد الصورة هذه المرة — إما أن التوليد الفعلي (بلا معالج رسومي GPU) أخذ وقتاً أطول من المتوقع، أو حدث خطأ غير متوقع. حاول مرة أخرى (لم يُخصَم هذا من حدك اليومي).",
            )
            return
        quota.log_usage(user_id, channel, "IMAGE_GEN", f"[توليد صورة] {prompt}", "(صورة)")
        _send_telegram_photo(chat_id, image_bytes, prompt)
    except Exception:
        logger.exception("background image-gen pipeline failed for chat_id=%s", chat_id)
        quota.refund_quota(user_id, "IMAGE")
        _send_telegram_message(chat_id, "حدث خطأ أثناء توليد الصورة — حاول مرة أخرى (لم يُخصَم هذا من حدك اليومي).")


@app.post("/generate-image", response_model=GenerateImageResponse)
def generate_image(
    req: GenerateImageRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """OUR OWN image-generation model (see council.py's module
    docstring) — self-hosted on our own ModelScope Studio, not a
    third-party API call. No fallback: Groq/Gemini's free tiers have no
    image generation at all, which is exactly why this needed to be a
    model we actually own."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user, "IMAGE")

    background_tasks.add_task(_process_image_gen_and_deliver, user["id"], req.channel, req.chat_id, req.prompt)

    return GenerateImageResponse(accepted=True, quota_message=quota_message)


class GenerateVideoRequest(BaseModel):
    channel: str
    prompt: str
    telegram_id: str | None = None
    email: str | None = None
    # Unlike /generate-image (synchronous — Stable Diffusion inference
    # is fast enough to answer inline), video generation's real latency
    # is unmeasured and could plausibly land in the same class of
    # problem /image and /chat already hit this session (a real answer
    # arriving well past any caller's own timeout). Async-by-default
    # here rather than assuming it will be fast — chat_id is required.
    chat_id: str


class GenerateVideoResponse(BaseModel):
    accepted: bool
    quota_message: str


def _process_video_and_deliver(
    user_id: str, channel: str, chat_id: str, prompt: str, seconds: int, expanded_prompt: str | None = None
) -> None:
    """Runs in a FastAPI BackgroundTask — see _process_image_and_deliver
    above for why this needs its own try/except (no HTTP response left
    to surface an exception on once this starts). expanded_prompt: see
    _process_image_gen_and_deliver's own docstring for why this param
    exists."""
    stop_typing, typing_thread = _start_typing_loop(chat_id, action="upload_video")
    try:
        # See _process_image_gen_and_deliver's own comment above for why
        # this expansion step exists and what it costs in real latency.
        expanded_prompt = expanded_prompt or council.expand_media_prompt(prompt, "video")
        if expanded_prompt != prompt:
            # See _process_image_gen_and_deliver's own comment above —
            # same "PROMPT_EXPANSION" fix, same reason.
            quota.log_usage(
                user_id, channel, "PROMPT_EXPANSION",
                f"حوّل هذا الطلب إلى وصف احترافي مفصّل لتوليد فيديو بالذكاء الاصطناعي: {prompt}",
                expanded_prompt,
            )
        video_bytes = council.generate_video(expanded_prompt, seconds)
        if video_bytes is None:
            # Owner directive, 2026-09-08 (real evidence): video
            # generation on this CPU-only box now builds real AI
            # keyframes + classical animation instead of raw video
            # diffusion (see council.py's generate_video docstring for
            # the measured 157s-on-GPU-vs-hang-on-CPU evidence behind
            # that switch) — genuinely a few minutes, not hours, so a
            # failure here is more likely a mid-deploy restart or one
            # bad keyframe than the old "no GPU" story. A failure here
            # is never the user's fault either way — refund the quota
            # unit this request already reserved.
            quota.refund_quota(user_id, "IMAGE")
            _send_telegram_message(
                chat_id,
                "تعذّر توليد الفيديو هذه المرة — إما أن الخادم لا يزال يُعيد "
                "التشغيل بعد تحديث، أو حدث خطأ غير متوقع أثناء التوليد. حاول "
                "مرة أخرى (لم يُخصَم هذا من حدك اليومي).",
            )
            return
        quota.log_usage(user_id, channel, "VIDEO_GEN", f"[توليد فيديو] {prompt}", "(فيديو)")
        _send_telegram_video(chat_id, video_bytes, prompt)
    except Exception:
        logger.exception("background video pipeline failed for chat_id=%s", chat_id)
        quota.refund_quota(user_id, "IMAGE")
        _send_telegram_message(chat_id, "حدث خطأ أثناء توليد الفيديو — حاول مرة أخرى (لم يُخصَم هذا من حدك اليومي).")
    finally:
        _stop_typing_loop(stop_typing, typing_thread)


# Owner spec, 2026-09-09 ("الافتراضي 6 الى 10 حسب الطلب من المستخدم"):
# a plain-language duration mentioned in the request itself ("فيديو 8
# ثواني قطة تلعب") — no explicit UI field needed, matches how every
# other media request here is already free-text. None if the user
# didn't mention a number, which quota.check_video_duration reads as
# "use the plan default".
_DURATION_RE = re.compile(r"(\d+)\s*(?:ثانية|ثواني|ثوان|sec|second)", re.IGNORECASE)


def _parse_requested_seconds(prompt: str) -> int | None:
    match = _DURATION_RE.search(prompt)
    return int(match.group(1)) if match else None


@app.post("/generate-video", response_model=GenerateVideoResponse)
def generate_video(
    req: GenerateVideoRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """OUR OWN video-generation model (see council.py's generate_video
    docstring for the honest caveat about HF's free tier's real,
    unconfirmed support for this task on a custom repo). Same IMAGE
    quota bucket as /generate-image — video is heavier still, so it
    stays under the same strict cap rather than getting its own."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user, "IMAGE")

    requested_seconds = _parse_requested_seconds(req.prompt)
    duration_ok, seconds, duration_message = quota.check_video_duration(user, requested_seconds)
    if not duration_ok:
        raise HTTPException(status_code=429, detail=duration_message)

    background_tasks.add_task(_process_video_and_deliver, user["id"], req.channel, req.chat_id, req.prompt, seconds)

    return GenerateVideoResponse(accepted=True, quota_message=quota_message)


class FileRequest(BaseModel):
    channel: str
    file_base64: str
    filename: str
    question: str | None = None
    telegram_id: str | None = None
    email: str | None = None
    chat_id: str | None = None  # TELEGRAM only — see ChatRequest.chat_id


class FileResponse(BaseModel):
    accepted: bool
    quota_message: str
    answer: str | None = None


@app.post("/file", response_model=FileResponse)
def file_endpoint(
    req: FileRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """PDF/Word/plain-text support: extract text locally (pypdf /
    python-docx, both pure-Python — no heavy ML dependency, fast), then
    run it through the exact same text pipeline as a typed message —
    deferred for TELEGRAM, inline for WEB/API, same reasoning as
    chat() above."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    file_bytes = base64.b64decode(req.file_base64)
    extracted = files.extract_text(req.filename, file_bytes)
    if not extracted.strip():
        raise HTTPException(status_code=422, detail="تعذّر استخراج نص من هذا الملف.")

    question = req.question or "لخّص هذا الملف بإيجاز واذكر أهم النقاط فيه."
    message = f"محتوى ملف ({req.filename}):\n{extracted}\n\nسؤال المستخدم: {question}"

    if req.channel == "TELEGRAM" and req.chat_id:
        background_tasks.add_task(_process_chat_and_deliver, user, req.channel, message, req.chat_id)
        return FileResponse(accepted=True, quota_message=quota_message)

    final_answer, _query_type, _log_id = _run_text_pipeline(user, req.channel, message)
    return FileResponse(accepted=True, answer=final_answer, quota_message=quota_message)


class WhoamiRequest(BaseModel):
    channel: str
    telegram_id: str | None = None
    email: str | None = None


@app.post("/whoami")
def whoami(
    req: WhoamiRequest,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """Resolves (or creates) the NovaUser and returns just their id — used
    by novaBotLogic.ts's "🎛 لوحتي" command to build the Ttbik dashboard
    link (Ttbik/nova/dashboard?uid=<id>) without duplicating the
    resolve-or-create logic client-side."""
    api_key = _authorize(req.channel, authorization, x_internal_secret)
    try:
        user = quota.resolve_or_create_user(
            req.channel, telegram_id=req.telegram_id, email=req.email, api_key=api_key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"nova_user_id": user["id"]}


@app.get("/plans")
def plans():
    """The single source of truth for plan names/prices/limits — read
    by novaBotLogic.ts to render the /ترقية tier-picker keyboard instead
    of duplicating these numbers in TypeScript. Owner changes a price
    or limit in quota.py's PLANS dict once; every client picks it up
    automatically on its next call, no redeploy of the bot itself
    needed."""
    return {"plans": quota.PLANS}


class SubscribeRequest(BaseModel):
    channel: str
    plan: str
    telegram_id: str | None = None
    email: str | None = None


@app.post("/subscribe")
def subscribe(
    req: SubscribeRequest,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """Creates a PENDING_APPROVAL subscription request for the chosen
    paid tier (PRO_BASIC/PRO_PLUS/PRO_ULTRA — see /plans) AND returns
    the NovaUser id so the caller can build a real payment link
    (Ttbik/pay/nova?uid=<id>&plan=<plan> -> NOWPayments -> nova-webhook
    auto-activates that tier on confirmed payment). The PENDING_APPROVAL
    row is kept as a manual fallback for anyone who can't/won't pay by
    crypto — same standing product rule as every other bot here — but
    paying is now the fast path instead of the only path."""
    api_key = _authorize(req.channel, authorization, x_internal_secret)
    try:
        user = quota.resolve_or_create_user(
            req.channel, telegram_id=req.telegram_id, email=req.email, api_key=api_key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        sub_id = quota.request_subscription(user["id"], req.plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "subscription_id": sub_id,
        "nova_user_id": user["id"],
        "plan": req.plan,
        "amount_usd": quota.PLANS[req.plan]["price_usd"],
        "message": "ادفع الآن لتفعيل فوري، أو انتظر تفعيلاً يدوياً من المالك.",
    }


def _require_internal(x_internal_secret: str | None) -> None:
    """Auth for the admin endpoints below: identical single check every
    other endpoint already does for TELEGRAM/WEB — only Ttbik's own
    server calls these at all, and it only does so after checking the
    caller's Telegram id against SUPER_ADMIN_TELEGRAM_ID itself (see
    novaBotLogic.ts's admin panel) — there is no separate per-owner
    secret to manage here."""
    if not NOVA_INTERNAL_SECRET or x_internal_secret != NOVA_INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="missing/invalid X-Internal-Secret")


@app.post("/admin/stats")
def admin_stats(x_internal_secret: str | None = Header(default=None)):
    _require_internal(x_internal_secret)
    return quota.get_admin_stats()


@app.post("/admin/pending-subscriptions")
def admin_pending_subscriptions(x_internal_secret: str | None = Header(default=None)):
    _require_internal(x_internal_secret)
    return {"items": quota.list_pending_subscriptions()}


class SubscriptionDecisionRequest(BaseModel):
    subscription_id: str


class ApproveSubscriptionRequest(SubscriptionDecisionRequest):
    approved_by: str


@app.post("/admin/approve-subscription")
def admin_approve_subscription(req: ApproveSubscriptionRequest, x_internal_secret: str | None = Header(default=None)):
    _require_internal(x_internal_secret)
    result = quota.approve_subscription(req.subscription_id, req.approved_by)
    if result is None:
        raise HTTPException(status_code=404, detail="subscription not found or already decided")
    return {"ok": True, **result}


@app.post("/admin/reject-subscription")
def admin_reject_subscription(req: SubscriptionDecisionRequest, x_internal_secret: str | None = Header(default=None)):
    _require_internal(x_internal_secret)
    result = quota.reject_subscription(req.subscription_id)
    if result is None:
        raise HTTPException(status_code=404, detail="subscription not found or already decided")
    return {"ok": True, **result}


@app.post("/admin/telegram-user-ids")
def admin_telegram_user_ids(x_internal_secret: str | None = Header(default=None)):
    _require_internal(x_internal_secret)
    return {"ids": quota.list_telegram_user_ids()}


class UsageLogsRequest(BaseModel):
    offset: int = 0
    limit: int = 5


@app.post("/admin/usage-logs")
def admin_usage_logs(req: UsageLogsRequest, x_internal_secret: str | None = Header(default=None)):
    """Owner spec, 2026-09-09: "📜 سجل المحادثات" moved to admin-only,
    with pagination so the admin can page through the WHOLE log
    (novaBotLogic.ts's "التالي" inline button), not just their own last
    5 messages like the old /whoami-scoped path."""
    _require_internal(x_internal_secret)
    return quota.list_usage_logs(offset=req.offset, limit=req.limit)
