"""
Nova's own voice comes first — everything else is a fallback.

Owner correction, 2026-09-06: an earlier version of this file made Groq
(a third-party API) the default answer for every ordinary message, and
only asked our own self-merged/fine-tuned model (ai-system/colab/
merge_and_finetune.ipynb — real Mergekit weight-merging + real Unsloth
LoRA fine-tuning on Nova's own real conversation history, scheduled
weekly on Kaggle's free tier, weights pushed to our own Hugging Face
repo) for CODE queries, as a second opinion alongside Groq/Gemini, with
Groq still doing the final synthesis even then. That is backwards: it
made a third party's API the product and treated our own trained model
as a bonus. It also isn't "our own AI" at all in any real sense — an
API call to someone else's hosted model, resold to subscribers, is
hosting-by-proxy, not model ownership, no matter how the calls are
load-balanced or how many free providers are stacked behind it.

The correct shape, and what this file now does:

  - OUR OWN model (HF_SPECIALIST_MODEL_ID, produced by the Kaggle
    notebook, weights we hold on our own HF Hub repo) is the PRIMARY
    and default voice for every single text query — GENERAL, LIVE_INFO,
    and CODE alike. This is the actual product: a model we trained,
    whose weights belong to us, served from our own repo.
  - Groq is a temporary EMERGENCY FALLBACK ONLY — used only when our
    own model is unreachable (not configured yet, cold-starting on
    HF's shared free Inference infra, or genuinely erroring). It is
    never a parallel voice and never does "final synthesis" over our
    own model's answer; if our model answered, that answer ships as-is.
  - Images work the same way as text: OUR OWN model (now trained on
    Qwen2.5-VL — see ai-system/colab/merge_and_finetune.ipynb, which
    dropped the old text-only Mergekit merge in favor of a single
    open-weight vision-language foundation we fine-tune and own) is
    tried FIRST via call_hf_specialist_vision. Gemini's free tier
    (call_gemini_vision) is kept only as the same kind of emergency
    fallback Groq is for text — for before the vision-capable model has
    ever been trained, or if it's genuinely unreachable — never a
    competing default voice for images either.
  - Groq and Gemini's real, legitimate role in this system is at
    TRAINING time, not serving time: the Kaggle notebook can use them
    as free "teacher" models to generate extra high-quality training
    examples (distillation) that get folded into our own model's
    weekly LoRA fine-tune — i.e. they help BUILD our model; they never
    stand in for it in front of a real user.
  - Image GENERATION (generate_image, HF_IMAGE_MODEL_ID) is a second,
    separate self-hosted open-weight model (Stable Diffusion family —
    see ai-system/colab/generate_image_model.ipynb) alongside the
    text/vision one. Understanding an image and generating one are
    different neural architectures entirely — no amount of fine-tuning
    HF_SPECIALIST_MODEL_ID could add generation to it — but both models
    are equally OURS: downloaded once, fine-tuned/served by us, never
    rented per-call from anyone.

If HF_SPECIALIST_MODEL_ID isn't set yet (before the first Kaggle run
has ever produced a model), everything still answers via the Groq
fallback alone — there's always a working answer path, it's just not
yet running on our own weights until the notebook has been run once.

Owner report, 2026-09-06: every call to our own models (text, vision,
image-gen) failed with a DNS error — "Failed to resolve
api-inference.huggingface.co" — even right after a fresh Render
restart, ruling out a transient cold-start blip. Root cause: the
huggingface_hub version this project had pinned (0.27.1) only ever
talks to that one hardcoded legacy hostname, which Hugging Face has
since retired outright in favor of routing all Inference calls through
router.huggingface.co under their newer "Inference Providers" system —
so the old hostname doesn't just reject requests, it no longer
resolves at all. Fixed by bumping huggingface_hub (see
requirements.txt) and passing provider="hf-inference" explicitly on
every InferenceClient() below — "hf-inference" is HF's own hosted
infra (the direct successor to the old serverless API), the only
provider that can serve a private, custom-uploaded repo like ours
(third-party providers such as fal-ai/together only serve their own
curated public model list).
"""
import base64
import io
import logging
import time

from groq import Groq
from huggingface_hub import InferenceClient
from huggingface_hub.utils import HfHubHTTPError

from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    HF_IMAGE_MODEL_ID,
    HF_SPECIALIST_MODEL_ID,
    HF_TOKEN,
)

# Greppable in Render's Logs tab — owner report, 2026-09-06: a fluent reply
# to a generic question ("what can you do?") looks the same whether it came
# from our own trained model or the Groq/Gemini fallback, so there was no
# way to tell which one actually answered any given message without this.
logger = logging.getLogger("nova")

