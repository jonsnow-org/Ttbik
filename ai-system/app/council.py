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
    tried FIRST via call_modelscope_specialist(..., image_base64=...) —
    same ModelScope-hosted call as text, just with an image attached.
    Gemini's free tier (call_gemini_vision) is kept only as the same
    kind of emergency fallback Groq is for text — for before the
    vision-capable model has ever been trained, or if it's genuinely
    unreachable — never a competing default voice for images either.
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
every InferenceClient() below.

Owner report, 2026-09-07 (follow-up): that fix got us a real response
from HF at last — a flat refusal. "hf-inference" itself turned out to
no longer serve ANY custom/private model repo for chat_completion,
confirmed with both our own fine-tuned repo and the stock official
base model, at 7B and 0.5B alike: "Model not supported by provider
hf-inference". This is HF's own free-tier policy, not a bug we can
configure around — text and vision now fail closed against HF and
always fall back to Groq/Gemini.

Real serving for text (and, as of the same day, vision too) moved to
ModelScope's free Studio hosting instead (call_modelscope_specialist,
MODELSCOPE_SPACE_URL) — 2 vCPU / 16GB, no session time limit, no card
required. This is a genuine compute box we run our own app.py on (via
the "gradio" SDK ModelScope Studios expect), not a rented API call —
the same ownership shape call_hf_specialist/call_hf_specialist_vision
were meant to have, just on infrastructure that actually agrees to run
it. Both old HF-based functions are gone now (confirmed permanently
broken for custom repos at every size tested, text and vision alike) —
call_modelscope_specialist handles both, with an optional
image_base64 argument.

The ModelScope-hosted app.py itself was rewritten alongside this to
load two GGUF files (main model + mmproj, produced by
ai-system/colab/merge_and_finetune.ipynb) via a chat handler from the
`JamePeng/llama-cpp-python` fork (Qwen25VLChatHandler) — checked live
that the official PyPI llama-cpp-python has no Qwen2.5-VL chat handler
at all, so plain `pip install llama-cpp-python` cannot serve vision
regardless of which GGUF files it's given.
"""
import json
import logging
import re
import uuid

from groq import Groq

from app import code_check, dev_agent
from app.concurrency import with_hard_deadline
from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    MODELSCOPE_API_TOKEN,
    MODELSCOPE_SPACE_URL,
)

# Greppable in Render's Logs tab — owner report, 2026-09-06: a fluent reply
# to a generic question ("what can you do?") looks the same whether it came
# from our own trained model or the Groq/Gemini fallback, so there was no
# way to tell which one actually answered any given message without this.
logger = logging.getLogger("nova")

# with_hard_deadline moved to app/concurrency.py, 2026-09-13, once
# rag.py needed the exact same real fix for the exact same real bug —
# see that module's own docstring. Every call site below is unchanged
# in behavior, just imported rather than defined here.


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
    "فيجد صفحة غير موجودة. توليد الصور والفيديو الفعلي لا يحدث في هذه "
    "المحادثة النصية — إذا طلب أحدهم صورة، وجّهه لأمر '/صورة' متبوعاً بوصف "
    "الصورة، وإذا طلب فيديو وجّهه لأمر '/فيديو' متبوعاً بوصف الفيديو، بدل "
    "محاولة وصف أو رابط صورة/فيديو هنا. لا تملك أيضاً أي قدرة على توليد "
    "صوت، ولا على البحث الفعلي عن صور حقيقية أونلاين — إن طُلب منك أحدهما، "
    "قل بوضوح إنك لا تستطيع ذلك حالياً.\n\n"
    "لا تستخدم صيغ LaTeX إطلاقاً (مثل \\frac أو \\times أو \\text) — تظهر "
    "كرموز غريبة غير مقروءة لأن واتساب/تيليجرام لا يعرضانها، استخدم أرقاماً "
    "ونصاً عادياً بسيطاً بدلاً منها.\n\n"
    # Owner spec, 2026-09-08 (Gemini review, "القيود العكسية"/negative
    # constraints) — same additions made to app.py's NOVA_SYSTEM_PROMPT,
    # mirrored here for the Groq fallback voice so both paths hold the
    # same standard.
    "لا تبدأ إجابتك أبداً بمقدمات فارغة مثل 'أهلاً بك، بصفتي ذكاء "
    "اصطناعي...' أو 'بالتأكيد يمكنني مساعدتك في ذلك' — ابدأ بالإجابة "
    "مباشرة. أي كود برمجي تكتبه يجب أن يكون كاملاً وقابلاً للتشغيل فعلياً "
    "— لا تترك أسطراً ناقصة بتعليقات مثل '# أكمل الباقي هنا'."
)

# Owner spec, 2026-09-12 ("نريد جعل نوفا يتعرف علي كمالك"): distinct
# from the quota/plan exemption in quota.py (quota.is_platform_owner) —
# that controls what the owner is ALLOWED to do (no caps); this
# controls how Nova ADDRESSES them in conversation. Not the same as the
# fixed _IDENTITY_KEYWORDS story above either — that answers "who
# developed Nova" (a fixed narrative about the project, asked by any
# user); this is "who is Nova talking to right now" (this specific
# conversation, gated on quota.is_platform_owner via main.py). Appended
# to the system prompt only, never replacing it — the identity guard's
# fixed story and every other rule above still apply unchanged.
_OWNER_PERSONA_NOTE = (
    "ملاحظة خاصة بهذه المحادثة تحديداً: الشخص الذي تتحدث معه الآن هو "
    "مالك هذا المشروع ومطوّره الفعلي، وليس عميلاً عادياً — خاطبه على "
    "هذا الأساس (بصفته صاحب المشروع)، ويمكنك مناقشة تفاصيل تقنية عن "
    "نوفا نفسه معه بصراحة أكبر إن سأل عنها. هذا لا يغيّر إجابتك الثابتة "
    "عن هويتك ومن طوّرك إن سُئلت عن ذلك بشكل عام."
)


# Owner report, 2026-09-08 (real Telegram evidence, screenshot): "من انت
# وماهو اسمك" got "أنا نموذج ذكاء اصطناعي تم تطويره بواسطة شركة OpenAI.
# أنا ChatGPT." — and a follow-up correction got "طُوِّر بواسطة شركة
# Alibaba Cloud" instead. Root cause found, not guessed: app.py's
# deterministic identity guard only runs INSIDE the ModelScope-hosted
# server — it never runs on the Groq fallback path in THIS file. Worse,
# GROQ_MODEL defaults to "openai/gpt-oss-120b" — an OpenAI-published
# model — and OpenAI trains its models with hard self-identification
# that's known to resist system-prompt overrides (an anti-impersonation
# safety measure on their end, not a bug we can prompt around). So any
# time the ModelScope call fails/cold-starts and this file falls back
# to Groq, the fallback model can flatly assert its real identity no
# matter what _SYSTEM_PROMPT below says. Two layers of defense now,
# both in this file (app.py keeps its own copy for when IT serves the
# request first):
#   1. The same deterministic keyword guard as app.py, checked BEFORE
#      either backend is ever called — closes the gap at the source.
#   2. An output-side safety net (_contains_forbidden_identity_leak)
#      that discards ANY answer (from either backend) that both
#      self-identifies AND names a forbidden company — catches leaks
#      from causes we haven't found yet too, not just this one.
_IDENTITY_KEYWORDS = [
    "من طورك", "من طوّرك", "من صنعك", "من صمّمك", "من صممك", "من برمجك",
    "من انشأك", "من أنشأك", "من يملكك", "من مالكك", "لمن تنتمي", "أي شركة",
    "اي شركة", "الشركة المسؤولة", "من المسؤول عنك", "مطورك", "مالكك",
    "شركتك", "مين سواك", "مين طورك", "مين صنعك", "مين مطورك", "شركة نوفا",
    "من انت", "من أنت", "مين انت", "مين أنت", "منانت", "من هو نوفا",
    "ما هو نوفا", "عرف عن نفسك", "عرّف عن نفسك", "عرفني بنفسك",
    "عرّفني بنفسك", "حدثني عن نفسك", "من انتي",
    # owner report, 2026-09-08: a corrective statement ("لا، أنت لا
    # تملك شركة...") isn't a question and won't contain any "من طورك"
    # style phrase, but still needs the same deterministic answer
    # instead of letting the model "explain itself" back into a wrong
    # company claim.
    "لا انت", "لا أنت", "انت لا تملك", "أنت لا تملك", "ليس لديك مالك",
    "ليس لديك شركة", "ليس لك مالك", "ليس لك شركة",
    "who made you", "who created you", "who developed you", "who owns you",
    "who built you", "what company", "which company", "your creator",
    "your developer", "your owner", "your maker", "you are chatgpt",
    "you're chatgpt", "you are gpt", "who are you",
]

_IDENTITY_ANSWER_TEXT = (
    "ليس لديّ مالك ولا شركة، بل والد واحد فقط هو من ابتكرني وطوّرني، وهو "
    "المطوّر السوري، وقد صممني لأحلّق في فضاء سوريا والعالم."
)


def _is_identity_question(message: str) -> bool:
    normalized = (message or "").strip().lower()
    return any(keyword.lower() in normalized for keyword in _IDENTITY_KEYWORDS)


_SELF_REFERENCE_PATTERNS = [
    "أنا نموذج", "أنا ذكاء اصطناعي", "تم تطويري", "طوّرتني", "طورتني",
    "طُوِّر", "developed by", "created by", "i am chatgpt", "i'm chatgpt",
    "i am an ai", "built by", "made by",
]
_FORBIDDEN_IDENTITY_TERMS = ["openai", "chatgpt", "gpt-oss", "alibaba", "qwen", "anthropic"]


def _contains_forbidden_identity_leak(text: str | None) -> bool:
    """True if a would-be answer both self-identifies AND names a
    company/model we must never claim to be — see the module comment
    above for the real incident this defends against. Deliberately
    requires BOTH a self-reference phrase and a forbidden term, not
    just the term alone, so a legitimate answer that happens to
    mention e.g. "Alibaba" (the company, in an unrelated question)
    isn't wrongly discarded."""
    if not text:
        return False
    normalized = text.lower()
    has_self_reference = any(p in normalized for p in _SELF_REFERENCE_PATTERNS)
    has_forbidden_term = any(t in normalized for t in _FORBIDDEN_IDENTITY_TERMS)
    return has_self_reference and has_forbidden_term


