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

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import council, files, quota, rag, router
from app.config import NOVA_INTERNAL_SECRET

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


class ChatResponse(BaseModel):
    answer: str
    query_type: str
    quota_message: str


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


def _enforce_quota(user: dict) -> str:
    allowed, _remaining, quota_message = quota.check_and_reserve_quota(user)
    if not allowed:
        raise HTTPException(status_code=429, detail=quota_message)
    return quota_message


def _run_text_pipeline(
    user: dict, channel: str, message: str, background_tasks: BackgroundTasks
) -> tuple[str, str]:
    """The one shared brain path: classify -> build context (memory +
    live search/knowledge bank) -> council answer. Used by /chat
    directly, and by /voice (after transcription) and /file (after
    text extraction) so a transcribed or extracted message gets
    exactly the same treatment as anything typed by hand."""
    query_type = router.classify(message)
    context = rag.build_context(user["id"], message, query_type)
    final_answer = council.answer(message, context)

    background_tasks.add_task(quota.log_usage, user["id"], channel, query_type, message, final_answer)
    background_tasks.add_task(rag.remember, user["id"], message, final_answer)
    return final_answer, query_type


@app.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    final_answer, query_type = _run_text_pipeline(user, req.channel, req.message, background_tasks)

    return ChatResponse(answer=final_answer, query_type=query_type, quota_message=quota_message)


class VoiceRequest(BaseModel):
    channel: str
    audio_base64: str
    filename: str = "voice.ogg"
    telegram_id: str | None = None
    email: str | None = None


class VoiceResponse(BaseModel):
    transcript: str
    answer: str
    query_type: str
    quota_message: str


@app.post("/voice", response_model=VoiceResponse)
def voice(
    req: VoiceRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """Free voice-message support via Groq's own hosted Whisper (same
    API key, no extra cost): transcribe, then run the transcript
    through the exact same pipeline /chat uses."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    audio_bytes = base64.b64decode(req.audio_base64)
    transcript = council.transcribe_voice(audio_bytes, req.filename)
    if not transcript.strip():
        raise HTTPException(status_code=422, detail="تعذّر فهم الرسالة الصوتية — حاول مرة أخرى بوضوح أكبر.")

    final_answer, query_type = _run_text_pipeline(user, req.channel, transcript, background_tasks)

    return VoiceResponse(transcript=transcript, answer=final_answer, query_type=query_type, quota_message=quota_message)


class ImageRequest(BaseModel):
    channel: str
    image_base64: str
    caption: str | None = None
    mime_type: str = "image/jpeg"
    telegram_id: str | None = None
    email: str | None = None


class ImageResponse(BaseModel):
    answer: str
    quota_message: str


@app.post("/image", response_model=ImageResponse)
def image(
    req: ImageRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """OUR OWN model answers image questions first (see council.py's
    module docstring) — once merge_and_finetune.ipynb has trained a
    Qwen2.5-VL-based checkpoint, this is genuinely our own weights, not
    a third-party API. Gemini's free multimodal tier is only the same
    emergency fallback Groq is for text: used before our own
    vision-capable model has been trained/configured, or if it's
    genuinely unreachable."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    image_bytes = base64.b64decode(req.image_base64)
    prompt = req.caption or "صف هذه الصورة بالتفصيل وأجب عن أي سؤال ضمني فيها."
    answer_text = council.call_hf_specialist_vision(image_bytes, prompt, req.mime_type)
    if answer_text:
        logger.info("image answer: served by OUR OWN model")
    else:
        answer_text = council.call_gemini_vision(image_bytes, prompt, req.mime_type)
        logger.info("image answer: our own model unavailable — served by Gemini fallback" if answer_text else "image answer: both our model and Gemini fallback failed")
    if answer_text is None:
        raise HTTPException(
            status_code=503,
            detail="تحليل الصور غير متاح حالياً — تأكد من ضبط HF_SPECIALIST_MODEL_ID أو GEMINI_API_KEY على الخادم.",
        )

    background_tasks.add_task(quota.log_usage, user["id"], req.channel, "IMAGE", f"[صورة] {prompt}", answer_text)
    background_tasks.add_task(rag.remember, user["id"], f"[صورة] {prompt}", answer_text)

    return ImageResponse(answer=answer_text, quota_message=quota_message)


class FileRequest(BaseModel):
    channel: str
    file_base64: str
    filename: str
    question: str | None = None
    telegram_id: str | None = None
    email: str | None = None


class FileResponse(BaseModel):
    answer: str
    quota_message: str


@app.post("/file", response_model=FileResponse)
def file_endpoint(
    req: FileRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """PDF/Word/plain-text support: extract text locally (pypdf /
    python-docx, both pure-Python — no heavy ML dependency), then run
    it through the exact same text pipeline as a typed message."""
    user = _resolve_and_authorize(req.channel, req.telegram_id, req.email, authorization, x_internal_secret)
    quota_message = _enforce_quota(user)

    file_bytes = base64.b64decode(req.file_base64)
    extracted = files.extract_text(req.filename, file_bytes)
    if not extracted.strip():
        raise HTTPException(status_code=422, detail="تعذّر استخراج نص من هذا الملف.")

    question = req.question or "لخّص هذا الملف بإيجاز واذكر أهم النقاط فيه."
    message = f"محتوى ملف ({req.filename}):\n{extracted}\n\nسؤال المستخدم: {question}"

    final_answer, query_type = _run_text_pipeline(user, req.channel, message, background_tasks)

    return FileResponse(answer=final_answer, quota_message=quota_message)


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


class SubscribeRequest(BaseModel):
    channel: str
    telegram_id: str | None = None
    email: str | None = None


@app.post("/subscribe")
def subscribe(
    req: SubscribeRequest,
    authorization: str | None = Header(default=None),
    x_internal_secret: str | None = Header(default=None),
):
    """Creates a PENDING_APPROVAL subscription request AND returns the
    NovaUser id so the caller can build a real payment link
    (Ttbik/pay/nova?uid=<id> -> NOWPayments -> nova-webhook auto-activates
    PRO on confirmed payment). The PENDING_APPROVAL row is kept as a
    manual fallback for anyone who can't/won't pay by crypto — same
    standing product rule as every other bot here — but paying is now the
    fast path instead of the only path."""
    api_key = _authorize(req.channel, authorization, x_internal_secret)
    try:
        user = quota.resolve_or_create_user(
            req.channel, telegram_id=req.telegram_id, email=req.email, api_key=api_key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    sub_id = quota.request_subscription(user["id"])
    return {
        "subscription_id": sub_id,
        "nova_user_id": user["id"],
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
