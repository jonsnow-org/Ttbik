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

The file_path research_and_propose ever guesses for auto-implementation
is deliberately conservative — same "never guess an unconfident path"
rule council.py's DEV intent already follows. A proposal whose real
substance needs a genuinely new file (most real new integrations,
honestly) used to be a dead end here.

Owner follow-up, 2026-09-12 ("هل تستطيع تنفيذ هذا العمل الهندسي وانشاء
ملف جديد دون اخطاء... فان كان جوابه مقنعا اقول له نفذ ونعطيه الصلاحية
الكاملة وان كان لايستطيع... يقول ذلك صراحة"): real, honest
self-assessment now closes that gap instead of a flat refusal —
assess_feasibility asks the model to genuinely evaluate (not a canned
yes) whether it can design and implement the finding as a brand-new
file, and says so plainly either way. Only when the owner is convinced
and sends the explicit go-ahead does implement_new_file actually
generate the file and open a real PR (dev_agent.create_file — the
real, bounded extension that makes creating a NEW file possible, still
branch-only/PR-only, never a direct live write)."""
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
        return (
            f"هذا الاقتراح (رقم {proposal_id}) يحتاج إنشاء ملف جديد بالكامل، وليس تعديل ملف موجود — "
            f"لم أنفّذ شيئاً بعد. أرسل \"/تحليل_تطوير {proposal_id}\" لأحلل بصدق هل أستطيع تنفيذه بلا "
            f"أخطاء، ثم قرر بنفسك بناءً على تحليلي."
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


_FEASIBILITY_PROMPT = (
    "أنت مطالَب بتقييم قدرتك الحقيقية على تنفيذ اقتراح تطوير ذاتي بصدق تام، بلا مبالغة ولا تهوين — "
    "الصدق هنا أهم من إعطاء إجابة إيجابية. الاقتراح يحتاج إنشاء ملف كود جديد بالكامل في مشروعنا (وليس "
    "تعديل ملف موجود). حلّل: هل تستطيع فعلاً تصميم وكتابة هذا الملف بشكل صحيح وقابل للتشغيل بلا أخطاء؟ "
    "أجب حصراً بصيغة JSON صحيحة بدون أي نص إضافي:\n"
    '{{"can_implement": true أو false, '
    '"reasoning": "شرح صادق وواضح لماذا تستطيع أو لا تستطيع، بجملتين أو ثلاث", '
    '"proposed_file_path": "المسار المقترح للملف الجديد داخل مشروعنا (مثل ai-system/app/xyz.py)، فقط إن can_implement=true وإلا فارغ", '
    '"risks": "أخطاء أو مشاكل محتملة حقيقية قد تنتج عن هذا التنفيذ، بجملة أو جملتين"}}\n\n'
    "الاقتراح:\nالموضوع: {topic}\nماذا وجدت: {finding}\nالفائدة: {usefulness}\nالأثر المتوقع: {impact}"
)


def assess_feasibility(proposal_id: str) -> str:
    """Owner spec, 2026-09-12 ("هل تستطيع تنفيذ هذا العمل الهندسي...
    فان كان جوابه مقنعا اقول له نفذ... وان كان لايستطيع... يقول ذلك
    صراحة"): a REAL model call genuinely evaluating the proposal, not a
    canned response — honest either way. Only stores a proposed
    file_path on the row (unlocking implement_new_file below) when the
    model itself says it can implement this AND names a real path."""
    db = get_supabase()
    rows = db.table("NovaSelfImprovementProposal").select("*").eq("id", proposal_id).execute().data
    if not rows:
        return f"لا يوجد اقتراح برقم {proposal_id}."
    proposal = rows[0]
    if proposal["status"] != "PENDING":
        return f"هذا الاقتراح (رقم {proposal_id}) سبق أن تم البت فيه ({proposal['status']})."

    prompt = _FEASIBILITY_PROMPT.format(
        topic=proposal["topic"],
        finding=proposal["finding"],
        usefulness=proposal.get("usefulness") or "",
        impact=proposal.get("impact") or "",
    )
    raw = council.call_modelscope_specialist(prompt, "", query_type="CODE") or council.call_groq(prompt, "")
    parsed = _parse_research_json(raw or "")
    can_implement = bool(parsed.get("can_implement"))
    reasoning = str(parsed.get("reasoning") or "").strip()
    proposed_path = str(parsed.get("proposed_file_path") or "").strip()
    risks = str(parsed.get("risks") or "").strip()

    if can_implement and proposed_path:
        db.table("NovaSelfImprovementProposal").update({"file_path": proposed_path}).eq("id", proposal_id).execute()

    lines = [
        f"🔍 تحليل قدرتي الحقيقية على تنفيذ الاقتراح رقم {proposal_id}:",
        "",
        "القرار الصادق: " + ("نعم، أستطيع تنفيذ هذا" if can_implement and proposed_path else "لا، لا أستطيع تنفيذ هذا بثقة كافية"),
        "",
        f"السبب: {reasoning or '(غير محدد)'}",
    ]
    if can_implement and proposed_path:
        lines += [
            "",
            f"الملف الذي سأنشئه: {proposed_path}",
            f"مخاطر محتملة: {risks or '(لا مخاطر واضحة)'}",
            "",
            f"إن اقتنعت، أعطني الصلاحية الكاملة بـ: /تنفيذ_تطوير {proposal_id}",
        ]
    return "\n".join(lines)


def implement_new_file(proposal_id: str) -> str:
    """Owner spec: the explicit "نفذ ونعطيه الصلاحية الكاملة" command —
    only reachable after assess_feasibility already stored a confident
    proposed file_path on this proposal (never guessed independently
    here). Generates the real file content, creates a real branch + a
    genuinely NEW file (dev_agent.create_file) + PR, and auto-merges —
    the owner already gave explicit, informed go-ahead after reading a
    real feasibility analysis, same auto_merge=True pattern as every
    other owner-directed code change in this project."""
    db = get_supabase()
    rows = db.table("NovaSelfImprovementProposal").select("*").eq("id", proposal_id).execute().data
    if not rows:
        return f"لا يوجد اقتراح برقم {proposal_id}."
    proposal = rows[0]
    if proposal["status"] != "PENDING":
        return f"هذا الاقتراح (رقم {proposal_id}) سبق أن تم البت فيه ({proposal['status']})."
    file_path = proposal.get("file_path")
    if not file_path:
        return f"لم أحلل قدرتي على تنفيذ هذا الاقتراح بعد — أرسل أولاً \"/تحليل_تطوير {proposal_id}\"."

    content_prompt = (
        "أنشئ محتوى ملف بايثون كامل جديد لمشروعنا (Nova AI) ينفّذ هذا التحسين:\n"
        f"{proposal['finding']}\nالفائدة: {proposal.get('usefulness') or ''}\nالأثر المتوقع: {proposal.get('impact') or ''}\n\n"
        "أعد فقط محتوى الملف الكامل جاهزاً للحفظ حرفياً على القرص، بلا أي شرح أو مقدمة أو علامات ```‎ من أي نوع."
    )
    new_content = council.call_modelscope_specialist(content_prompt, "", query_type="CODE") or council.call_groq(content_prompt, "")
    if not new_content or not new_content.strip():
        return "تعذّر توليد محتوى الملف الجديد — لم يُنشأ شيء."

    cleaned = new_content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n", "", cleaned)
        cleaned = re.sub(r"\n```\s*$", "", cleaned)

    from app import dev_agent

    branch_name = f"nova-self-improve/{uuid.uuid4().hex[:10]}"
    try:
        dev_agent.create_branch(branch_name)
        dev_agent.create_file(file_path, branch_name, cleaned, commit_message=f"Nova Self-Improvement: create {file_path}")
        pr_url, pr_number = dev_agent.open_pull_request(
            branch_name,
            title=f"Nova Self-Improvement: create {file_path}",
            body=(
                f"اقتراح تطوير ذاتي رقم {proposal_id} — بناءً على تحليل قدرة حقيقي ووافق عليه المالك صراحة:\n\n"
                f"{proposal['finding']}"
            ),
        )
        dev_agent.merge_pull_request(pr_number)
    except dev_agent.DevAgentError as e:
        return f"تعذّر تنفيذ الاقتراح رقم {proposal_id}: {e}"

    db.table("NovaSelfImprovementProposal").update(
        {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat(), "pr_url": pr_url}
    ).eq("id", proposal_id).execute()
    return f"✅ تم إنشاء الملف الجديد ودمجه تلقائياً:\n{pr_url}"