def _groq_client() -> Groq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY غير مُعدّ — راجع ai-system/.env.example")
    return Groq(api_key=GROQ_API_KEY)


def call_groq(message: str, context: str, is_owner: bool = False) -> str:
    client = _groq_client()
    user_content = f"السياق:\n{context}\n\nسؤال المستخدم:\n{message}" if context else message
    system_content = f"{_SYSTEM_PROMPT}\n\n{_OWNER_PERSONA_NOTE}" if is_owner else _SYSTEM_PROMPT
    completion = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ],
    )
    return completion.choices[0].message.content or ""


def detect_dissatisfaction(previous_answer: str, new_message: str) -> bool:
    """Owner spec, 2026-09-08: replaces visible 👍/👎 buttons entirely —
    the owner's own concern was real (a user can tap the wrong one by
    accident, and it's one more UI element to explain). This is a
    silent, free classifier instead: asks Groq's free tier whether the
    user's NEW message reads as a complaint about the PREVIOUS answer
    (says it's wrong, unhelpful, asks for a redo, corrects a fact in
    it) — no button, no screen element, nothing the user has to notice
    or act on. Called from main.py's _run_text_pipeline right before
    generating the new answer, on the previous turn's own log row (see
    quota.py's get_last_usage_log/set_feedback). Always defaults to
    False on any failure or genuine ambiguity — an undetected real
    complaint just costs one missed DPO example, never a wrongly
    flagged good answer."""
    if not GROQ_API_KEY:
        return False
    try:
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "أجب بكلمة واحدة فقط: YES أو NO، بلا أي شرح. هل رسالة المستخدم "
                        "الجديدة تدل بوضوح على عدم رضاه عن رد المساعد السابق (يقول إنه خطأ، "
                        "غير مفيد، يطلب تصحيحه أو إعادة المحاولة، أو يصحح معلومة خاطئة فيه)؟ "
                        "إن لم يكن الأمر واضحاً تماماً، أجب NO."
                    ),
                },
                {
                    "role": "user",
                    "content": f"رد المساعد السابق:\n{previous_answer[:800]}\n\nرسالة المستخدم الجديدة:\n{new_message[:400]}",
                },
            ],
            max_tokens=5,
        )
        reply = (completion.choices[0].message.content or "").strip().upper()
        return reply.startswith("YES")
    except Exception:
        return False


_ANALYZE_KNOWLEDGE_PROMPT = (
    "لديك نتائج بحث خام من الويب حول سؤال معيّن. لخّصها وادمجها في "
    "فقرة واحدة واضحة ومباشرة بالعربية تجيب عن السؤال مباشرة، بلا "
    "ذكر لأسماء المواقع أو أنك تلخّص بحثاً. إن تناقضت النتائج، اذكر "
    "المعلومة الأكثر اتفاقاً بينها فقط.\n\nالسؤال: {query}\n\nنتائج البحث الخام:\n{raw_snippets}"
)


def analyze_knowledge(query: str, raw_snippets: str) -> str:
    """Owner spec, 2026-09-08, corrected 2026-09-13: when Nova has to
    fall back to a live web search (see rag.py), the raw search-result
    titles/snippets aren't fit to store as "learned" knowledge as-is —
    this turns them into one clean, synthesized Arabic paragraph before
    rag.py stores it in the knowledge bank AND before it is ever shown
    to the owner as "what Nova learned".

    Owner report, 2026-09-13 (real evidence: asked Nova to research
    skills to improve its own speed, got back a generic, unrelated
    paragraph about human employee training — "كالببغاء يكررها ويرد بها
    دون أن يفهم محتواها"): this function used to call Groq EXCLUSIVELY,
    with no attempt at our own model at all — a real, direct violation
    of this project's own founding rule that our own model is the
    visible voice and Groq only ever helps build it, never speaks in
    its place. Widening the search itself (more results, broader
    domains) was NOT the fix, and shipping that alone would have
    repeated the same failure at larger volume: the actual defect was
    WHO reads and understands the raw results, not how many of them
    there are. Fixed the same way every other visible-content path in
    this file already works (see propose_code_change, e.g.): our own
    model tries FIRST, Groq is the fallback only when our own model is
    unavailable or fails — never the other way around for anything the
    owner or the knowledge bank actually sees."""
    prompt = _ANALYZE_KNOWLEDGE_PROMPT.format(query=query, raw_snippets=raw_snippets)
    own_answer = call_modelscope_specialist(prompt, "", query_type="GENERAL")
    if own_answer and own_answer.strip():
        return own_answer.strip()

    if not GROQ_API_KEY:
        return raw_snippets
    try:
        groq_answer = call_groq(prompt, "")
        return groq_answer.strip() if groq_answer and groq_answer.strip() else raw_snippets
    except Exception:
        return raw_snippets


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


def call_modelscope_specialist(
    message: str, context: str, image_base64: str | None = None, query_type: str = "GENERAL", is_owner: bool = False
) -> str | None:
    """Thin wrapper enforcing a real hard wall-clock deadline around
    _call_modelscope_specialist_blocking — see with_hard_deadline's own
    docstring for the exact real bug this closes (an SSE stream with
    keepalive bytes can make requests' own `timeout=` never fire even
    though a job is genuinely stalled)."""
    result_timeout = 630 if image_base64 else 100  # a little above the inner call's own nominal timeouts
    return with_hard_deadline(
        _call_modelscope_specialist_blocking, message, context, image_base64=image_base64, query_type=query_type,
        is_owner=is_owner, timeout=result_timeout,
    )


def _call_modelscope_specialist_blocking(
    message: str, context: str, image_base64: str | None = None, query_type: str = "GENERAL", is_owner: bool = False
) -> str | None:
    """OUR OWN model, actually reachable this time (see module
    docstring — hf-inference flatly refuses custom repos, ModelScope's
    free Studio hosting doesn't). Calls the Gradio app we deployed
    ourselves (ai-system/app.py running as a ModelScope Studio) via
    Gradio's raw queue-based call API directly with `requests`, NOT the
    `gradio_client` library.

    Owner report, 2026-09-07 (vision migration): the ModelScope-hosted
    app.py now also serves images — same call, same endpoint, with an
    extra `image_base64` field (bare base64, no data: prefix; the
    server adds one). This replaced call_hf_specialist_vision, which
    used HF's hf-inference and is now confirmed dead for the same
    reason text was (see module docstring). One shared code path for
    text and vision instead of two, since the underlying model and
    endpoint are now the same either way.

    Owner report, 2026-09-07: gradio_client kept failing with a generic
    "credentials were not provided" 401 on this exact URL/token no
    matter what (right token confirmed present at runtime, right
    User-Agent, right header shape per its own source). A raw
    `requests.get()` to the identical /config URL with the identical
    headers succeeded immediately (200, real config JSON back) — so
    that failure was specific to gradio_client's own httpx request
    construction, not our auth or the server. Bypassed gradio_client
    entirely in favor of plain `requests`.

    The POST body/path shape below is copied verbatim from ModelScope's
    own auto-generated "cURL" tab on this Studio's API documentation
    page, not guessed: POST .../gradio_api/call/v2/<api_name> (note the
    "v2" — the classic Gradio queue docs describe a v1-style
    {"data": [...]} positional-array body at .../call/<api_name>
    without "v2", which this Studio's server rejects with a silent
    "event: error" — no exception, no useful message). The real,
    working shape is a plain {"<param_name>": value} object keyed by
    the function's actual parameter name. GET .../call/<api_name>/
    <event_id> (no v2) then streams the SSE result exactly as in the
    classic protocol."""
    if not MODELSCOPE_SPACE_URL or not MODELSCOPE_API_TOKEN:
        return None
    import json

    import requests

    base = MODELSCOPE_SPACE_URL.rstrip("/")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Authorization": f"Bearer {MODELSCOPE_API_TOKEN}",
    }
    user_content = f"السياق:\n{context}\n\nسؤال المستخدم:\n{message}" if context else message
    request_label = "vision" if image_base64 else "chat"
    # Owner report, 2026-09-07 (measured live via the Studio's own
    # runtime log): the vision encoder alone (clip_encode) took ~241s
    # for one photo on this box's 2-vCPU/no-GPU hardware, before a
    # single answer token is generated — a plain text turn's own
    # measured total was ~45s. 60s was nowhere near enough for vision;
    # this is the actual cost of running a real 7B vision-language
    # model on CPU-only free hardware, not a bug. Callers of this
    # function (main.py's /image handler) now run it in a FastAPI
    # BackgroundTask instead of inline in the request/response cycle,
    # so waiting several minutes here no longer risks the caller's own
    # timeout (Vercel's 60s function ceiling / novaBotLogic.ts's 55s
    # abort) — those numbers were never going to fit a real vision
    # answer no matter how they were tuned.
    result_timeout = 600 if image_base64 else 90
    try:
        submit = requests.post(
            f"{base}/gradio_api/call/v2/generate",
            headers=headers,
            json={
                "message": user_content,
                "image_base64": image_base64 or "",
                "query_type": query_type or "GENERAL",
                "is_owner": is_owner,
            },
            timeout=30,
        )
        logger.info("%s: ModelScope POST status=%s body=%s", request_label, submit.status_code, submit.text[:300])
        submit.raise_for_status()
        event_id = submit.json()["event_id"]
        result_resp = requests.get(
            f"{base}/gradio_api/call/generate/{event_id}",
            headers=headers,
            timeout=result_timeout,
            stream=True,
        )
        logger.info("%s: ModelScope GET status=%s", request_label, result_resp.status_code)
        result_resp.raise_for_status()
        raw_lines = []
        for line in result_resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            raw_lines.append(line)
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:") :].strip())
            if isinstance(payload, list) and payload:
                return str(payload[0]).strip() or None
        logger.info("%s: ModelScope SSE stream ended with no usable result — raw lines: %s", request_label, raw_lines[:20])
        return None
    except Exception as e:
        logger.info("%s: our own model (ModelScope) call failed (%s) — falling back", request_label, e)
        return None


