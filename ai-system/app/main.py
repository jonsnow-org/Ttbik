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
    longer fits."""
    _maybe_flag_previous_answer(user["id"], message)
    query_type = router.classify(message)
    context = rag.build_context(user["id"], message, query_type)
    final_answer = council.answer(message, context)
    log_id = quota.log_usage(user["id"], channel, query_type, message, final_answer)
    rag.remember(user["id"], message, final_answer)
    rag.remember_shared(message, final_answer, query_type)
    return final_answer, query_type, log_id


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
    try:
        final_answer, _query_type, _log_id = _run_text_pipeline(user, channel, message)
    except Exception:
        logger.exception("background chat pipeline failed for chat_id=%s — sending an error message instead of leaving the user with silence", chat_id)
        final_answer = "حدث خطأ أثناء توليد الإجابة — حاول مرة أخرى."
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


class GenerateImageResponse(BaseModel):
    image_base64: str
    quota_message: str


@app.post("/generate-image", response_model=GenerateImageResponse)
def generate_image(
    req: GenerateImageRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """OUR OWN image-generation model (see council.py's module
    docstring) — a genuinely separate self-hosted open-weight model
    from HF_SPECIALIST_MODEL_ID, not a third-party API call. No
    fallback: Groq/Gemini's free tiers have no image generation at all,
    which is exactly why this needed to be a model we actually own."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user, "IMAGE")

    image_bytes = council.generate_image(req.prompt)
    if image_bytes is None:
        raise HTTPException(
            status_code=503,
            detail="توليد الصور غير متاح حالياً — تأكد من ضبط HF_IMAGE_MODEL_ID على الخادم (راجع ai-system/colab/generate_image_model.ipynb).",
        )

    background_tasks.add_task(quota.log_usage, user["id"], req.channel, "IMAGE_GEN", f"[توليد صورة] {req.prompt}", "(صورة)")

    return GenerateImageResponse(image_base64=base64.b64encode(image_bytes).decode("ascii"), quota_message=quota_message)


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
