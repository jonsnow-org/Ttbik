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
branch-only/PR-only, never a direct live write).

Owner follow-up, 2026-09-12 ("بدلا من ان اذهب لكاكلي واعطيه وزن
وادربه، اعطيه لنوفا مباشرة فاما هو من قوم برفعه لكاكلي او هو يقوم
بدمجه بنفسه مباشرة كوزن وتدريب وليس كرود برومبت نصي لتعديل الاوامر
والاستجابة"): propose_training_notebook_change is the real answer —
Nova cannot itself run/train anything (no GPU, no subprocess/execute
capability on Render, by permanent design — see dev_agent.py's module
docstring), but the training notebooks
(ai-system/colab/merge_and_finetune.ipynb and the other two below) are
ALREADY wired to a real Kaggle GPU run the moment they change on the
project's base branch: .github/workflows/deploy-kaggle-notebook.yml
(and its two siblings) fire on `push` to that exact path and run
`kaggle kernels push`, which Kaggle itself documents as triggering a
real execution on its own GPU immediately. So the one missing piece
was never "can Nova execute code" — it's "can Nova get the owner's
EXACT training code into that file without an LLM silently rewriting
it, then merge it once the owner explicitly says so." This function
does that: extracts the owner's code verbatim from ``` fences in their
raw message (never re-synthesized by any model — a model asked to
"copy this exactly" into a JSON field cannot be trusted with
whitespace-sensitive Python), does a real deterministic
`ast.parse()` syntax check (not an LLM opinion), and — if that passes
— appends it as a new notebook cell via plain JSON manipulation, never
rewriting the rest of the notebook. It NEVER auto-merges (unlike the
generic DEV/self-improvement flows): merging this specific kind of PR
immediately burns real, scarce Kaggle GPU quota (the owner's own
30h/week budget), so it always waits for one more explicit owner
confirmation first, via the exact same natural-language ACCEPT/REJECT
path as any other proposal (decide_proposal below, status
"AWAITING_MERGE")."""
import ast
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from app import council, dev_agent, rag
from app.supabase_client import get_supabase

logger = logging.getLogger("nova")

# The only three files a real Kaggle GPU run is ever automatically
# triggered from (see the three .github/workflows/deploy-kaggle-*.yml
# files' own `on: push: paths:` — each watches exactly one of these).
# A change proposed to any of these is real training-pipeline code, not
# app/chat behavior, so it gets the extra "hold for explicit merge"
# safety this module adds instead of the generic DEV flow's immediate
# auto-merge.
TRAINING_NOTEBOOK_PATHS = {
    "ai-system/colab/merge_and_finetune.ipynb",
    "ai-system/colab/process_video_queue.ipynb",
    "ai-system/colab/generate_image_model.ipynb",
}

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
    research_prompt = _RESEARCH_PROMPT.format(topic=chosen_topic, raw_snippets=raw_snippets)

    # Owner report, 2026-09-13 (real evidence: asked Nova to research a
    # skill and got Groq's generic, off-topic paragraph back, "كالببغاء
    # يكررها"): this used to call Groq exclusively for the actual
    # reading/understanding of the research — a live-user-facing report
    # is exactly the kind of visible content this project's own rule
    # says must come from OUR OWN model, Groq only as the fallback when
    # ours is unavailable. council.analyze_knowledge got the identical
    # fix the same day, for the identical reason.
    raw = council.call_modelscope_specialist(research_prompt, "", query_type="GENERAL")
    parsed = _parse_research_json(raw or "")
    if not str(parsed.get("finding") or "").strip():
        raw = council.call_groq(research_prompt, "")
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


def propose_training_notebook_change(file_path: str, raw_message: str, trigger: str) -> str:
    """See this module's own docstring for the full reasoning. Extracts
    the owner's code VERBATIM from ``` fences in their raw message
    (never through any model), syntax-checks it for real, appends it as
    a new notebook cell via plain JSON editing (never an LLM rewrite of
    the rest of the file), opens a PR, and — critically — never
    auto-merges: merging this exact file triggers a real Kaggle GPU
    training run automatically (see TRAINING_NOTEBOOK_PATHS above), so
    it always waits for one more explicit owner confirmation first."""
    if file_path not in TRAINING_NOTEBOOK_PATHS:
        return f"{file_path} ليس أحد دفاتر التدريب الحقيقية المعروفة — لا يمكن تنفيذ هذا عبر هذا المسار."

    blocks = re.findall(r"```(?:[a-zA-Z]*\n)?(.*?)```", raw_message, re.DOTALL)
    code = "\n\n".join(b.strip("\n") for b in blocks).strip()
    if not code:
        return (
            "لم أجد كتلة كود صريحة بين علامات ``` في رسالتك — أرسل الكود "
            "نفسه داخل علامات ``` حتى أُدرجه بدقة تامة دون أي إعادة صياغة "
            "مني (أي إعادة صياغة قد تغيّر الكود الفعلي، وهذا غير مقبول "
            "لكود تدريب حقيقي)."
        )

    try:
        ast.parse(code)
    except SyntaxError as e:
        return (
            f"فحصت الكود قبل أي شيء آخر ووجدت خطأ نحوي حقيقي فيه، لذا لم أُقدم على أي "
            f"تعديل: {e.msg} (السطر {e.lineno}). صحّح الكود وأرسله مرة أخرى."
        )

    try:
        current_content, sha = dev_agent.get_file(file_path)
    except dev_agent.DevAgentError as e:
        return str(e)

    try:
        notebook = json.loads(current_content)
    except Exception:
        return f"تعذّرت قراءة {file_path} كدفتر Jupyter صالح (JSON) — لم أُقدم على أي تعديل."

    notebook.setdefault("cells", []).append(
        {
            "cell_type": "code",
            "metadata": {},
            "execution_count": None,
            "outputs": [],
            "source": code.splitlines(keepends=True),
        }
    )
    new_content = json.dumps(notebook, ensure_ascii=False, indent=1)

    branch_name = f"nova-train-code/{uuid.uuid4().hex[:10]}"
    try:
        dev_agent.create_branch(branch_name)
        dev_agent.update_file(
            file_path, branch_name, new_content, sha,
            commit_message="Nova: insert owner-provided training code (verbatim, new cell)",
        )
        pr_url, _pr_number = dev_agent.open_pull_request(
            branch_name,
            title=f"Nova: كود تدريب من المالك مباشرة — {file_path}",
            body=(
                "كود قدّمه المالك مباشرة عبر المحادثة، أُدرج حرفياً كخلية جديدة في "
                f"`{file_path}` (فحص نحوي حقيقي ناجح، بلا أي إعادة صياغة).\n\n"
                "**لم يُدمج تلقائياً** — دمج هذا الـPR سيُشغّل تدريباً حقيقياً على "
                "معالج Kaggle الرسومي فوراً (يستهلك من حصة الساعات الأسبوعية)، لذا "
                "ينتظر تأكيداً صريحاً إضافياً من المالك."
            ),
        )
    except dev_agent.DevAgentError as e:
        return str(e)

    proposal_id = uuid.uuid4().hex[:10]
    get_supabase().table("NovaSelfImprovementProposal").insert(
        {
            "id": proposal_id,
            "topic": "كود تدريب مُقدَّم من المالك مباشرة",
            "finding": code[:300],
            "file_path": file_path,
            "status": "AWAITING_MERGE",
            "trigger": trigger,
            "pr_url": pr_url,
        }
    ).execute()

    return (
        f"✅ فحصت الكود نحوياً وهو سليم، وأدرجته حرفياً (كما هو تماماً، بلا أي إعادة "
        f"صياغة) كخلية جديدة في {file_path}، على طلب Pull Request:\n{pr_url}\n\n"
        f"⚠️ لم أدمجه بعد عمداً: دمجه سيُشغّل تدريباً حقيقياً على Kaggle فوراً "
        "ويستهلك من حصتك الأسبوعية (30 ساعة). راجع الـPR، وحين تكون مستعداً قل لي "
        f"مثلاً \"وافق على الاقتراح رقم {proposal_id}\" لأدمجه فعلياً ويبدأ التدريب "
        f"الحقيقي، أو \"ارفض الاقتراح رقم {proposal_id}\" لإلغائه دون دمج."
    )


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
    if proposal["status"] not in ("PENDING", "AWAITING_MERGE"):
        return f"هذا الاقتراح (رقم {proposal_id}) سبق أن تم البت فيه ({proposal['status']})."

    if proposal["status"] == "AWAITING_MERGE":
        # propose_training_notebook_change already opened the real PR —
        # this is purely "merge it now or don't", never a fresh code
        # generation step, and never auto-reached: only a proposal
        # created by that function ever has this status.
        if not accept:
            db.table("NovaSelfImprovementProposal").update(
                {"status": "REJECTED", "decided_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", proposal_id).execute()
            return (
                f"تم رفض الاقتراح رقم {proposal_id} — لن أدمجه، ولن يبدأ أي تدريب. "
                "الـPull Request يبقى مفتوحاً دون دمج على GitHub إن أردت مراجعته أو حذفه يدوياً."
            )
        match = re.search(r"/pull/(\d+)", proposal.get("pr_url") or "")
        if not match:
            return f"لا أجد رقم الـPull Request المرتبط بالاقتراح رقم {proposal_id} — لا يمكن الدمج."
        try:
            dev_agent.merge_pull_request(int(match.group(1)))
        except dev_agent.DevAgentError as e:
            return f"تعذّر الدمج: {e} — الـPR ما زال مفتوحاً للمراجعة اليدوية."
        db.table("NovaSelfImprovementProposal").update(
            {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return (
            f"✅ تم دمج الاقتراح رقم {proposal_id} فعلياً — سيبدأ تدريب حقيقي على "
            "معالج Kaggle الرسومي تلقائياً (نفس آلية push الموجودة أصلاً)، وستصلك رسالة "
            "تلخيصية عند انتهاء التدريب كالمعتاد."
        )

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

    cleaned = council._strip_code_fences(new_content)

    # Same real gate as the Dev Agent's own path (council.propose_code_change)
    # — a brand-new file invented from scratch is if anything MORE likely to
    # be malformed than an edit to an existing one, so it gets the identical
    # deterministic check plus one repair round, and is never shipped broken.
    cleaned, advisory, failure = council.validate_or_repair(file_path, cleaned, proposal["finding"])
    if failure:
        return failure

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
                + (f"\n\n⚠️ {advisory}" if advisory else "")
            ),
        )
        dev_agent.merge_pull_request(pr_number)
    except dev_agent.DevAgentError as e:
        return f"تعذّر تنفيذ الاقتراح رقم {proposal_id}: {e}"

    db.table("NovaSelfImprovementProposal").update(
        {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat(), "pr_url": pr_url}
    ).eq("id", proposal_id).execute()
    return f"✅ تم إنشاء الملف الجديد ودمجه تلقائياً:\n{pr_url}"