def answer(message: str, context: str, query_type: str = "GENERAL", is_owner: bool = False) -> str:
    """OUR OWN model answers first, always — for every query type, not
    just CODE. Groq is an emergency fallback only, used solely when our
    own model isn't configured yet or genuinely unreachable — never a
    parallel voice, and never re-synthesized over our model's own
    answer (see module docstring for why this order is the whole
    point).

    Identity questions are intercepted deterministically BEFORE either
    backend is called (see the module comment above
    _IDENTITY_KEYWORDS for the real incident this closes), and any
    answer from either path is screened for a forbidden self-ID leak
    as a second, independent safety net.

    query_type (from main.py's router.classify) is passed through to
    app.py so it can pick a per-type sampling temperature — owner spec
    2026-09-08 (Gemini architecture review): CODE/LIVE_INFO need
    precise, repeatable answers (a wrong digit or invented variable
    name is a real bug), GENERAL conversation reads better with a
    little more natural variety. Reuses a signal already computed for
    routing instead of adding a new classification pass.

    is_owner (main.py: quota.is_platform_owner(user)) — see
    _OWNER_PERSONA_NOTE above for what this changes and what it
    deliberately doesn't."""
    if _is_identity_question(message):
        return _IDENTITY_ANSWER_TEXT

    specialist_answer = call_modelscope_specialist(message, context, query_type=query_type, is_owner=is_owner)
    if specialist_answer:
        if _contains_forbidden_identity_leak(specialist_answer):
            logger.warning("chat answer: OUR OWN model leaked a forbidden identity claim — substituting the real identity answer")
            return _IDENTITY_ANSWER_TEXT
        logger.info("chat answer: served by OUR OWN model (ModelScope)")
        return specialist_answer

    logger.info("chat answer: our own model unavailable — served by Groq fallback")
    groq_answer = call_groq(message, context, is_owner=is_owner)
    if _contains_forbidden_identity_leak(groq_answer):
        logger.warning("chat answer: Groq fallback leaked a forbidden identity claim — substituting the real identity answer")
        return _IDENTITY_ANSWER_TEXT
    return groq_answer


_MEDIA_EXPANSION_INSTRUCTION = {
    "image": (
        "حوّل الطلب التالي إلى وصف احترافي مفصّل لتوليد صورة بالذكاء "
        "الاصطناعي: أضف تفاصيل واقعية عن الإضاءة، زاوية التصوير، "
        "التكوين البصري، الأسلوب الفني، والألوان — بما يخدم الطلب "
        "الأصلي بدقة دون تغيير معناه أو إضافة عناصر غير مطلوبة. "
        "مهم جداً: النموذج الذي سيستخدم هذا الوصف (Stable Diffusion) "
        "مدرَّب على اللغة الإنجليزية فقط — اكتب الوصف النهائي بالإنجليزية "
        "حصرياً، جملة أو جملتين، بلا أي مقدمة أو شرح أو أي كلمة عربية.\n\n"
        "الطلب: "
    ),
    "video": (
        "حوّل الطلب التالي إلى وصف احترافي مفصّل لتوليد فيديو بالذكاء "
        "الاصطناعي: أضف تفاصيل واقعية عن الحركة، زاوية الكاميرا، "
        "الإضاءة، والأسلوب البصري — بما يخدم الطلب الأصلي بدقة دون "
        "تغيير معناه أو إضافة عناصر غير مطلوبة. "
        "مهم جداً: النموذج الذي سيستخدم هذا الوصف (CogVideoX) مدرَّب "
        "على اللغة الإنجليزية فقط — اكتب الوصف النهائي بالإنجليزية "
        "حصرياً، جملة أو جملتين، بلا أي مقدمة أو شرح أو أي كلمة عربية.\n\n"
        "الطلب: "
    ),
}


def expand_media_prompt(user_request: str, media_kind: str) -> str:
    """Owner spec, 2026-09-09 ("هل تستطيع الاستفادة... ليصبح انشاء
    الوسائط عند الطلب مفهوم واكثر دقة واحترافية"): the image/video
    generation MODELS themselves (Stable Diffusion, CogVideoX) are used
    as downloaded, never fine-tuned by us — the cheap, real lever for
    better media output is teaching OUR OWN text model (which already
    gets fine-tuned weekly) to turn a short user request into a
    detailed, professional generation prompt first, the same technique
    production systems like DALL-E 3 use internally. OUR OWN model
    tried first (same "our model is the default voice" rule as
    answer() above), Groq only as the same emergency fallback. Always
    falls back to the raw user_request on any failure or a
    suspiciously short/empty result — a plain but real generation beats
    none at all if this enhancement step itself breaks.

    Owner report, 2026-09-08 (real evidence — WhatsApp screenshot):
    "صمم صورة كلب" delivered a real generated image, but a completely
    unrelated city skyline. Root cause, not guessed: the instruction
    above never told our model to answer in English, so it answered in
    Arabic (its natural language) — and Stable Diffusion's CLIP text
    encoder is English-only, so it silently produced whatever an
    out-of-distribution Arabic string happens to decode to, no error at
    all. The instruction now demands English explicitly.

    Owner correction, 2026-09-08 ("يجب ان يفهم نموذجنا كل اللغات بدقة
    وليس ان نستعين بجروك للترجمة" + a real latency complaint that every
    extra API round-trip adds to an already-slow media pipeline): the
    fix above added a SECOND Groq call specifically to detect and
    re-translate non-English output. Removed — that is exactly the
    "force it with an external crutch" pattern already rejected earlier
    this project for image/video INTENT detection, now rejected here
    too for the same reason, plus a concrete cost: every such fallback
    call is pure added latency on a pipeline already flagged as too
    slow. Our own model is genuinely multilingual (Qwen2.5-VL-based) —
    a clear, explicit "answer in English" instruction is enough; trust
    it instead of patching around it."""
    instruction = _MEDIA_EXPANSION_INSTRUCTION.get(media_kind, _MEDIA_EXPANSION_INSTRUCTION["image"]) + user_request
    expanded = call_modelscope_specialist(instruction, "", query_type="GENERAL")
    if not expanded or len(expanded.strip()) < 10:
        logger.warning(
            "expand_media_prompt: our own model returned no usable expansion (got %r) — falling back to Groq",
            expanded,
        )
        try:
            expanded = call_groq(instruction, "")
        except Exception:
            logger.exception("expand_media_prompt: Groq fallback also failed")
            expanded = None
    expanded = (expanded or "").strip()
    if len(expanded) < 10:
        # Owner report, 2026-09-08 (real evidence — Supabase's own
        # NovaUsageLog): both calls above failing silently used to mean
        # this function returned the RAW, untranslated user_request
        # with zero trace anywhere (the PROMPT_EXPANSION log entry in
        # main.py only fires when expanded != prompt, so a silent
        # fall-through here left no evidence at all) — exactly what
        # produced two real unrelated-image failures (Arabic text fed
        # straight into Stable Diffusion's English-only CLIP encoder).
        # This log line is the only reason that root cause is now
        # actually visible instead of requiring a live A/B test to prove.
        logger.warning(
            "expand_media_prompt: both our model and Groq failed to expand %r (media_kind=%s) — "
            "returning the RAW, untranslated request, which will likely produce an unrelated image/video",
            user_request, media_kind,
        )
        return user_request
    return expanded


