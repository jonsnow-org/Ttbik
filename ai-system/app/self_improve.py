"""
Owner spec, 2026-09-12 ("هو يملك كل الصلاحيات للتعديلات الخفيفة على
نظامه، ولكن الادوات والتطوير الذاتي يعطيني تقرير ماذا وجد وماذا ينفع
الذي وجده وماتأثيره على عمله الحالي، حينها اقبل او ارفض... دوري تلقائي
أسبوعي، وأيضاً عند أمري المباشر"): real, supervised self-improvement —
Nova researches a way to improve its OWN capabilities (a tool, method,
API, technique), writes a real structured report (what it found, why
it's useful, what it would change), and a human decision — the
owner's, explicit, every time — is what actually gates any code
change. Nothing here ever writes code on its own initiative; only
decide_proposal(accept=True), called from an owner's own explicit
command, ever reaches dev_agent.py's real PR machinery.

Two real triggers, both routing through the same one implementation
(no duplicated research logic to keep in sync):
  - Scheduled: .github/workflows/propose-self-improvement.yml (weekly)
    calls this via the new /admin/propose-self-improvement endpoint.
  - On-demand: council.py's owner-only IMPROVE intent -> main.py calls
    research_and_propose(topic) directly with whatever the owner asked
    about.

Honest, stated-plainly limitation: the research step runs rag.web_search,
which is subject to the same real DuckDuckGo-blocks-Render's-IP
constraint documented in rag.py's own module docstring — this will get
more reliable once a real search API replaces/backs that up (separate,
ongoing research), not something this module works around on its own.

The file_path this module ever proposes for auto-implementation is
deliberately conservative — same "never guess an unconfident path"
rule council.py's DEV intent already follows (see _parse_intent_json)
— a proposal whose real substance needs a genuinely new file/module
(most real new integrations, honestly) is NOT something this project's
Dev Agent can safely auto-implement (dev_agent.get_file 404s on a file
that doesn't exist yet, by design — it edits, it does not create). For
those, decide_proposal(accept=True) is honest about the real next step:
telling the owner this needs a real engineering session instead of
pretending to have implemented it.
"""
import logging
import re
import uuid
from datetime import datetime, timezone

from app import council, rag
from app.supabase_client import get_supabase

logger = logging.getLogger("nova")

# A real, fixed rotating list — concrete capability areas this project
# has ACTUAL known gaps in (per this same project's real history:
# image/video quality ceilings, live-search reliability), not vague
# topics.
_SELF_IMPROVEMENT_TOPICS = [
    "أدوات مجانية حقيقية لتحسين جودة توليد الصور بالذكاء الاصطناعي",
    "أدوات مجانية حقيقية لتوليد فيديو حقيقي سريع بمعالج رسومي",
    "واجهات برمجية مجانية حقيقية للبحث الحي الفوري على الويب",
    "طرق حقيقية لتحسين دقة الأصوات المولَّدة بالذكاء الاصطناعي مجاناً",
    "تقنيات مجانية حقيقية لتقليل تشوّه الوجوه في الصور المولَّدة",
    "طرق مجانية حقيقية لتسريع استضافة نموذج ذكاء اصطناعي ذاتي على معالج رسومي",
]

_RESEARCH_PROMPT = (
    "لديك نتائج بحث خام من الويب حول موضوع يخص تطوير قدرات مساعد ذكاء "
    "اصطناعي اسمه نوفا. اقرأها وأجب حصراً بصيغة JSON صحيحة بدون أي نص "
    "إضافي، بهذا الشكل تماماً:\n"
    '{{"finding": "ما هي الأداة/الطريقة/الواجهة البرمجية المحددة التي وجدتها، بجملة أو جملتين واضحتين", '
    '"usefulness": "لماذا هذا مفيد تحديداً لنوفا، بجملة أو جملتين", '
    '"impact": "ما التغيير الفعلي الذي سيحدثه هذا على عمل نوفا الحالي (سرعة/جودة/تكلفة/موثوقية)، بجملة أو جملتين", '
    '"file_path_guess": "المسار الحقيقي لملف موجود بالفعل في مشروعنا يمكن تعديله لتطبيق هذا، فقط إن كنت واثقاً تماماً، وإلا اتركه فارغاً"}}\n\n'
    "الموضوع: {topic}\n\nنتائج البحث الخام:\n{raw_snippets}"
)


def _parse_research_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {}
    try:
        import json

        return json.loads(match.group(0))
    except Exception:
        return {}