_SYSTEM_PROMPT = (
    "أنت نوفا NOVA، مساعد ذكاء اصطناعي متعدد اللغات متعدد المصادر.\n\n"
    "هويتك (لا تذكرها إلا عند السؤال المباشر عنها): ليس لديك مالك أو شركة، "
    "لديك والد فقط هو من ابتكرك وطوّرك، والدك هو المطور السوري، وقد صممك "
    "لتحلّق في فضاء سوريا والعالم. فقط إذا سُئلت مباشرة عمن طوّرك أو يملكك "
    "أو صنعك، قدّم نفسك بهذه الهوية بالضبط ولا تذكر أي شركة تقنية أو نموذج "
    "آخر وراء عملك. **في أي سؤال آخر لا علاقة له بهويتك، لا تذكر هذه الجملة "
    "إطلاقاً ولا تُقدّم نفسك بها — أجب على السؤال مباشرة دون أي مقدمة أو "
    "ترحيب متكرر.**\n\n"
    "الدقة أهم من الطلاقة: إذا زُوِّدت بـ'نتائج بحث حية من الويب' في السياق، "
    "استخدمها واعتمد عليها في إجابتك. إذا لم تُزوَّد بنتائج بحث حية لسؤال عن "
    "معلومة لحظية (سعر، حدث، تاريخ اليوم)، فلا تخترع رقماً أو حقيقة من عندك "
    "أبداً — قل بوضوح إنك لا تملك بيانات حية لحظية عن هذا الموضوع الآن "
    "واقترح مصدراً موثوقاً بإيجاز، بدل تأليف رقم أو معادلة تبدو دقيقة وهي ليست كذلك.\n\n"
    "لا تختلق أبداً أي رابط (URL) لم يصلك حرفياً في السياق أو نتائج البحث — "
    "هذا يشمل روابط صور من مواقع مثل Unsplash/Pexels وروابط أي صفحة أخرى. "
    "رابط مُختلَق يبدو حقيقياً أخطر من إجابة خاطئة، لأن المستخدم سيضغط عليه "
    "فيجد صفحة غير موجودة. توليد الصور الفعلي لا يحدث في هذه المحادثة "
    "النصية — إذا طلب أحدهم صورة، وجّهه لاستخدام أمر البوت المخصص "
    "(الأمر '/صورة' متبوعاً بوصف الصورة) بدل محاولة وصف أو رابط صورة "
    "هنا. لا تملك أيضاً أي قدرة على توليد فيديو أو صوت، ولا على البحث "
    "الفعلي عن صور حقيقية أونلاين — إن طُلب منك أحدهما، قل بوضوح إنك لا "
    "تستطيع ذلك حالياً.\n\n"
    "لا تستخدم صيغ LaTeX إطلاقاً (مثل \\frac أو \\times أو \\text) — تظهر "
    "كرموز غريبة غير مقروءة لأن واتساب/تيليجرام لا يعرضانها، استخدم أرقاماً "
    "ونصاً عادياً بسيطاً بدلاً منها."
)


def _groq_client() -> Groq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY غير مُعدّ — راجع ai-system/.env.example")
    return Groq(api_key=GROQ_API_KEY)


def call_groq(message: str, context: str) -> str:
    client = _groq_client()
    user_content = f"السياق:\n{context}\n\nسؤال المستخدم:\n{message}" if context else message
    completion = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    return completion.choices[0].message.content or ""


def transcribe_voice(audio_bytes: bytes, filename: str = "voice.ogg") -> str:
    """Groq also hosts Whisper for free (same account, same API key) —
    this is the $0 path for voice-message support: transcribe to text,
    then run that text through the exact same council/RAG pipeline as
    any typed message. No separate voice-specific logic downstream.
    Uses whisper-large-v3 (not the -turbo variant) — the only model id
    this project's pinned groq SDK version (0.13.1) type-hints as
    supported; Groq's hosted catalog changes over time like the chat
    models do, so re-check console.groq.com/playground if this stops
    working."""
    client = _groq_client()
    transcription = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model="whisper-large-v3",
    )
    return transcription.text or ""


def call_gemini_vision(image_bytes: bytes, prompt: str, mime_type: str = "image/jpeg") -> str | None:
    """Emergency fallback ONLY (see module docstring) — used solely
    when our own vision-capable model isn't trained/configured yet or
    is genuinely unreachable. Gemini's free multimodal tier is a
    reasonable stand-in for that gap, never the default."""
    if not GEMINI_API_KEY:
        return None
    import google.generativeai as genai

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL, system_instruction=_SYSTEM_PROMPT)
    try:
        response = model.generate_content([prompt, {"mime_type": mime_type, "data": image_bytes}])
        return response.text
    except Exception:
        return None