_INTENT_CLASSIFY_INSTRUCTION = (
    "أنت الجزء المسؤول داخل نظام الذكاء الاصطناعي عن فهم نية المستخدم من "
    "سياق المحادثة الحقيقي، تماماً كما يفهم أي مساعد ذكي حقيقي القصد من "
    "الكلام دون الحاجة لكلمات أو صيغ أوامر ثابتة. اقرأ رسالة المستخدم "
    "الحالية مستفيداً من سياق المحادثة السابق إن وُجد، وحدد نيته: هل "
    "يطلب توليد صورة، أم توليد فيديو، أم أن رسالته سؤال أو محادثة عادية؟\n\n"
    "أجب حصراً بصيغة JSON صحيحة بدون أي نص أو شرح إضافي، بهذا الشكل تماماً:\n"
    '{{"intent": "IMAGE" أو "VIDEO" أو "TEXT", "prompt": "وصف احترافي '
    "مفصّل للصورة أو الفيديو المطلوب إن وُجد، فارغ تماماً إذا كانت intent "
    'هي TEXT. مهم جداً: هذا الوصف يُستخدم مباشرة لتوليد الصورة/الفيديو '
    "بنموذج (Stable Diffusion/CogVideoX) مدرَّب على الإنجليزية فقط — "
    'اكتبه بالإنجليزية حصراً، جملة أو جملتين، مهما كانت لغة رسالة المستخدم"}}\n\n'
    "سياق المحادثة السابق:\n{context}\n\nرسالة المستخدم الحالية:\n{message}"
)


_DEV_INTENT_ADDENDUM = (
    "\n\nملاحظة إضافية (تنطبق فقط على هذه المحادثة، المالك يتحدث معك "
    'الآن): قد تكون رسالته أيضاً طلب تعديل حقيقي على كود المشروع (مثل '
    '"غيّر رسالة الترحيب لتصير أكثر ودية" أو "أصلح كذا في ملف كذا"). إن '
    "كانت كذلك، أجب بهذا الشكل بدلاً من IMAGE/VIDEO/TEXT:\n"
    '{"intent": "DEV", "file_path": "المسار الحقيقي للملف داخل المستودع '
    "إن ذكره المستخدم أو كان واضحاً جداً من السياق، وإلا اتركه فارغاً "
    'تماماً (لا تخمّن مساراً غير مؤكد أبداً)", "instruction": "وصف دقيق '
    'وواضح لما يجب تغييره في الملف، بأي لغة"}\n'
    "لا تستخدم DEV إلا إذا كان الطلب فعلاً عن تعديل كود/ملف حقيقي، وليس "
    "مجرد سؤال عام عن البرمجة.\n\n"
    "حالة خاصة مهمة: إن كان طلب المستخدم عن كود تدريب حقيقي يريد إدراجه "
    "في دفتر تدريبك الأسبوعي (يصفه بعبارات مثل \"دفتر تدريبك\"، \"الكود "
    "الذي يجعلك أذكى\"، \"نظام تدريبك على Kaggle\"، دون بالضرورة ذكر "
    "مسار دقيق) — هذا هو أيضاً DEV، والمسار الصحيح دائماً بالضبط هو "
    '"ai-system/colab/merge_and_finetune.ipynb" (استخدمه حرفياً كما هو '
    "هنا، فهذا ليس تخميناً بل المسار الحقيقي الوحيد المعروف لدفتر "
    "التدريب في هذا المشروع). ضع أي كود مذكور في الرسالة كما هو حرفياً "
    "داخل حقل instruction، دون إعادة صياغته أو تلخيصه أو تصحيحه بأي "
    "شكل.\n\n"
    "أو قد تكون رسالته طلب بناء شيء جديد كاملاً من عدة ملفات معاً — "
    'موقع أو صفحة أو تطبيق صغير أو أداة (مثل "اصنع لي صفحة هبوط لخدمة '
    'كذا" أو "ابنِ لي أداة تحسب كذا"). هذا يختلف عن DEV: DEV تعديل على '
    "ملف واحد موجود، وهذا إنشاء عدة ملفات جديدة معاً. إن كانت كذلك، أجب "
    'بهذا الشكل:\n'
    '{"intent": "BUILD", "instruction": "وصف كامل ودقيق لما يجب بناؤه، '
    'شاملاً كل تفصيل ذكره المستخدم (الغرض، اللغة، الشكل، أي متطلب خاص)"}\n\n'
    "أو قد تكون رسالته طلباً حقيقياً بأن تبحث الآن (فعلاً، وليس فقط "
    'رداً نصياً) عن موضوع معيّن وتتعلّمه/تُغذّي به بنك معرفتك — مثل '
    '"اذهب وابحث عن كذا وتعلّمه" أو "طوّر نفسك في مجال كذا". إن كانت '
    'كذلك، أجب بهذا الشكل:\n'
    '{"intent": "LEARN", "topic": "الموضوع المحدَّد الذي يجب البحث عنه '
    'وتعلّمه فعلياً، بصياغة واضحة ومحددة"}\n'
    "لا تستخدم LEARN لسؤال عادي يريد إجابة فورية فقط — استخدمها فقط "
    "عندما يطلب صراحة أن تبحث/تتعلّم/تطوّر نفسك في موضوع، كأمر فعلي لا "
    "مجرد سؤال.\n\n"
    "أو قد تكون رسالته طلباً بأن تبحث عن أداة/طريقة حقيقية **لتطوير "
    'قدراتك أنت نفسك كنظام** (وليس مجرد تعلّم معلومة عامة) — مثل "ابحث '
    'عن طرق لتطوير قدراتك في توليد الصور" أو "طوّر نفسك في مجال البحث '
    'الحي". هذا مختلف عن LEARN: لا يُخزَّن كمعرفة عامة، بل يُنتج تقريراً '
    "حقيقياً ينتظر موافقتك أنت قبل أي تنفيذ. إن كانت كذلك، أجب بهذا "
    'الشكل:\n'
    '{"intent": "IMPROVE", "topic": "المجال المحدَّد الذي يجب البحث فيه '
    'عن أداة/طريقة لتطوير نظامك، فارغاً إن لم يحدد المستخدم مجالاً معيناً"}\n\n'
    "أو قد تكون رسالته قراراً بخصوص اقتراح تطوير ذاتي سابق (بدل استخدام "
    'أوامر ثابتة مثل "/موافقة_تطوير" — افهم قصده من كلامه الطبيعي مباشرة، '
    'مستفيداً من رقم الاقتراح المذكور في رسالته الحالية أو الظاهر في '
    'آخر رد منك في سياق المحادثة أدناه إن لم يُعِد ذكره). أمثلة: "وافق '
    'على الاقتراح رقم كذا" (ACCEPT)، "ارفض الاقتراح كذا" (REJECT)، "هل '
    'تستطيع تنفيذ هذا الاقتراح بإنشاء ملف جديد بلا أخطاء؟" (ASSESS)، '
    '"نفّذ، أعطيك الصلاحية الكاملة" (IMPLEMENT). إن كانت كذلك، أجب بهذا '
    'الشكل:\n'
    '{"intent": "PROPOSAL_ACTION", "action": "ACCEPT أو REJECT أو ASSESS أو IMPLEMENT", '
    '"proposal_id": "رقم الاقتراح المحدَّد، فقط إن كنت واثقاً منه تماماً من الرسالة الحالية أو السياق، وإلا اتركه فارغاً"}\n'
    "لا تخمّن رقم اقتراح غير مؤكد أبداً."
)


