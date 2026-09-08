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
import logging

from groq import Groq

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


def analyze_knowledge(query: str, raw_snippets: str) -> str:
    """Owner spec, 2026-09-08: when Nova has to fall back to a live web
    search (see rag.py), the raw search-result titles/snippets aren't
    fit to store as "learned" knowledge as-is — they're fragments from
    several different pages, often redundant or contradictory. This
    turns them into one clean, synthesized Arabic paragraph before
    rag.py stores it in the knowledge bank, so what Nova recalls later
    (and what the Kaggle notebook eventually trains on) is an actual
    answer, not a grab-bag of search-result text. Falls back to
    returning raw_snippets unchanged if Groq isn't configured or the
    call fails — a slightly rougher stored answer beats storing
    nothing at all."""
    if not GROQ_API_KEY:
        return raw_snippets
    try:
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "لديك نتائج بحث خام من الويب حول سؤال معيّن. لخّصها وادمجها في "
                        "فقرة واحدة واضحة ومباشرة بالعربية تجيب عن السؤال مباشرة، بلا "
                        "ذكر لأسماء المواقع أو أنك تلخّص بحثاً. إن تناقضت النتائج، اذكر "
                        "المعلومة الأكثر اتفاقاً بينها فقط."
                    ),
                },
                {"role": "user", "content": f"السؤال: {query}\n\nنتائج البحث الخام:\n{raw_snippets}"},
            ],
            max_tokens=400,
        )
        analyzed = (completion.choices[0].message.content or "").strip()
        return analyzed or raw_snippets
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
    message: str, context: str, image_base64: str | None = None, query_type: str = "GENERAL"
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
            json={"message": user_content, "image_base64": image_base64 or "", "query_type": query_type or "GENERAL"},
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


def answer(message: str, context: str, query_type: str = "GENERAL") -> str:
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
    routing instead of adding a new classification pass."""
    if _is_identity_question(message):
        return _IDENTITY_ANSWER_TEXT

    specialist_answer = call_modelscope_specialist(message, context, query_type=query_type)
    if specialist_answer:
        if _contains_forbidden_identity_leak(specialist_answer):
            logger.warning("chat answer: OUR OWN model leaked a forbidden identity claim — substituting the real identity answer")
            return _IDENTITY_ANSWER_TEXT
        logger.info("chat answer: served by OUR OWN model (ModelScope)")
        return specialist_answer

    logger.info("chat answer: our own model unavailable — served by Groq fallback")
    groq_answer = call_groq(message, context)
    if _contains_forbidden_identity_leak(groq_answer):
        logger.warning("chat answer: Groq fallback leaked a forbidden identity claim — substituting the real identity answer")
        return _IDENTITY_ANSWER_TEXT
    return groq_answer


def generate_image(prompt: str) -> bytes | None:
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
        submit.raise_for_status()
        event_id = submit.json()["event_id"]
        # Real CPU-only Stable Diffusion inference on a 2-vCPU box is
        # genuinely slow (this is exactly why /generate-image is async
        # now — see main.py) — 300s matches the same order of magnitude
        # already measured for vision on this same box, not a guess.
        result_resp = requests.get(
            f"{base}/gradio_api/call/generate_image/{event_id}",
            headers=headers,
            timeout=300,
            stream=True,
        )
        result_resp.raise_for_status()
        for line in result_resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:") :].strip())
            if isinstance(payload, list) and payload and payload[0]:
                return base64.b64decode(str(payload[0]))
        return None
    except Exception as e:
        logger.info("image-gen: our own model (ModelScope) call failed (%s)", e)
        return None


def generate_video(prompt: str) -> bytes | None:
    """Owner spec, 2026-09-09 ("قم ايضا بارسال الفديو الى ModelScope"):
    explicit owner instruction to try this despite two known, real
    risks stated plainly beforehand and not resolved, only accepted:

    1. CogVideoX-2B (2B params) has no GPU to run on here — the same
       test video that took ~17 minutes on a real Kaggle T4 GPU could
       plausibly take HOURS on this CPU-only ModelScope box. The
       timeout below is deliberately generous (not a guessed "should
       be enough" number) for exactly that reason.
    2. This box already holds a 7B GGUF language model AND the Stable
       Diffusion image model (both resident once loaded) — adding this
       third, heaviest model risks exceeding the box's real 16GB RAM
       limit, which could crash the whole Studio process (temporarily
       taking text/vision down too, until it restarts) rather than
       failing just this one request cleanly.

    Real evidence on hosting elsewhere: Hugging Face's free hf-inference
    provider's own error response lists every task it supports — "text-
    to-video" isn't in that list for ANY model, not just custom repos
    (2026-09-09, Render logs) — so no HF-based fix exists regardless."""
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
            f"{base}/gradio_api/call/v2/generate_video",
            headers=headers,
            json={"prompt": prompt},
            timeout=30,
        )
        submit.raise_for_status()
        event_id = submit.json()["event_id"]
        # Deliberately generous (not tuned to "typical" — there is no
        # typical yet): unmeasured CPU-only cost for a 2B video model,
        # stated in this function's own docstring above.
        result_resp = requests.get(
            f"{base}/gradio_api/call/generate_video/{event_id}",
            headers=headers,
            timeout=14400,
            stream=True,
        )
        result_resp.raise_for_status()
        for line in result_resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:") :].strip())
            if isinstance(payload, list) and payload and payload[0]:
                return base64.b64decode(str(payload[0]))
        return None
    except Exception as e:
        logger.info("video-gen: our own model (ModelScope) call failed (%s)", e)
        return None
