"""
Owner spec, 2026-09-13 ("جعله الاول في مجال التعلم الذاتي ومجال المساعد
الشخصي للمهام الصعبة فيما يتعلق بالتحليل العميق والتفكير"): until this
file, every single answer Nova produced — trivial greeting or hardest
question in the world — went through the exact same one-shot path in
main.py's _run_text_pipeline: classify, build context, ONE model call,
done. No decomposition of a hard problem, no deliberate evidence
gathering, no checking its own work before speaking. That is the real
reason a small self-hosted model feels shallow on hard tasks, and it is
not fixable by fine-tuning alone.

This module adds real multi-step reasoning for hard messages only:

  1. PLAN     — break the question into the sub-questions that actually
                have to be answered, and say what needs looking up.
  2. EVIDENCE — really look those up (rag.web_search: Tavily, then ddgs,
                then DuckDuckGo IA), not "as far as I know".
  3. DRAFT    — a first reasoned answer grounded in that evidence.
  4. CRITIQUE — adversarially attack that draft: what's wrong, missing,
                unsupported, or plain hallucinated?
  5. FINAL    — OUR OWN model writes what the user actually reads, given
                the plan, the evidence and the critique as material.

The division of labour in there is the whole design, and it follows a
rule this project already settled once, for classify_intent: invisible
routing/scaffolding work goes to Groq (fast, free, and nobody ever sees
its prose), while the VISIBLE VOICE is always our own model, because
our own model is the product. Steps 1-4 are scaffolding. Step 5 is
Nova. So the user still hears Nova, and the latency budget is barely
touched: those four Groq calls take a few seconds total, against the
45-95s our own model already takes for the single call it was making
anyway (real measured numbers — see _run_text_pipeline's docstring).

Every step fails soft. If Groq is unreachable, if the search finds
nothing, if the JSON comes back malformed — deep_answer returns None
and main.py runs exactly the pipeline it ran before this file existed.
A degraded deep-think must never be worse than no deep-think.

The second half of why this exists is self-learning, not just answer
quality. store_trace writes a compact record of how a hard question was
actually reasoned through into the same NovaKnowledgeEntry bank the
weekly Kaggle fine-tune already trains on (cell 4ب) — so the next
training run distills Nova's own best REASONING into its own weights,
not just facts it looked up. Over time the scaffolding above should
become less necessary, because the thinking moves into the model
itself. That needs no new table and no notebook change: it reuses a
real pipeline that already runs every week.
"""
import json
import logging
import re

from app import council, knowledge_store, rag
from app.config import GROQ_API_KEY, GROQ_MODEL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

logger = logging.getLogger("nova")

_MAX_SEARCH_QUERIES = 2
_MAX_RESULTS_PER_QUERY = 3
_MIN_LENGTH_FOR_DEPTH = 180

# Effort-allocation heuristics, NOT intent detection. The owner's
# standing rule against keyword matching (2026-09-09: "اذا وضعنا اوامر
# اجبارية... سيكون مبرمج على الاجبار وليس الذكاء المعرفي") is about
# understanding what the user WANTS — that still goes through real model
# understanding in council.classify_intent, untouched. This decides
# something different and much cheaper: how much compute to spend on a
# message whose meaning is already understood. It is the same category
# as router.classify's existing CODE/LIVE_INFO/GENERAL split, and it is
# deliberately heuristic so that deciding to think hard never itself
# costs a model call. Being wrong here is cheap in both directions: a
# missed hard question just gets today's normal good answer, and a false
# positive spends a few extra free Groq seconds.
_DEPTH_MARKERS = re.compile(
    r"حلّ?ل|قارن|صمّ?م|خطة|استراتيجية|لماذا|كيف أبني|كيف نبني|أفضل طريقة|"
    r"ما الفرق|اشرح بالتفصيل|بالتفصيل|أعمق|ابحث لي|راجع|قيّم|"
    r"analy[sz]e|compare|design|architect|strategy|trade-?off|why does|"
    r"how (?:do|would) i build|best way|in depth|evaluate|review",
    re.IGNORECASE,
)