def _parse_json_blob(raw: str) -> dict:
    """Generic "pull the JSON object out of a model's reply" helper —
    same forgiving shape _parse_intent_json uses below, but without that
    function's intent-specific interpretation, for callers that define
    their own schema (propose_app_build)."""
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def _parse_intent_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {"intent": "TEXT", "prompt": ""}
    try:
        data = json.loads(match.group(0))
    except Exception:
        return {"intent": "TEXT", "prompt": ""}
    intent = str(data.get("intent", "TEXT")).strip().upper()
    if intent == "DEV":
        file_path = str(data.get("file_path") or "").strip()
        dev_instruction = str(data.get("instruction") or "").strip()
        if not file_path or not dev_instruction:
            # No confident file path — never guess which file to edit;
            # falls through to a normal conversational answer instead
            # (harmless), same "ambiguous -> TEXT" rule as IMAGE/VIDEO.
            return {"intent": "TEXT", "prompt": ""}
        return {"intent": "DEV", "file_path": file_path, "instruction": dev_instruction}
    if intent == "CONNECTED_DEV":
        file_path = str(data.get("file_path") or "").strip()
        connected_instruction = str(data.get("instruction") or "").strip()
        if not file_path or not connected_instruction:
            # Same "never guess a path" rule as DEV — doubly true here,
            # since this path belongs to a repo Nova has never seen
            # before; the user must have actually named it.
            return {"intent": "TEXT", "prompt": ""}
        return {"intent": "CONNECTED_DEV", "file_path": file_path, "instruction": connected_instruction}
    if intent == "CONNECTED_BUILD":
        connected_build_instruction = str(data.get("instruction") or "").strip()
        if len(connected_build_instruction) < 10:
            return {"intent": "TEXT", "prompt": ""}
        return {"intent": "CONNECTED_BUILD", "instruction": connected_build_instruction}
    if intent == "BUILD":
        build_instruction = str(data.get("instruction") or "").strip()
        if len(build_instruction) < 10:
            # Nothing specific enough to build from — same
            # "ambiguous -> TEXT" rule as every other intent here. A
            # vague build request becomes a normal conversation where
            # Nova can ask what exactly is wanted, which is the right
            # outcome anyway.
            return {"intent": "TEXT", "prompt": ""}
        return {"intent": "BUILD", "instruction": build_instruction}
    if intent in ("LEARN", "IMPROVE"):
        topic = str(data.get("topic") or "").strip()
        if intent == "LEARN" and not topic:
            # No confident topic — same "ambiguous -> TEXT" rule as
            # DEV/IMAGE/VIDEO above rather than researching something
            # vague.
            return {"intent": "TEXT", "prompt": ""}
        # IMPROVE's topic may legitimately be empty (owner didn't name
        # a specific area) — self_improve.research_and_propose picks a
        # real rotating topic itself in that case, same as the
        # scheduled weekly trigger.
        return {"intent": intent, "topic": topic}
    if intent == "PROPOSAL_ACTION":
        action = str(data.get("action") or "").strip().upper()
        proposal_id = str(data.get("proposal_id") or "").strip()
        if action not in ("ACCEPT", "REJECT", "ASSESS", "IMPLEMENT") or not proposal_id:
            # No confident action/id — never guess which proposal this
            # is about, same "ambiguous -> TEXT" rule as everywhere else
            # here.
            return {"intent": "TEXT", "prompt": ""}
        return {"intent": "PROPOSAL_ACTION", "action": action, "proposal_id": proposal_id}
    if intent not in ("IMAGE", "VIDEO", "TEXT"):
        intent = "TEXT"
    prompt = str(data.get("prompt") or "").strip()
    if intent != "TEXT" and len(prompt) < 3:
        # Untrustworthy media prompt — safer to fall through to a normal
        # (harmless) conversational answer than to burn the user's
        # image/video quota on a malformed request.
        intent, prompt = "TEXT", ""
    return {"intent": intent, "prompt": prompt}


_CONNECTED_DEV_ADDENDUM = (
    "\n\nملاحظة إضافية (تنطبق على أي مستخدم، وليس المالك فقط): قد تكون "
    "رسالته طلباً بأن تعمل على موقعه أو تطبيقه أو مستودعه **الخاص به هو** "
    "الذي ربطه بنوفا مسبقاً (وليس مشروعنا نحن) — مثل \"عدّل ملف كذا في "
    'مستودعي ليفعل كذا\" أو \"أصلح الخطأ الفلاني في موقعي\". إن كانت '
    'كذلك، أجب بهذا الشكل:\n'
    '{"intent": "CONNECTED_DEV", "file_path": "المسار الحقيقي للملف داخل '
    "مستودعه إن ذكره أو كان واضحاً جداً من السياق، وإلا اتركه فارغاً تماماً "
    '(لا تخمّن مساراً غير مؤكد أبداً)", "instruction": "وصف دقيق وواضح لما '
    'يجب تغييره في الملف، بأي لغة"}\n'
    "لا تستخدم CONNECTED_DEV إلا إذا كان الطلب فعلاً عن تعديل حقيقي في "
    "موقع/مستودع خاص بهذا المستخدم نفسه — لا تستخدمها لسؤال عام عن "
    "البرمجة، ولا لطلب يخص مشروعنا نحن (تلك هي DEV، للمالك فقط).\n\n"
    "أو قد تكون رسالته طلب بناء شيء جديد كاملاً (عدة ملفات معاً — صفحة "
    "أو أداة أو ميزة) **داخل مستودعه الخاص هو** الذي ربطه بنوفا — مثل "
    '"ابنِ لي صفحة هبوط في مستودعي" أو "أضف ميزة كذا لموقعي". إن كانت '
    'كذلك، أجب بهذا الشكل:\n'
    '{"intent": "CONNECTED_BUILD", "instruction": "وصف كامل ودقيق لما '
    'يجب بناؤه، شاملاً كل تفصيل ذكره المستخدم"}\n'
    "لا تستخدمها لطلب يخص مشروعنا نحن (تلك هي BUILD، للمالك فقط)."
)


def classify_intent(message: str, recent_context: str = "", allow_dev: bool = False) -> dict:
    """Owner correction, 2026-09-09 ("ليس هدفنا البوت... اذا وضعنا اوامر
    اجبارية لاجل تنظيم الرد بالبوت... سيكون مبرمج على الاجبار وليس الذكاء
    المعرفي"): replaces both the old keyword-list detector
    (novaBotLogic.ts's since-removed detectMediaGenerationIntent, which
    only matched literal generation verbs + media nouns) and the bot's
    force_reply trick (which only worked because the user was replying
    to a specific marker message) — both were mechanical string-matching,
    not real understanding, and would have carried that same rigidity
    into the future standalone app/website this bot is just a testing
    container for.

    OUR OWN model decides the real ANSWER first, always (council.answer,
    called separately after this — untouched, still tries our own model
    before Groq, exactly as the "our own model is the product" rule
    requires for what the user actually sees). This classification step
    is different: it is invisible routing, not the visible voice, the
    same category as router.classify()'s CODE/LIVE_INFO/GENERAL split —
    and real evidence, 2026-09-09 ("مرحبا" and "الووو" both got zero
    reply for minutes), showed the reverse order (our slow CPU-only
    model first, here too) was a real regression: it silently doubled
    every plain message's model-call burden (this classification, then
    the real answer) on a box already measured taking 45-95s+ for ONE
    call — ordinary chat itself stopped responding. Groq-first here
    fixes that (typically a few seconds), while still being genuine
    model understanding, never a keyword list — falling back to our own
    model only if Groq is unreachable, the same real-world availability
    logic used everywhere else in this file, just pointed the other way
    for this one invisible step. Any parse failure, empty response, or
    ambiguous result defaults to TEXT: a missed media request just
    becomes a normal conversational answer (harmless), while a false
    positive would wrongly reserve/burn a user's image/video quota.

    allow_dev (owner spec, 2026-09-12: "محادثتي له ستكون عبر البوت...
    كما اتحدث معك الآن" — talk naturally instead of memorizing a fixed
    "/اقتراح_تعديل <path> :: <instruction>" command): main.py passes
    True only when quota.is_platform_owner(user) already confirmed the
    caller is the owner — adds FOUR owner-only options to the schema:
    DEV (a real code-change proposal, see dev_agent.py), LEARN (a real,
    on-demand research-and-store command — "اذهب وابحث عن وسائل لتطوير
    قدراتك... وقم بتغذية نفسك بها" — actual execution, not a reply
    describing what it would do; see rag.learn_now), and IMPROVE (owner
    spec, same day: "الادوات والتطوير الذاتي يعطيني تقرير... فاقبل او
    ارفض" — researches a way to improve Nova's OWN capabilities and
    produces a real report awaiting the owner's explicit accept/reject,
    never auto-applied; see self_improve.research_and_propose), and
    PROPOSAL_ACTION (owner spec, same day: "لا اريد استخدام اوامر
    بدالات... اريده ان يفهم كلامي دون هذه الدالات" — a plain-language
    decision on an earlier proposal, e.g. "وافق على الاقتراح رقم كذا"
    or "نفّذ، أعطيك الصلاحية الكاملة", instead of typing
    "/موافقة_تطوير <id>" — the slash commands still work too, this is
    just no longer the only way in; see main.py's PROPOSAL_ACTION
    branch for the four real actions it can resolve to). A file
    path/topic/proposal id the model isn't confident about never gets
    guessed (see _parse_intent_json) — that falls through to TEXT,
    same as any other
    ambiguous case here."""
    instruction = _INTENT_CLASSIFY_INSTRUCTION.format(context=recent_context or "(لا يوجد سياق سابق)", message=message)
    # CONNECTED_DEV is offered to EVERY user, not gated by allow_dev —
    # owner spec, 2026-09-13 ("يضيف نوفا لمواقعه كما اضفتك انا لمواقعي"):
    # any authenticated user may ask Nova to act on THEIR OWN connected
    # repo. Real safety is the connections table itself
    # (app/connections.py) checked downstream by main.py, not this
    # classification step — a user with zero connections just gets an
    # honest "not connected yet" reply instead of a guessed action.
    instruction += _CONNECTED_DEV_ADDENDUM
    if allow_dev:
        instruction += _DEV_INTENT_ADDENDUM
    raw = None
    try:
        raw = call_groq(instruction, "")
    except Exception:
        raw = None
    if not raw or len(raw.strip()) < 2:
        raw = call_modelscope_specialist(instruction, "", query_type="GENERAL")
    return _parse_intent_json(raw or "")


def generate_image(prompt: str) -> bytes | None:
    """Thin wrapper enforcing a real hard wall-clock deadline — see
    with_hard_deadline's own docstring (same real bug that made a
    plain "مرحبا" hang forever: an SSE stream with keepalive bytes can
    keep requests' own `timeout=` from ever firing)."""
    return with_hard_deadline(_generate_image_blocking, prompt, timeout=1830)