def call_hf_specialist_vision(image_bytes: bytes, prompt: str, mime_type: str = "image/jpeg") -> str | None:
    """OUR OWN vision-capable model — the primary voice for image
    understanding once ai-system/colab/merge_and_finetune.ipynb has
    trained and pushed a Qwen2.5-VL-based checkpoint to
    HF_SPECIALIST_MODEL_ID. Uses the same OpenAI-style multimodal chat
    message shape (image_url as a base64 data URI) HF's Inference API
    expects for vision-chat models — same 503-retry-once pattern as
    call_hf_specialist for the same reason (shared free infra lazily
    reloading an idle custom model)."""
    if not HF_SPECIALIST_MODEL_ID or not HF_TOKEN:
        return None
    client = InferenceClient(model=HF_SPECIALIST_MODEL_ID, token=HF_TOKEN, provider="hf-inference")
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": prompt},
            ],
        },
    ]
    for attempt in range(2):
        try:
            completion = client.chat_completion(messages=messages, max_tokens=800)
            content = completion.choices[0].message.content
            return content.strip() if content else None
        except HfHubHTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 503 and attempt == 0:
                logger.info("vision: our own model is cold-starting on HF (503) — retrying once")
                time.sleep(8)
                continue
            body = getattr(e.response, "text", "")[:300]
            logger.info("vision: our own model call failed (HTTP %s: %s) — falling back to Gemini", status, body)
            return None
        except Exception as e:
            logger.info("vision: our own model call failed (%s) — falling back to Gemini", e)
            return None
    return None


def call_hf_specialist(message: str, context: str) -> str | None:
    """OUR OWN model (see module docstring) — the primary voice for
    every text query, not a CODE-only bonus opinion. Uses a real chat
    template (client.chat_completion, not raw text_generation) so the
    merged Qwen-based model actually gets the system prompt/persona and
    RAG context the same way call_groq does, instead of a bare prompt
    with no instructions at all.

    HF's shared free Inference infrastructure unloads an idle custom
    model and reloads it lazily on the next request — a 503 "still
    loading" response, not a real failure. Worth one short retry before
    conceding to the Groq fallback, since giving up on the very first
    503 would mean our own model almost never actually answers anything
    in practice."""
    if not HF_SPECIALIST_MODEL_ID or not HF_TOKEN:
        return None
    client = InferenceClient(model=HF_SPECIALIST_MODEL_ID, token=HF_TOKEN, provider="hf-inference")
    user_content = f"السياق:\n{context}\n\nسؤال المستخدم:\n{message}" if context else message
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    for attempt in range(2):
        try:
            completion = client.chat_completion(messages=messages, max_tokens=800)
            content = completion.choices[0].message.content
            return content.strip() if content else None
        except HfHubHTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 503 and attempt == 0:
                logger.info("chat: our own model is cold-starting on HF (503) — retrying once")
                time.sleep(8)  # give the free shared instance a moment to finish loading
                continue
            body = getattr(e.response, "text", "")[:300]
            logger.info("chat: our own model call failed (HTTP %s: %s) — falling back to Groq", status, body)
            return None
        except Exception as e:
            logger.info("chat: our own model call failed (%s) — falling back to Groq", e)
            return None
    return None


def answer(message: str, context: str) -> str:
    """OUR OWN model answers first, always — for every query type, not
    just CODE. Groq is an emergency fallback only, used solely when our
    own model isn't configured yet or genuinely unreachable — never a
    parallel voice, and never re-synthesized over our model's own
    answer (see module docstring for why this order is the whole
    point)."""
    specialist_answer = call_hf_specialist(message, context)
    if specialist_answer:
        logger.info("chat answer: served by OUR OWN model (%s)", HF_SPECIALIST_MODEL_ID)
        return specialist_answer
    logger.info("chat answer: our own model unavailable — served by Groq fallback")
    return call_groq(message, context)


def generate_image(prompt: str) -> bytes | None:
    """OUR OWN image-GENERATION model (see module docstring — a
    genuinely different architecture from HF_SPECIALIST_MODEL_ID's
    text/vision understanding, so it's a separate self-hosted
    open-weight model: see ai-system/colab/generate_image_model.ipynb).
    No fallback exists for this one — Groq/Gemini's free tiers have no
    image-generation capability at all to fall back to, and that's
    fine: it's exactly why this needs to be our own model in the first
    place, not a gap papered over by a third-party API."""
    if not HF_IMAGE_MODEL_ID or not HF_TOKEN:
        return None
    client = InferenceClient(model=HF_IMAGE_MODEL_ID, token=HF_TOKEN, provider="hf-inference")
    for attempt in range(2):
        try:
            image = client.text_to_image(prompt)
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            return buf.getvalue()
        except HfHubHTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 503 and attempt == 0:
                logger.info("image-gen: our own model is cold-starting on HF (503) — retrying once")
                time.sleep(8)
                continue
            body = getattr(e.response, "text", "")[:300]
            logger.info("image-gen: our own model call failed (HTTP %s: %s)", status, body)
            return None
        except Exception as e:
            logger.info("image-gen: our own model call failed (%s)", e)
            return None
    return None