_PLAN_PROMPT = (
    "أنت تساعد في التفكير في سؤال قبل الإجابة عليه، ولستَ من يجيب. "
    "حلّل السؤال التالي وأجب حصراً بصيغة JSON صحيحة بلا أي نص إضافي:\n"
    '{{"sub_questions": ["الأسئلة الفرعية الحقيقية التي يجب حسمها للإجابة إجابة صحيحة، من 2 إلى 4"], '
    '"search_queries": ["عبارات بحث محددة تحتاج بيانات حية أو حديثة، فارغة تماماً إن كان السؤال لا يحتاج بحثاً"]}}\n\n'
    "لا تضع عبارات بحث إلا إذا كانت الإجابة تتوقف فعلاً على معلومة حديثة أو خارجية.\n\n"
    "السؤال:\n{message}"
)

_DRAFT_PROMPT = (
    "اكتب إجابة أولية دقيقة على السؤال التالي، معتمداً على الأسئلة الفرعية والأدلة أدناه. "
    "كن محدداً وصادقاً: إن كان هناك ما لا تعرفه أو لا تدعمه الأدلة، قل ذلك صراحة بدل تخمينه.\n\n"
    "السؤال:\n{message}\n\n"
    "الأسئلة الفرعية التي يجب حسمها:\n{sub_questions}\n\n"
    "الأدلة المتوفرة:\n{evidence}"
)

_CRITIQUE_PROMPT = (
    "أنت مراجع ناقد صارم. أمامك سؤال وإجابة أولية عليه. مهمتك إيجاد ما هو خاطئ أو ناقص "
    "أو غير مدعوم بالأدلة في هذه الإجابة — لا تمدحها ولا تعيد صياغتها.\n\n"
    "أجب حصراً بصيغة JSON صحيحة بلا أي نص إضافي:\n"
    '{{"problems": ["مشكلات حقيقية محددة في الإجابة، فارغة تماماً إن كانت الإجابة سليمة فعلاً"], '
    '"missing": ["ما كان يجب ذكره ولم يُذكر، فارغة إن لا شيء"]}}\n\n'
    "السؤال:\n{message}\n\nالإجابة الأولية:\n{draft}\n\nالأدلة المتوفرة:\n{evidence}"
)


def should_deep_think(message: str, query_type: str) -> bool:
    """See _DEPTH_MARKERS above for why this is heuristic on purpose.

    Marker check deliberately runs BEFORE the length floor: real testing
    showed "حلّل هذا الوضع" and "كيف أبني تطبيق؟" — both unmistakable
    requests for real thinking — were being skipped purely for being
    short. Length is a useful signal for messages that say nothing
    explicit; it must not override one that does. The small floor below
    still keeps a bare follow-up like "لماذا؟" out, since a fragment
    that short carries no question to decompose."""
    text = (message or "").strip()
    if len(text) < 12:
        return False
    if _DEPTH_MARKERS.search(text):
        return True
    if len(text) >= _MIN_LENGTH_FOR_DEPTH:
        return True
    if query_type == "CODE" and ("```" in text or "traceback" in text.lower()):
        return True
    if len(text) < 40:
        return False
    return text.count("?") + text.count("؟") >= 2