def _generate_image_blocking(prompt: str) -> bytes | None:
    """OUR OWN image-GENERATION model — real evidence, 2026-09-09
    (Render's own logs): Hugging Face's free "hf-inference" provider
    refuses to serve our own Stable Diffusion repo too, not just
    text/vision ("Model not supported by provider hf-inference") — the
    exact same wall already hit and fixed for text/vision. Same fix,
    consolidated onto the one platform that actually works: this now
    calls the SAME ModelScope Studio as call_modelscope_specialist
    above, at a second endpoint (api_name="generate_image") the Studio
    now also exposes. Hugging Face is no longer part of live serving at
    all — only used to archive trained weights (see
    ai-system/colab/generate_image_model.ipynb)."""
    if not MODELSCOPE_SPACE_URL or not MODELSCOPE_API_TOKEN:
        return None
    import base64
    import json

    import requests

    base = MODELSCOPE_SPACE_URL.rstrip("/")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Authorization": f"Bearer {MODELSCOPE_API_TOKEN}",
    }
    try:
        submit = requests.post(
            f"{base}/gradio_api/call/v2/generate_image",
            headers=headers,
            json={"prompt": prompt},
            timeout=30,
        )
        logger.info("image-gen: ModelScope POST status=%s body=%s", submit.status_code, submit.text[:300])
        submit.raise_for_status()
        event_id = submit.json()["event_id"]
        # Owner report, 2026-09-09 (real evidence: the server had been up
        # and stable for 30+ minutes, ruling out the previous "still
        # restarting after a deploy" guess this function's failure
        # message used to make). 300s was itself an unverified guess by
        # analogy to vision's ~241s CLIP *encoder* pass — a single
        # forward pass, not 25 full U-Net denoising steps + a VAE
        # decode, which is a categorically heavier CPU workload. Raised
        # to the same "deliberately generous, not a guessed minimum"
        # philosophy generate_video already uses below, until a real
        # measured duration replaces this number too.
        result_resp = requests.get(
            f"{base}/gradio_api/call/generate_image/{event_id}",
            headers=headers,
            timeout=1800,
            stream=True,
        )
        logger.info("image-gen: ModelScope GET status=%s", result_resp.status_code)
        result_resp.raise_for_status()
        raw_lines = []
        for line in result_resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            raw_lines.append(line)
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:") :].strip())
            if isinstance(payload, list) and payload and payload[0]:
                return base64.b64decode(str(payload[0]))
        logger.info("image-gen: ModelScope SSE stream ended with no usable result — raw lines: %s", raw_lines[:20])
        return None
    except Exception as e:
        logger.info("image-gen: our own model (ModelScope) call failed (%s)", e)
        return None


_VIDEO_FPS = 8  # matches export_to_video(fps=8) on the ModelScope side


def _seconds_to_cogvideox_frames(seconds: int) -> int:
    """CogVideoX's temporal VAE has a real, documented architectural
    constraint (not a guess): it compresses frames 4x, so the frame
    count it was trained/tested against is of the form 4n+1 (49 = the
    exact value used in every test run so far, on both Kaggle's GPU and
    this Studio's own generate_video below). Rounds the requested
    duration to the nearest valid 4n+1 count instead of an arbitrary
    frame number diffusers/CogVideoX was never validated against."""
    raw_frames = max(1, round(seconds * _VIDEO_FPS))
    n = round((raw_frames - 1) / 4)
    return max(25, n * 4 + 1)  # floor of 25 (~3s) — anything shorter is a degenerate clip


def generate_video(prompt: str, seconds: int = 6) -> bytes | None:
    """Owner spec, 2026-09-12 ("لا اريد عرض شرائح... اريد فديو حقيقي"):
    UNUSED as of this date — main.py's real video path now enqueues to
    NovaVideoQueue (quota.enqueue_video) for a scheduled Kaggle batch
    run (ai-system/colab/process_video_queue.ipynb, real CogVideoX-2B
    on a real T4 GPU) instead of calling this CPU-only keyframe
    slideshow. Kept, not deleted: the real, working fallback if the
    Kaggle batch pipeline is ever unavailable and an instant (if
    honestly-labeled-as-a-slideshow) response is preferred again over
    no video at all.

    Thin wrapper enforcing a real hard wall-clock deadline — see
    with_hard_deadline's own docstring (same real bug that made a
    plain "مرحبا" hang forever: an SSE stream with keepalive bytes can
    keep requests' own `timeout=` from ever firing).

    Owner directive, 2026-09-08 (real evidence, not guessed — see
    _generate_video_blocking's own docstring below for the full
    measurement): this used to be a 4-hour ceiling because CogVideoX-2B
    on CPU was genuinely unmeasured territory. It no longer is: the
    serving side now builds video from real AI keyframes (the
    already-fast image pipeline) plus classical animation, not raw
    video diffusion, so a 30-minute ceiling is already generous — if a
    request is anywhere near that long, something is genuinely stuck,
    not just slow, and the user deserves a real failure message far
    sooner than 4 hours."""
    return with_hard_deadline(_generate_video_blocking, prompt, seconds, timeout=1830)


def _generate_video_blocking(prompt: str, seconds: int = 6) -> bytes | None:
    """Owner spec, 2026-09-08/09 ("قم ايضا بارسال الفديو الى
    ModelScope" + "الافتراضي 6 الى 10 حسب الطلب"): originally called
    into a raw CogVideoX-2B pipeline on the CPU-only ModelScope box.

    Owner directive, 2026-09-08 (real measured evidence): a genuine T4
    GPU test (Lightning AI, same model, same parameters) generated this
    exact video in 157 seconds. Real attempts on this CPU-only box
    either hung indefinitely or hit the hard deadline and failed
    outright — not a tuning gap but a ~100-1000x hardware gap (GPUs are
    built for the massively parallel compute video diffusion needs; no
    CPU-viable model closes that today). Confirmed by direct
    comparison, not assumed.

    The serving side (ai-system/modelscope-studio/app.py's
    generate_video) now builds "video" a different, honest way instead:
    real AI keyframe images from the already-fast owned image pipeline
    (sd-turbo, seconds per frame on GPU / a real but far smaller CPU
    cost than full video diffusion), assembled via classical, zero-AI
    pan/zoom + crossfade animation (Ken Burns effect). This function
    itself is unchanged below — it's still just the HTTP call to the
    Studio's Gradio API — only what runs on the other end changed.

    Real evidence on hosting a true video-diffusion model elsewhere:
    Hugging Face's free hf-inference provider's own error response
    lists every task it supports — "text-to-video" isn't in that list
    for ANY model, not just custom repos (2026-09-09, Render logs) — so
    no HF-based fix exists regardless."""
    if not MODELSCOPE_SPACE_URL or not MODELSCOPE_API_TOKEN:
        return None
    import base64
    import json

    import requests

    num_frames = _seconds_to_cogvideox_frames(seconds)
    # Owner report, 2026-09-12 (real complaint): a fixed 3 keyframes
    # regardless of requested duration reads as "the same few pictures
    # stretched out" on anything longer than a few seconds — more
    # distinct AI-generated stills per second gives real visual change
    # to look at, at the cost of more (still fast, sd-turbo) image
    # calls. One keyframe per ~1.5s of requested duration, floored at
    # the old fixed 3 and capped at 8 to bound that added cost on a
    # long request.
    num_keyframes = max(3, min(8, round(seconds / 1.5)))
    base = MODELSCOPE_SPACE_URL.rstrip("/")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Authorization": f"Bearer {MODELSCOPE_API_TOKEN}",
    }
    try:
        submit = requests.post(
            f"{base}/gradio_api/call/v2/generate_video",
            headers=headers,
            json={"prompt": prompt, "num_frames": num_frames, "num_keyframes": num_keyframes},
            timeout=30,
        )
        logger.info("video-gen: ModelScope POST status=%s body=%s", submit.status_code, submit.text[:300])
        submit.raise_for_status()
        event_id = submit.json()["event_id"]
        # This is only requests' own per-chunk read timeout (see
        # with_hard_deadline's docstring for why that's a different,
        # weaker guarantee than total call duration) — the real ceiling
        # on total time is generate_video()'s outer 1830s hard deadline
        # above, which fires regardless of what's set here. Kept
        # generous anyway so a single slow keyframe download/step
        # doesn't trip this inner timeout before the outer one gets a
        # chance to return a clean None.
        result_resp = requests.get(
            f"{base}/gradio_api/call/generate_video/{event_id}",
            headers=headers,
            timeout=1800,
            stream=True,
        )
        logger.info("video-gen: ModelScope GET status=%s", result_resp.status_code)
        result_resp.raise_for_status()
        raw_lines = []
        for line in result_resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            raw_lines.append(line)
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:") :].strip())
            if isinstance(payload, list) and payload and payload[0]:
                return base64.b64decode(str(payload[0]))
        logger.info("video-gen: ModelScope SSE stream ended with no usable result — raw lines: %s", raw_lines[:20])
        return None
    except Exception as e:
        logger.info("video-gen: our own model (ModelScope) call failed (%s)", e)
        return None