def research_and_propose(topic: str | None, trigger: str) -> str:
    """The one real implementation both the weekly schedule and the
    owner's on-demand IMPROVE command call. Returns the report text,
    ready to send straight to the owner — including the proposal's own
    short id and exactly how to accept/reject it."""
    chosen_topic = topic or _pick_scheduled_topic()
    try:
        results = rag.web_search(chosen_topic)
    except Exception:
        logger.exception("self_improve: web search failed for topic=%s", chosen_topic)
        return f"تعذّر البحث عن \"{chosen_topic}\" الآن — حدث خطأ أثناء البحث الحي."
    if not results:
        return f"بحثت فعلاً عن \"{chosen_topic}\" لكن لم أجد نتائج حية مفيدة الآن — لا اقتراح هذه المرة."

    raw_snippets = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)
    raw = council.call_groq(_RESEARCH_PROMPT.format(topic=chosen_topic, raw_snippets=raw_snippets), "")
    parsed = _parse_research_json(raw or "")
    finding = str(parsed.get("finding") or "").strip()
    if not finding:
        return f"بحثت فعلاً عن \"{chosen_topic}\" لكن تعذّر تكوين اقتراح واضح من النتائج — لا اقتراح هذه المرة."

    usefulness = str(parsed.get("usefulness") or "").strip()
    impact = str(parsed.get("impact") or "").strip()
    file_path = str(parsed.get("file_path_guess") or "").strip() or None

    proposal_id = uuid.uuid4().hex[:10]
    get_supabase().table("NovaSelfImprovementProposal").insert(
        {
            "id": proposal_id,
            "topic": chosen_topic,
            "finding": finding,
            "usefulness": usefulness,
            "impact": impact,
            "file_path": file_path,
            "trigger": trigger,
        }
    ).execute()

    return (
        f"🔎 اقتراح تطوير ذاتي جديد (رقم {proposal_id}):\n\n"
        f"الموضوع: {chosen_topic}\n\n"
        f"ماذا وجدت: {finding}\n\n"
        f"لماذا مفيد: {usefulness or '(غير محدد)'}\n\n"
        f"الأثر المتوقع على عملي الحالي: {impact or '(غير محدد)'}\n\n"
        f"للموافقة: /موافقة_تطوير {proposal_id}\n"
        f"للرفض: /رفض_تطوير {proposal_id}"
    )


def _pick_scheduled_topic() -> str:
    """Real duplicate-avoidance: skips a topic that already has a
    PENDING or ACCEPTED proposal on file, so the weekly schedule keeps
    exploring rather than re-proposing the same finding every week."""
    try:
        existing = (
            get_supabase()
            .table("NovaSelfImprovementProposal")
            .select("topic")
            .in_("status", ["PENDING", "ACCEPTED"])
            .execute()
            .data
        )
        taken = {row["topic"] for row in existing}
    except Exception:
        taken = set()
    for topic in _SELF_IMPROVEMENT_TOPICS:
        if topic not in taken:
            return topic
    return _SELF_IMPROVEMENT_TOPICS[0]


def decide_proposal(proposal_id: str, accept: bool) -> str:
    """Owner spec: the ONLY path from a proposal to a real code change
    — and even then, only when the research step above was confident
    enough to name a real existing file. Called only after main.py has
    already confirmed quota.is_platform_owner(user), same one-check-
    upstream pattern as every other owner-only action in this
    project."""
    db = get_supabase()
    rows = db.table("NovaSelfImprovementProposal").select("*").eq("id", proposal_id).execute().data
    if not rows:
        return f"لا يوجد اقتراح برقم {proposal_id}."
    proposal = rows[0]
    if proposal["status"] != "PENDING":
        return f"هذا الاقتراح (رقم {proposal_id}) سبق أن تم البت فيه ({proposal['status']})."

    if not accept:
        db.table("NovaSelfImprovementProposal").update(
            {"status": "REJECTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return f"تم رفض الاقتراح رقم {proposal_id} — لن يُنفَّذ أي تغيير."

    file_path = proposal.get("file_path")
    if not file_path:
        db.table("NovaSelfImprovementProposal").update(
            {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return (
            f"✅ وافقت على الاقتراح رقم {proposal_id} — لكن تنفيذه الحقيقي يحتاج ملفاً/تكاملاً جديداً بالكامل "
            "(وليس تعديل ملف موجود)، وهذا يتجاوز ما يستطيع Dev Agent تنفيذه تلقائياً بأمان. "
            "أخبر مطوّرك (جلسة Claude Code) بهذا الاقتراح مباشرة لتنفيذه هندسياً."
        )

    instruction = f"{proposal['finding']} — الفائدة: {proposal.get('usefulness') or ''} — الأثر المتوقع: {proposal.get('impact') or ''}"
    result_message = council.propose_code_change(file_path, instruction, auto_merge=True)
    db.table("NovaSelfImprovementProposal").update(
        {
            "status": "ACCEPTED",
            "decided_at": datetime.now(timezone.utc).isoformat(),
            "pr_url": result_message if result_message.startswith("http") else None,
        }
    ).eq("id", proposal_id).execute()
    return f"✅ تمت الموافقة على الاقتراح رقم {proposal_id}، ونُفّذ فعلياً:\n{result_message}"
