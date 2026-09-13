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

from app import agent_loop, council, dev_agent, rag
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


def _proposal_id_line(proposal_id: str) -> str:
    """Owner report, 2026-09-13 (real evidence, screenshot: "/تحليل_تطوير
    bc3b5d68dd" — "هكذا لا تُنسخ بسهولة"): the id used to sit on the
    same line as Arabic prose (and, before that fix, a slash command),
    a real, well-known mobile issue — mixed RTL Arabic + LTR
    alphanumeric text on one line makes double-tap/long-press
    selection unreliable on many keyboards. Its own line, with nothing
    else on it, is a plain, homogeneous LTR run — reliably
    tap-to-select on any phone."""
    return f"رقم الاقتراح:\n{proposal_id}"


_RESEARCH_PROMPT = (
    "لديك نتائج بحث خام من الويب حول موضوع يخص تطوير قدرات مساعد ذكاء "
    "اصطناعي اسمه نوفا. اقرأها، وقرر أولاً وبصدق: هل ما وجدته هو "
    "(CODE) أداة/طريقة/واجهة برمجية حقيقية تحتاج كتابة كود جديد ليعمل "
    "بها نوفا، أم (KNOWLEDGE) مجرد معرفة/حقائق/مرجع يجب أن يتعلمه نوفا "
    "نفسه ويصبح جزءاً من فهمه (كقواعد لغة، معلومات تاريخية أو علمية، "
    "أو أي مرجع نصي) — لا حاجة لأي كود لهذا النوع، بل يُحفظ في بنك "
    "معرفة نوفا ليُدرَّب عليه فعلياً في التدريب الأسبوعي القادم. "
    "لا تختر CODE لمجرد أن المصدر تقني — اختر KNOWLEDGE كلما كان "
    "المحتوى نفسه معرفة يجب أن يفهمها نوفا، لا أداة يجب أن يبنيها. "
    "أجب حصراً بصيغة JSON صحيحة بدون أي نص إضافي، بهذا الشكل تماماً:\n"
    '{{"kind": "CODE أو KNOWLEDGE", '
    '"finding": "ما هي الأداة/المعرفة المحددة التي وجدتها، بجملة أو جملتين واضحتين", '
    '"usefulness": "لماذا هذا مفيد تحديداً لنوفا، بجملة أو جملتين", '
    '"impact": "ما التغيير الفعلي الذي سيحدثه هذا على عمل نوفا الحالي (سرعة/جودة/تكلفة/موثوقية/معرفة)، بجملة أو جملتين", '
    '"file_path_guess": "فقط إن كان kind=CODE: المسار الحقيقي لملف موجود بالفعل في مشروعنا يمكن تعديله لتطبيق هذا، فقط إن كنت واثقاً تماماً، وإلا اتركه فارغاً"}}\n\n'
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
    # Owner report, 2026-09-13 (real evidence: proposal bc3b5d68dd —
    # Arabic grammar rules, pure reference knowledge — got "implemented"
    # as an unused static Python module instead of actually being
    # learned): every proposal used to be treated as CODE by default.
    # kind lets decide_proposal route a KNOWLEDGE finding into the real
    # training pipeline (rag.store_verified_finding) instead of always
    # generating a file nothing ever calls.
    kind = str(parsed.get("kind") or "").strip().upper()
    if kind not in ("CODE", "KNOWLEDGE"):
        kind = "CODE"
    if kind == "KNOWLEDGE":
        file_path = None  # never relevant for a pure-knowledge proposal

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
            "kind": kind,
        }
    ).execute()

    kind_label = "معرفة يتعلمها نوفا نفسه — لا كود" if kind == "KNOWLEDGE" else "كود جديد"
    accept_hint = (
        "الموافقة ستُخزّن هذا فعلياً في بنك معرفتي ليُستخدم في التدريب الأسبوعي "
        "القادم على Kaggle — تعلّم حقيقي، لا مجرد ملف محفوظ."
        if kind == "KNOWLEDGE"
        else "الموافقة تبدأ خطوات تنفيذه كتعديل/ملف كود حقيقي."
    )
    return (
        f"🔎 اقتراح تطوير ذاتي جديد ({kind_label}):\n\n"
        f"{_proposal_id_line(proposal_id)}\n\n"
        f"الموضوع: {chosen_topic}\n\n"
        f"ماذا وجدت: {finding}\n\n"
        f"لماذا مفيد: {usefulness or '(غير محدد)'}\n\n"
        f"الأثر المتوقع على عملي الحالي: {impact or '(غير محدد)'}\n\n"
        f"{accept_hint}\n\n"
        "قل لي بكلامك العادي: وافق على هذا الاقتراح، أو: ارفض هذا الاقتراح — "
        "وسأفهم أيهما تقصد من رقمه أعلاه."
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
        return f"هذا الاقتراح سبق أن تم البت فيه ({proposal['status']}).\n\n{_proposal_id_line(proposal_id)}"

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
                f"تم رفض الاقتراح — لن أدمجه، ولن يبدأ أي تدريب. الـPull Request يبقى مفتوحاً دون دمج على "
                f"GitHub إن أردت مراجعته أو حذفه يدوياً.\n\n{_proposal_id_line(proposal_id)}"
            )
        match = re.search(r"/pull/(\d+)", proposal.get("pr_url") or "")
        if not match:
            return f"لا أجد رقم الـPull Request المرتبط بهذا الاقتراح — لا يمكن الدمج.\n\n{_proposal_id_line(proposal_id)}"
        try:
            dev_agent.merge_pull_request(int(match.group(1)))
        except dev_agent.DevAgentError as e:
            return f"تعذّر الدمج: {e} — الـPR ما زال مفتوحاً للمراجعة اليدوية."
        db.table("NovaSelfImprovementProposal").update(
            {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return (
            "✅ تم الدمج فعلياً — سيبدأ تدريب حقيقي على معالج Kaggle الرسومي تلقائياً (نفس آلية push "
            f"الموجودة أصلاً)، وستصلك رسالة تلخيصية عند انتهاء التدريب كالمعتاد.\n\n{_proposal_id_line(proposal_id)}"
        )

    if not accept:
        db.table("NovaSelfImprovementProposal").update(
            {"status": "REJECTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return f"تم رفض الاقتراح.\n\n{_proposal_id_line(proposal_id)}\n\nلن يُنفَّذ أي تغيير."

    # Owner spec, 2026-09-13 ("نريد نجاحه في التدريب على المهمة واكتساب
    # خبرة ومعرفة وليس مجرد ملف وحفظ"): a KNOWLEDGE-kind proposal is
    # itself a body of reference material Nova should learn, not a
    # capability that needs code — accepting it stores it directly in
    # the real training pipeline (rag.store_verified_finding), never
    # touching propose_code_change/file_path at all. This is the actual
    # fix for proposal bc3b5d68dd's real failure mode: an Arabic-grammar
    # finding became an unused static Python module instead of real
    # trainable knowledge.
    if proposal.get("kind") == "KNOWLEDGE":
        content = proposal["finding"]
        if proposal.get("usefulness"):
            content += f"\nلماذا مفيد: {proposal['usefulness']}"
        store_message = rag.store_verified_finding(proposal["topic"], content)
        db.table("NovaSelfImprovementProposal").update(
            {"status": "ACCEPTED", "decided_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", proposal_id).execute()
        return f"{store_message}\n\n{_proposal_id_line(proposal_id)}"

    file_path = proposal.get("file_path")
    if not file_path:
        return (
            "هذا الاقتراح يحتاج إنشاء ملف جديد بالكامل، وليس تعديل ملف موجود — لم أنفّذ شيئاً بعد. "
            "قل لي: حلّل قدرتك على تنفيذ هذا الاقتراح، وسأخبرك بصدق هل أستطيع تنفيذه بلا أخطاء، ثم قرر "
            f"بنفسك بناءً على تحليلي.\n\n{_proposal_id_line(proposal_id)}"
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
    return f"✅ تمت الموافقة، ونُفّذ فعلياً:\n{result_message}\n\n{_proposal_id_line(proposal_id)}"


_FEASIBILITY_PROMPT = (
    "قيّم قدرتك الحقيقية على تنفيذ اقتراح تطوير ذاتي بصدق تام، بلا مبالغة ولا تهوين — الصدق هنا أهم من "
    "إعطاء إجابة إيجابية. الاقتراح يحتاج إنشاء ملف كود جديد بالكامل في مشروعنا (وليس تعديل ملف موجود). "
    "حلّل: هل تستطيع فعلاً تصميم وكتابة هذا الملف بشكل صحيح وقابل للتشغيل بلا أخطاء؟ استخدم الأدوات "
    "المتاحة لك لترى البنية الحقيقية الفعلية لمشروعنا قبل أن تقترح مساراً — لا تخترع اسم مجلد أو اصطلاح "
    "تسمية لم تتحقق من وجوده فعلاً (مثلاً: تأكد هل اسم المجلد الرئيسي \"ai-system\" بشرطة أم بشكل آخر، "
    "بدل افتراض الشائع في بايثون).\n\n"
    "عندما تصل لقرار نهائي، أنهِ بـ finish يحتوي بصيغة JSON صحيحة بدون أي نص إضافي:\n"
    '{{"can_implement": true أو false, '
    '"reasoning": "شرح صادق وواضح لماذا تستطيع أو لا تستطيع، بجملتين أو ثلاث", '
    '"proposed_file_path": "المسار المقترح للملف الجديد، منسجماً فعلاً مع ما رأيته من البنية الحقيقية، فقط إن can_implement=true وإلا فارغ", '
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

    # Owner report, 2026-09-13 ("لاحظت انك كل عملك هو اعطاء اوامر
    # لنوفا وليس جعله هو يعرف ويفكر ويقرأ وينفذ... لماذا هو لايملك ذات
    # القدرة والمعرفة" — and separately, the real incident this closes:
    # "ان لم يتمتع بالقدرة على قراءة المستودع... فكيف سيتمكن من
    # العمل!!"): this used to ALWAYS prefetch the whole real repo tree
    # myself and cram it into one fixed prompt, whether or not it was
    # even needed for this proposal — Nova never decided to go look at
    # anything, I decided for it. Now it runs a real agent_loop: Nova
    # gets real tools (list real files, read a real file's content) and
    # decides itself whether/what to check before answering, seeing the
    # REAL result of each call it makes before deciding the next step —
    # the same "read the real repo tree" fix in principle, but Nova
    # doing the reading and reasoning now, not me doing it for it.
    def _list_files_tool(args: dict) -> str:
        prefix = str(args.get("prefix") or "ai-system/")
        try:
            paths = dev_agent.get_repo_tree(prefix=prefix)
        except dev_agent.DevAgentError as e:
            return f"تعذّرت القراءة: {e}"
        return "\n".join(sorted(paths)[:200]) if paths else "(لا ملفات بهذا المسار)"

    def _read_file_tool(args: dict) -> str:
        path = str(args.get("path") or "").strip()
        if not path:
            return "يجب تحديد path حقيقي."
        try:
            content, _sha = dev_agent.get_file(path)
        except dev_agent.DevAgentError as e:
            return f"تعذّرت القراءة: {e}"
        return content[:3000]

    agent_tools = [
        agent_loop.Tool(
            "list_files",
            'يسرد المسارات الحقيقية الموجودة فعلاً تحت بادئة معينة الآن في مستودعنا. args: {"prefix": "ai-system/"}',
            _list_files_tool,
        ),
        agent_loop.Tool(
            "read_file",
            'يقرأ المحتوى الفعلي الحالي لملف حقيقي موجود. args: {"path": "ai-system/app/main.py"}',
            _read_file_tool,
        ),
    ]

    task_prompt = _FEASIBILITY_PROMPT.format(
        topic=proposal["topic"],
        finding=proposal["finding"],
        usefulness=proposal.get("usefulness") or "",
        impact=proposal.get("impact") or "",
    )
    result = agent_loop.run_agent_loop(
        task_prompt,
        agent_tools,
        lambda p: council.call_modelscope_specialist(p, "", query_type="CODE") or council.call_groq(p, ""),
        max_steps=5,
        step_timeout=100,
    )
    parsed = _parse_research_json(result.answer or "")
    can_implement = bool(parsed.get("can_implement"))
    reasoning = str(parsed.get("reasoning") or "").strip()
    proposed_path = str(parsed.get("proposed_file_path") or "").strip()
    risks = str(parsed.get("risks") or "").strip()
    if not result.finished:
        reasoning = result.answer  # the honest "couldn't decide within N steps" message

    # Never trust the model's own path claim blindly, even after real
    # tool use — a deterministic check catches it if it still proposes
    # something outside this project's real top-level directory, same
    # "never guess an unconfident path" rule this project already
    # applies elsewhere. One more real, cheap lookup (not the same as
    # the old always-on prefetch: this is a verification of the FINAL
    # answer, not a substitute for Nova's own exploration above).
    try:
        real_paths = dev_agent.get_repo_tree(prefix="ai-system/")
    except dev_agent.DevAgentError:
        real_paths = []
    real_top_level = real_paths[0].split("/")[0] if real_paths else "ai-system"

    # Never trust the model's own path claim blindly, even with the
    # real structure shown above — a deterministic check catches it if
    # it still ignores that context, same "never guess an unconfident
    # path" rule this project already applies elsewhere.
    if can_implement and proposed_path and real_paths and not proposed_path.startswith(f"{real_top_level}/"):
        reasoning = (
            (reasoning + " " if reasoning else "")
            + f"(تصحيح آلي: المسار المقترح ({proposed_path}) لا يطابق البنية الحقيقية للمستودع — كان يجب أن يبدأ بـ{real_top_level}/)"
        )
        can_implement = False
        proposed_path = ""

    if can_implement and proposed_path:
        db.table("NovaSelfImprovementProposal").update({"file_path": proposed_path}).eq("id", proposal_id).execute()

    lines = [
        "🔍 تحليل قدرتي الحقيقية على تنفيذ هذا الاقتراح:",
        "",
        _proposal_id_line(proposal_id),
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
            "إن اقتنعت، قل لي بكلامك العادي: نفّذ هذا الاقتراح.",
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
        return (
            f"لم أحلل قدرتي على تنفيذ هذا الاقتراح بعد. قل لي أولاً: حلّل قدرتك على تنفيذ الاقتراح رقم "
            f"{proposal_id}\n\n{_proposal_id_line(proposal_id)}"
        )

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