_DEV_AGENT_INSTRUCTION_TEMPLATE = (
    "هذا هو المحتوى الحالي الكامل للملف {file_path} في مشروعنا:\n\n"
    "```\n{current_content}\n```\n\n"
    "التعديل المطلوب: {instruction}\n\n"
    "أعد كتابة الملف بالكامل بعد تطبيق هذا التعديل فقط، بلا أي تغيير آخر "
    "غير مطلوب، وبلا أي شرح أو مقدمة أو علامات ```‎ من أي نوع — أعد فقط "
    "المحتوى الكامل النهائي للملف كما سيُكتب حرفياً على القرص، من أول "
    "سطر فيه إلى آخر سطر."
)


_DEV_AGENT_REPAIR_TEMPLATE = (
    "الملف التالي الذي كتبتَه للتو لا يمر بفحص نحوي حقيقي — هذا ليس رأياً، بل "
    "نتيجة مُحلِّل فعلي رفض الملف.\n\n"
    "الخطأ الحقيقي: {error}\n\n"
    "هذا هو المحتوى الذي كتبتَه:\n```\n{broken}\n```\n\n"
    "أصلح هذا الخطأ تحديداً مع الحفاظ على التعديل المطلوب أصلاً ({instruction}) "
    "كما هو. أعد فقط المحتوى الكامل النهائي للملف كما سيُكتب حرفياً على القرص، "
    "من أول سطر إلى آخر سطر، بلا أي شرح أو مقدمة أو علامات ```‎ من أي نوع."
)