def _parse_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def _string_list(value, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out = [str(item).strip() for item in value if str(item or "").strip()]
    return out[:limit]


def _gather_evidence(search_queries: list[str]) -> tuple[str, int]:
    """Real live lookups — returns (rendered_text, source_count). Search
    failure is normal here (rag.web_search's own backends can all be
    blocked or rate-limited) and is never fatal: an empty evidence block
    just means the draft and critique steps work from reasoning alone."""
    lines, count = [], 0
    for query in search_queries:
        try:
            results = rag.web_search(query, max_results=_MAX_RESULTS_PER_QUERY)
        except Exception:
            logger.info("deep_think: web search failed for %r — continuing without it", query)
            continue
        for result in results:
            title = str(result.get("title") or "").strip()
            body = str(result.get("body") or "").strip()
            if not title and not body:
                continue
            lines.append(f"- {title}: {body}")
            count += 1
    return ("\n".join(lines) if lines else "(لا توجد أدلة حية متاحة الآن)"), count


def deep_answer(message: str, context: str, query_type: str = "GENERAL", is_owner: bool = False) -> tuple[str, str] | None:
    """Returns (final_answer, trace) or None when deep thinking could
    not run at all — None means "use the normal pipeline", never an
    error the user should see."""
    raw_plan = council.call_groq(_PLAN_PROMPT.format(message=message), "")
    plan = _parse_json(raw_plan or "")
    sub_questions = _string_list(plan.get("sub_questions"), 4)
    if not sub_questions:
        logger.info("deep_think: no usable plan produced — falling back to the normal single-pass pipeline")
        return None

    search_queries = _string_list(plan.get("search_queries"), _MAX_SEARCH_QUERIES)
    evidence, evidence_count = _gather_evidence(search_queries)
    sub_questions_text = "\n".join(f"- {q}" for q in sub_questions)

    draft = council.call_groq(
        _DRAFT_PROMPT.format(message=message, sub_questions=sub_questions_text, evidence=evidence), ""
    )
    if not draft or not draft.strip():
        logger.info("deep_think: draft step produced nothing — falling back to the normal pipeline")
        return None

    critique_raw = council.call_groq(
        _CRITIQUE_PROMPT.format(message=message, draft=draft, evidence=evidence), ""
    )
    critique = _parse_json(critique_raw or "")
    problems = _string_list(critique.get("problems"), 4)
    missing = _string_list(critique.get("missing"), 4)

    critique_text = ""
    if problems or missing:
        parts = []
        if problems:
            parts.append("مشكلات يجب تصحيحها في المسودة:\n" + "\n".join(f"- {p}" for p in problems))
        if missing:
            parts.append("نواقص يجب تغطيتها:\n" + "\n".join(f"- {m}" for m in missing))
        critique_text = "\n\n".join(parts)

    enriched_context = "\n\n".join(
        part for part in [
            context,
            f"[تحليل داخلي — الأسئلة الفرعية التي يجب حسمها]\n{sub_questions_text}",
            f"[أدلة حية تم جمعها فعلياً]\n{evidence}",
            f"[مسودة أولية للاسترشاد بها، لا لنسخها]\n{draft.strip()}",
            f"[مراجعة نقدية للمسودة — عالِج هذه النقاط في إجابتك]\n{critique_text}" if critique_text else "",
        ] if part
    )

    # The visible answer — always our own model, exactly as before this
    # module existed. Everything above is material handed to it, not a
    # replacement for it.
    final_answer = council.answer(message, enriched_context, query_type=query_type, is_owner=is_owner)
    if not final_answer or not final_answer.strip():
        return None

    trace = _render_trace(sub_questions, evidence_count, problems, missing)
    logger.info(
        "deep_think: answered with %d sub-questions, %d live sources, %d critique points",
        len(sub_questions), evidence_count, len(problems) + len(missing),
    )
    return final_answer, trace


def _render_trace(sub_questions: list[str], evidence_count: int, problems: list[str], missing: list[str]) -> str:
    """A compact, readable record of the real reasoning — written to be
    useful BOTH as recalled context later and as a training example that
    teaches the model to reason this way itself (see this module's
    docstring). Deliberately not the raw prompts/JSON: training on
    scaffolding noise would teach the noise."""
    lines = ["كيف فكّرتُ في هذا:"]
    for index, question in enumerate(sub_questions, 1):
        lines.append(f"{index}. {question}")
    if evidence_count:
        lines.append(f"ثم بحثتُ حياً وجمعتُ {evidence_count} مصدراً للتحقق بدل الاعتماد على الحفظ.")
    for problem in problems:
        lines.append(f"راجعتُ مسودتي فوجدتُ: {problem}")
    for item in missing:
        lines.append(f"وأضفتُ ما كان ناقصاً: {item}")
    return "\n".join(lines)


def store_trace(message: str, final_answer: str, trace: str) -> None:
    """Feeds real reasoning back into the bank the weekly Kaggle
    fine-tune already trains on. Never raises — this is an enrichment
    step, and a chat answer already delivered to the user must never
    fail because a background write did."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return
    try:
        knowledge_store.store_or_update(
            query=message,
            content=f"{final_answer.strip()}\n\n— {trace}",
            domain="DEEP_REASONING",
            source="deep_think",
            supabase_url=SUPABASE_URL,
            supabase_key=SUPABASE_SERVICE_ROLE_KEY,
            groq_api_key=GROQ_API_KEY,
            groq_model=GROQ_MODEL,
        )
    except Exception:
        logger.exception("deep_think: storing the reasoning trace failed — the answer itself was unaffected")