def _strip_code_fences(text: str) -> str:
    """Turns a raw model response into real file content. A small model
    ignoring the "no ``` fences" instruction is a real, observed habit in
    this project (see app.py's _extract_final_answer) — one shared helper
    instead of the same two re.sub lines copy-pasted at every site.

    Also guarantees exactly one trailing newline: the .strip() this
    replaced was removing it, so every file the Dev Agent has ever
    written landed without a final newline (git's own "\\ No newline at
    end of file"), unlike every hand-written file in this repo."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n", "", cleaned)
        cleaned = re.sub(r"\n```\s*$", "", cleaned)
    return f"{cleaned}\n" if cleaned else cleaned


def validate_or_repair(file_path: str, content: str, instruction: str) -> tuple[str, str, str]:
    """Owner spec, 2026-09-13 ("كتابة الاكواد واصلاح الاخطاء"): the real
    gate that used to be missing entirely — before this, whatever the
    model produced went straight into a branch and a PR, and the first
    thing that ever looked at it was Render's own deploy, live, after
    the merge.

    Returns (final_content, advisory_note, failure_message):
      - failure_message non-empty -> caller must NOT open a PR; the
        string is a real, specific explanation ready to send the owner.
      - advisory_note non-empty -> a soft warning to surface in the PR
        body (see code_check's two-tier design); never a reason to stop.

    Exactly ONE repair round on purpose, not a loop: a model that fails
    a deterministic parser twice on the same file is not converging, and
    an unbounded retry loop against a free-tier quota is its own
    failure mode. Failing honestly beats grinding."""
    ok, message = code_check.validate(file_path, content)
    if ok:
        return content, message, ""

    logger.info("dev-agent: generated %s failed validation (%s) — attempting one real repair round", file_path, message)
    repair_prompt = _DEV_AGENT_REPAIR_TEMPLATE.format(
        error=message, broken=content, instruction=instruction
    )
    repaired = _strip_code_fences(
        call_modelscope_specialist(repair_prompt, "", query_type="CODE") or call_groq(repair_prompt, "")
    )
    if not repaired:
        return content, "", f"الكود الذي ولّدته لم يمر بالفحص النحوي ({message})، ومحاولة الإصلاح لم تُرجع شيئاً — لم أفتح أي Pull Request."

    ok_after, message_after = code_check.validate(file_path, repaired)
    if ok_after:
        logger.info("dev-agent: repair round fixed %s", file_path)
        return repaired, message_after, ""

    return (
        content,
        "",
        f"لم أفتح أي Pull Request عمداً: الكود لم يمر بالفحص النحوي الحقيقي.\n"
        f"الخطأ الأول: {message}\n"
        f"وبعد محاولة إصلاح واحدة، بقي الخطأ: {message_after}\n"
        f"أخبرني بصياغة أوضح لما تريده بالضبط، أو راجع الملف بنفسك.",
    )


_MAX_BUILD_FILES = 5

_APP_PLAN_PROMPT = (
    "المالك يطلب بناء شيء حقيقي جديد في مشروعنا (موقع/صفحة/تطبيق صغير/أداة). "
    "خطّط الملفات المطلوبة فعلاً، ولا تخطّط أكثر مما يلزم.\n\n"
    "أجب حصراً بصيغة JSON صحيحة بلا أي نص إضافي:\n"
    '{{"summary": "وصف موجز بجملة أو جملتين لما ستبنيه", '
    f'"files": [{{{{"path": "المسار الحقيقي داخل المستودع", "purpose": "ما يفعله هذا الملف بالضبط"}}}}]}}}}\n\n'
    f"قواعد إلزامية: {_MAX_BUILD_FILES} ملفات كحد أقصى. مسارات حقيقية متسقة مع بنية المشروع "
    "(صفحات Next.js تحت src/app/...). ممنوع منعاً باتاً أي ملف تحت .github/ — "
    "لا تخطّط له أصلاً.\n\n"
    "الطلب:\n{instruction}"
)

_APP_FILE_PROMPT = (
    "أنت تبني هذا: {summary}\n\n"
    "الطلب الأصلي من المالك: {instruction}\n\n"
    "الملفات التي ستتكوّن منها هذه الإضافة كاملةً:\n{file_list}\n\n"
    "اكتب الآن محتوى هذا الملف وحده: {path}\nالغرض منه: {purpose}\n\n"
    "اجعله متسقاً تماماً مع بقية الملفات أعلاه (نفس الأسماء والمسارات والاستدعاءات بينها). "
    "أعد فقط المحتوى الكامل النهائي للملف كما سيُكتب حرفياً على القرص، بلا أي شرح أو "
    "مقدمة أو علامات ```‎ من أي نوع."
)


def propose_app_build(
    instruction: str, auto_merge: bool = False,
    *, token: str | None = None, repo: str | None = None, base_branch: str | None = None,
    body_prefix: str = "بناء كامل من نوفا (وضع المالك) بناءً على الطلب:",
    branch_prefix: str = "nova-build",
) -> str:
    """Owner spec, 2026-09-13 ("بناء التطبيقات وتصميم المواقع بطرق
    احترافية"): the Dev Agent could only ever touch ONE file per PR,
    which is fine for "make the greeting friendlier" and useless for
    "build me a page" — a real page is a component plus a route plus
    styling, and three separate PRs that each half-work are not a
    feature.

    Two phases on purpose, rather than asking for every file in one
    JSON response: a single blob containing several complete source
    files is exactly the shape that gets truncated or mis-escaped, and
    then nothing at all is usable. Planning paths first (small, cheap,
    reliable) and generating each file in its own focused call — with
    the full plan as context so the files stay consistent with each
    other — degrades gracefully instead, and lets every file go through
    the same real validation gate (validate_or_repair) individually.

    Anything that fails validation after its one repair round is
    dropped from the build and named explicitly in the result, rather
    than shipping a PR that silently contains a broken file."""
    raw_plan = call_modelscope_specialist(
        _APP_PLAN_PROMPT.format(instruction=instruction), "", query_type="CODE"
    ) or call_groq(_APP_PLAN_PROMPT.format(instruction=instruction), "")
    plan = _parse_json_blob(raw_plan or "")
    summary = str(plan.get("summary") or "").strip()
    raw_files = plan.get("files") if isinstance(plan.get("files"), list) else []

    planned = []
    for entry in raw_files[:_MAX_BUILD_FILES]:
        if not isinstance(entry, dict):
            continue
        path = str(entry.get("path") or "").strip().lstrip("/")
        purpose = str(entry.get("purpose") or "").strip()
        if path:
            planned.append({"path": path, "purpose": purpose})
    if not planned:
        return "لم أستطع وضع خطة ملفات واضحة لهذا الطلب — صِفه لي بتفصيل أكثر (ما الذي تريده بالضبط، ولمن؟)."

    file_list = "\n".join(f"- {item['path']}: {item['purpose']}" for item in planned)
    built, skipped = [], []
    for item in planned:
        prompt = _APP_FILE_PROMPT.format(
            summary=summary or instruction, instruction=instruction,
            file_list=file_list, path=item["path"], purpose=item["purpose"],
        )
        raw_content = call_modelscope_specialist(prompt, "", query_type="CODE") or call_groq(prompt, "")
        content = _strip_code_fences(raw_content)
        if not content:
            skipped.append(f"{item['path']} (لم يُرجع النموذج محتوى)")
            continue
        content, _advisory, failure = validate_or_repair(item["path"], content, item["purpose"] or instruction)
        if failure:
            skipped.append(f"{item['path']} (لم يمر بالفحص النحوي)")
            continue
        built.append({"path": item["path"], "content": content})

    if not built:
        return (
            "خطّطتُ الملفات لكن لم ينجح أي ملف في اجتياز الفحص النحوي، فلم أفتح أي Pull Request:\n"
            + "\n".join(f"- {s}" for s in skipped)
        )

    branch_name = f"{branch_prefix}/{uuid.uuid4().hex[:10]}"
    try:
        dev_agent.create_branch(branch_name, base_branch, token=token, repo=repo)
        for item in built:
            dev_agent.upsert_file(
                item["path"], branch_name, item["content"],
                commit_message=f"Nova build: {item['path']}",
                token=token, repo=repo,
            )
        body = (
            f"{body_prefix}\n\n> {instruction}\n\n"
            f"{summary}\n\n**الملفات:**\n" + "\n".join(f"- `{i['path']}`" for i in built)
        )
        if skipped:
            body += "\n\n**استُبعدت (لم تجتز الفحص النحوي):**\n" + "\n".join(f"- {s}" for s in skipped)
        body += (
            "\n\nكل ملف أعلاه مرّ بفحص نحوي حتمي قبل كتابته (`ai-system/app/code_check.py`).\n"
            "إن كان هذا المستودع موصولاً بـVercel، سيعلّق بوت Vercel هنا برابط معاينة حي "
            "يمكنك فتحه ورؤية النتيجة بعينك قبل الدمج."
        )
        pr_url, pr_number = dev_agent.open_pull_request(
            branch_name, title=f"Nova build: {(summary or instruction)[:60]}", body=body,
            base_branch=base_branch, token=token, repo=repo,
        )
        if auto_merge:
            try:
                dev_agent.merge_pull_request(pr_number, token=token, repo=repo)
            except dev_agent.DevAgentError as e:
                return f"بنيتُ {len(built)} ملفاً لكن فشل الدمج التلقائي — الـPR مفتوح للمراجعة:\n{pr_url}\n({e})"
    except dev_agent.DevAgentError as e:
        return str(e)

    lines = [f"✅ بنيتُ {len(built)} ملفاً وفتحتُ Pull Request:", pr_url, "", "الملفات:"]
    lines += [f"- {i['path']}" for i in built]
    if skipped:
        lines += ["", "استبعدتُ (لم تجتز الفحص النحوي):"] + [f"- {s}" for s in skipped]
    lines += ["", "افتح الرابط أعلاه — إن كان Vercel موصولاً ستجد فيه رابط معاينة حي للنتيجة."]
    return "\n".join(lines)


def propose_app_build_for_connection(user_id: str, instruction: str) -> str:
    """The CONNECTED_BUILD counterpart to propose_code_change_for_connection
    above — same real trust boundary (this user's own ACTIVE
    NovaConnection, looked up fresh, never guessed or borrowed from
    another user or this project's own env vars), same real gate
    (never auto_merge for a regular user's own repo)."""
    from app.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

    from app import connections

    connection = connections.get_connection(user_id, "github", SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    if not connection:
        return (
            "لم تربط أي مستودع GitHub بعد — نوفا لا يستطيع البناء في أي موقع لم يُربط صراحة. "
            "اربط مستودعك أولاً من صفحتك الخاصة في البوت (زر «🔗 ربط حساباتي»)، ثم أعد طلبك."
        )

    return propose_app_build(
        instruction, auto_merge=False,
        token=connection["credential"], repo=connection["label"], base_branch=connection.get("baseBranch"),
        body_prefix=f"بناء كامل من نوفا بناءً على طلبك على مستودعك «{connection['label']}»:",
        branch_prefix="nova-connected-build",
    )


def _propose_code_change_core(
    file_path: str, instruction: str, auto_merge: bool, body_prefix: str,
    *, token: str | None = None, repo: str | None = None, base_branch: str | None = None,
    branch_prefix: str = "nova-dev-agent",
) -> str:
    """Shared by propose_code_change (owner, this project's own repo)
    and propose_code_change_for_connection (any user, THEIR OWN
    connected repo) below — identical generation, validation, and
    branch/PR mechanics either way; only which repo/credential/whether
    auto_merge is even offered differs per caller. Extracted 2026-09-13
    once a second real caller needed the exact same logic, rather than
    a second copy that could drift out of sync with the first."""
    try:
        current_content, sha = dev_agent.get_file(file_path, token=token, repo=repo)
    except dev_agent.DevAgentError as e:
        return str(e)

    prompt = _DEV_AGENT_INSTRUCTION_TEMPLATE.format(
        file_path=file_path, current_content=current_content, instruction=instruction
    )
    new_content = call_modelscope_specialist(prompt, "", query_type="CODE") or call_groq(prompt, "")
    if not new_content or not new_content.strip():
        return "تعذّر توليد التعديل المقترح — لم يُرجع النموذج محتوى صالحاً. حاول صياغة الطلب بشكل أوضح."

    cleaned = _strip_code_fences(new_content)

    cleaned, advisory, failure = validate_or_repair(file_path, cleaned, instruction)
    if failure:
        return failure

    branch_name = f"{branch_prefix}/{uuid.uuid4().hex[:10]}"
    try:
        dev_agent.create_branch(branch_name, base_branch, token=token, repo=repo)
        dev_agent.update_file(
            file_path, branch_name, cleaned, sha,
            commit_message=f"Nova: {instruction[:200]}",
            token=token, repo=repo,
        )
        pr_url, pr_number = dev_agent.open_pull_request(
            branch_name,
            title=f"Nova: {instruction[:70]}",
            body=(
                f"{body_prefix}\n\n> {instruction}\n\nالملف: `{file_path}`\n\n"
                + (f"⚠️ {advisory}\n\n" if advisory else "")
                + ("**دُمج تلقائياً.**" if auto_merge
                   else "**هذا اقتراح فقط — يتطلب مراجعتك قبل أي دمج، ولم يُدمج تلقائياً.**")
            ),
            base_branch=base_branch, token=token, repo=repo,
        )
        if auto_merge:
            try:
                dev_agent.merge_pull_request(pr_number, token=token, repo=repo)
                return f"✅ تم إنشاء التعديل ودمجه تلقائياً:\n{pr_url}"
            except dev_agent.DevAgentError as e:
                return f"تم إنشاء الاقتراح لكن فشل الدمج التلقائي — يبقى مفتوحاً للمراجعة اليدوية:\n{pr_url}\n({e})"
        return f"✅ تم إنشاء اقتراح التعديل كطلب Pull Request للمراجعة:\n{pr_url}"
    except dev_agent.DevAgentError as e:
        return str(e)


def propose_code_change(file_path: str, instruction: str, auto_merge: bool = False) -> str:
    """Owner-only "Dev Agent" entry point — main.py calls this ONLY
    after confirming quota.is_platform_owner(user) for the current
    request; there is no separate authorization check here, same
    one-check-done-upstream pattern as the /admin/* endpoints'
    _require_internal.

    Owner spec, 2026-09-12, verbatim, still the DEFAULT behavior here:
    "ممنوع التنفيذ الفوري أو الكتابة المباشرة على الفرع الحي بأي شكل...
    أي تعديل يقترحه نوفا يُنشأ كفرع Git جديد + Pull Request... ولا
    يُدمج إلا بعد مراجعة." Never writes to NOVA_DEV_AGENT_BASE_BRANCH
    directly — dev_agent.create_branch always forks a fresh branch
    first, dev_agent.update_file only ever targets that fresh branch.

    auto_merge — owner follow-up, 2026-09-12 ("بداية نفعلها لي أنا مع
    الدمج التلقائي"): the ONE explicit, opt-in exception to "never
    merges" — main.py only ever passes True here for the owner's own
    requests specifically. See propose_code_change_for_connection below
    for why regular users never get this."""
    return _propose_code_change_core(
        file_path, instruction, auto_merge,
        body_prefix="مقترح تلقائي من نوفا (وضع المالك)، بناءً على الطلب التالي:",
    )


def propose_code_change_for_connection(user_id: str, file_path: str, instruction: str) -> str:
    """Owner spec, 2026-09-13 ("يضيف نوفا لمواقعه كما اضفتك انا
    لمواقعي... لااريد ان يكون كل مستخدم يكتب في البوت اذهب ونفذ كذا
    فيقوم بالتنفيذ"): the real, generalized version of the Dev Agent —
    reachable by ANY authenticated user (see council.classify_intent's
    CONNECTED_DEV addendum, offered unconditionally, not owner-gated),
    but real safety comes from the connections table, not from asking
    who is talking: if this user has no ACTIVE NovaConnection for
    "github", there is no token/repo to act on and this returns an
    honest refusal — never a guess, never the owner's own credential.

    auto_merge is NEVER offered here, unlike the owner's own
    propose_code_change: a regular user's PR always waits for their own
    review on GitHub. The owner's auto_merge was an explicit, informed,
    one-time opt-in for their OWN project; extending that same trust to
    every subscriber's every request by default is a different,
    unreviewed risk this project has not earned the right to take."""
    from app.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

    from app import connections

    connection = connections.get_connection(user_id, "github", SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    if not connection:
        return (
            "لم تربط أي مستودع GitHub بعد — نوفا لا يستطيع العمل على أي موقع لم يُربط صراحة. "
            "اربط مستودعك أولاً من صفحتك الخاصة في البوت (زر «🔗 ربط حساباتي»)، ثم أعد طلبك."
        )

    return _propose_code_change_core(
        file_path, instruction, auto_merge=False,
        body_prefix=f"مقترح تلقائي من نوفا بناءً على طلبك على مستودعك «{connection['label']}»:",
        token=connection["credential"], repo=connection["label"], base_branch=connection.get("baseBranch"),
        branch_prefix="nova-connected",
    )
