"""Nova's own work as training rows: what the coder bot really does and where the owner's tests showed it fails.

The mix of phase 1 is code and sandbox traces. Nova's day job is different: research with sources, GitHub projects, agents that report, loading
tool groups, scheduling. In the owner's tests (2026-10-24) it (1) used the whole command sentence as a search query, (2) invented project
names when the search found nothing, (3) announced "I will search now" and stopped, (4) wrote generic reports not tied to its sources.
These rows teach the opposite, in the EXACT conversation shape the bot sends (the real system prompt, the real tool schemas, the real harness
messages, the real deep_research / agent-report formats; see tools/runtime_*). They are synthetic and checked, not scraped:
every claim in a grounded answer is a sentence of a source in the same row, every project named is in the sources, and when the sources do
not cover something the answer says so.

Kinds (the `kind` field): route (first step: load a tool group / delegate / ask / answer), grounded (report from sources), thin (nothing found:
act precisely, then admit it), report (an agent's four-line report), combine (the parent merges agent reports honestly).

    python scripts/make_agent_rows.py --n 1800 --out data/nova_agent.jsonl            # training rows
    python scripts/make_agent_rows.py --eval 40 --out eval/agent_eval.jsonl           # held-out eval cases (other topics, other seed)
    python scripts/make_agent_rows.py --selfcheck                                      # checks every kind; with a tokenizer also lengths
Rows are <= ~2,000 tokens (the Kaggle config trains at 2,048): the full github group (3.3k tokens) never fits, so rows that need it carry
only the first-step tools; report/grounded rows carry no tools (the model writes text there).
"""
import argparse
import json
import random
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
T = HERE / "tools"

HARNESS_OK = ("[harness] The research above was already run for you. Write the final answer / report NOW from these sources (cite them by number, "
              "in the user's language). Use only what the sources say; if they are not enough, say exactly what is missing; at most one more search.")
HARNESS_THIN = ("[harness] The research above found little or nothing. Do NOT invent names or facts. Run at most two precise web_search queries, "
                "then answer only from what they return; if still nothing, say plainly what you could not find.")
DECLINED = "The user declined this action (it was NOT executed). Continue without it or ask what they want."
DENIED = "DENIED by the user's standing policy ({cat}); it was NOT executed. Do not retry it; find another way or explain what is needed."
COMBINE_HEAD = ("Reports of {n} agents. Each covers ONLY that agent's own job. The user's request is yours: combine them, resolve conflicts between "
                "them, say plainly what was NOT DONE, and never present an agent's NOT DONE as done.")

# ---------------------------------------------------------------- topics (training pool A, held-out pool B for eval)
# aspect: (Arabic name, English name, sentence template in Arabic, sentence template in English); {r} = the project name
ASPECTS = {
    "latency": ("التأخر", "latency", "{r} يعالج الطلب في الخلفية ويرسل رسالة «جارٍ المعالجة» فوراً ثم النتيجة، فلا ينتظر المستخدم صامتاً", "{r} processes the request in the background and sends a quick \"working on it\" message first, so the user is never left waiting in silence"),
    "split": ("طول الرسائل", "message length", "{r} يقسّم الرد الطويل إلى أجزاء أقل من 4096 حرفاً ويرسلها بالترتيب", "{r} splits a long reply into chunks under 4096 characters and sends them in order"),
    "drops": ("انقطاع الاتصال", "connection drops", "{r} يعيد المحاولة بتراجع أسّي (backoff) عند فشل الإرسال ويحفظ الطلب حتى ينجح", "{r} retries failed sends with exponential backoff and keeps the request until it succeeds"),
    "stream": ("الرد التدريجي", "streaming", "{r} يرسل الرد بتعديل رسالة واحدة تدريجياً بدل انتظار الرد كاملاً", "{r} streams the reply by editing a single message instead of waiting for the full answer"),
    "webhook": ("الويبهوك", "webhooks", "{r} يستخدم webhook بدل polling فيصله التحديث فور وقوعه", "{r} uses a webhook instead of polling, so updates arrive the moment they happen"),
    "cache": ("التخزين المؤقت", "caching", "{r} يخزّن الإجابات المتكررة مؤقتاً فلا يستدعي النموذج مرتين لنفس السؤال", "{r} caches repeated answers so the model is not called twice for the same question"),
    "rate": ("حدود المعدل", "rate limits", "{r} يضع الطلبات في طابور ويحترم حد الرسائل في الثانية", "{r} queues requests and respects the messages-per-second limit"),
    "memory": ("ذاكرة المحادثة", "conversation memory", "{r} يلخّص المحادثة الطويلة ويحتفظ بالملخص بدل كل الرسائل", "{r} summarises a long conversation and keeps the summary instead of every message"),
}
TOPICS_A = [
    ("بوتات تلجرام بالذكاء الاصطناعي", "telegram ai bots", ["latency", "split", "drops", "stream", "webhook"]),
    ("بوتات دردشة بنماذج لغوية", "llm chat bots", ["latency", "cache", "rate", "memory", "stream"]),
    ("خوادم الذكاء الاصطناعي المنزلية", "self-hosted llm servers", ["latency", "cache", "rate", "memory"]),
    ("وكلاء برمجة آليون", "autonomous coding agents", ["memory", "drops", "rate", "latency"]),
    ("بوتات ديسكورد للمساعدة", "discord helper bots", ["split", "rate", "drops", "cache", "webhook"]),
    ("تطبيقات تلجرام المصغرة", "telegram mini apps", ["latency", "cache", "webhook", "drops"]),
]
TOPICS_B = [      # never used for training rows: the eval cases use these
    ("بوتات واتساب للدعم", "whatsapp support bots", ["latency", "split", "rate", "webhook", "drops"]),
    ("مساعدو الشيفرة في المحرر", "editor code assistants", ["memory", "cache", "latency", "stream"]),
]
OWNERS = ["northwind", "harbor-labs", "pinecone-dev", "lumen-works", "cedar-io", "tidal-stack", "orbit-kit", "quartz-lab"]
REPOS = ["relay-bot", "queue-kit", "chat-gateway", "bot-runtime", "agent-hub", "msg-router", "reply-engine", "flow-agent", "tg-bridge", "wire-bot"]
LANGS = ["Python", "TypeScript", "Go", "Rust", "JavaScript"]

REQ_AR = [
    "اذهب وابحث على جيتهوب عن مشاريع {t} وحلل كيف قاموا بحل مشكلة {a} وكل ما يتعلق بهذا، قم بالقراءة والتحليل واحضر تلك الأفكار واخبرني بها كي ننفذها",
    "ابحث لي عن مشاريع {t} وكيف تعاملوا مع {a}، واكتب لي خلاصة بالأفكار القابلة للتنفيذ مع المصادر",
    "أريد تقريراً عن {t}: كيف يحلّون {a}؟ اعتمد على مصادر حقيقية فقط",
    "حلل لي كيف تتعامل مشاريع {t} مع {a} وأعطني توصيات عملية",
]
REQ_EN = [
    "Go and search GitHub for {t} projects and analyze how they solved {a}; read them and bring me the ideas so we can implement them",
    "Find me projects about {t} and how they handle {a}, then write a short summary of the actionable ideas with sources",
    "I need a report on {t}: how do they solve {a}? Use real sources only",
]

NOT_FOUND_AR = ["لم أجد في المصادر ما يغطي {x}", "المصادر التي قرأتها لا تتناول {x}", "لا يوجد في المصادر شيء عن {x}"]
NOT_FOUND_EN = ["The sources I read do not cover {x}", "I found nothing in the sources about {x}", "None of the sources address {x}"]


def load(name: str) -> str:
    return (T / name).read_text(encoding="utf-8")


def runtime():
    d = json.loads(load("runtime_tools.json"))
    return d, load("runtime_system_ar.txt"), load("runtime_system_agent_worker.txt"), load("runtime_system_agent_reader.txt")


def system_with_date(sys_txt: str, rng: random.Random) -> str:
    day = f"2026-{rng.randint(10, 12):02d}-{rng.randint(1, 28):02d}"
    return re.sub(r"Current date \(UTC\): \d{4}-\d{2}-\d{2}", f"Current date (UTC): {day}", sys_txt)


def call(name: str, args: dict, cid: str) -> dict:
    # arguments as a JSON STRING, like the other tool sources of the mix (xlam, traces): one column cannot hold both strings and objects
    # when datasets loads data/mix.jsonl; train.py turns them into objects for the chat template.
    return {"role": "assistant", "content": "", "tool_calls": [{"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]}


def tool_msg(cid: str, name: str, content: str) -> dict:
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}


def pick_aspects(topic, rng, k=None):
    k = k or rng.choice([2, 3, 3])
    ks = rng.sample(topic[2], min(k, len(topic[2])))
    return ks


def asked_text(ks: list, ar: bool) -> str:
    names = [ASPECTS[k][0 if ar else 1] for k in ks]
    sep = " و" if ar else " and "
    return (sep.join(names) if len(names) < 3 else ("، ".join(names[:-1]) + " و" + names[-1]) if ar else (", ".join(names[:-1]) + " and " + names[-1]))


def make_sources(topic, ks: list, covered: list, rng: random.Random):
    """Sources cover only `covered` aspects (one per source, a second sentence of context for each)."""
    owners = rng.sample(OWNERS, len(covered))
    repos = rng.sample(REPOS, len(covered))
    out = []
    for i, k in enumerate(covered):
        name = f"{owners[i]}/{repos[i]}"
        out.append({"n": i + 1, "name": name, "aspect": k, "lang": rng.choice(LANGS), "stars": rng.choice([120, 340, 870, 1500, 2300, 4100])})
    return out


def render_research(question: str, queries: list, sources: list, ar_row: bool) -> str:
    lines = [f"Deep research for: {question}", "Queries: " + " · ".join(f'"{q}"' for q in queries), f"Sources read: {len(sources)}/{len(sources)}", "",
             "Write the answer from these sources only. Cite every claim as [n]. Compare where sources disagree, say which is newer/more authoritative, and say what remains uncertain.", ""]
    for s in sources:
        a = ASPECTS[s["aspect"]]
        lines.append(f"[{s['n']}] {s['name']} — https://github.com/{s['name']}")
        lines.append(f"  > {s['name'].split('/')[1]} is a {s['lang']} project with {s['stars']} stars.")
        lines.append("  > " + a[3].format(r=s["name"].split("/")[1]) + ".")
        lines.append("")
    return "\n".join(lines).rstrip()


def answer_grounded(sources: list, missing: list, ar: bool, rng: random.Random) -> str:
    if ar:
        out = [f"اعتمدتُ على {len(sources)} مصادر قرأتُها فعلاً:"]
        for s in sources:
            a = ASPECTS[s["aspect"]]
            out.append(f"• **{s['name']}** [{s['n']}]: {a[2].format(r=s['name'].split('/')[1])}.")
        if missing:
            m = "، ".join(ASPECTS[k][0] for k in missing)
            out.append("")
            out.append("**ما لم أجده:** " + rng.choice(NOT_FOUND_AR).format(x=m) + "، ولن أخمّن حلاً له.")
        out.append("")
        covered = "، ".join(ASPECTS[s["aspect"]][0] for s in sources)
        out.append(f"**الخلاصة:** الأفكار الموثقة أعلاه تغطي {covered} فقط؛ ما عداها يحتاج بحثاً إضافياً.")
        return "\n".join(out)
    out = [f"I relied on the {len(sources)} sources I actually read:"]
    for s in sources:
        a = ASPECTS[s["aspect"]]
        out.append(f"• **{s['name']}** [{s['n']}]: {a[3].format(r=s['name'].split('/')[1])}.")
    if missing:
        m = ", ".join(ASPECTS[k][1] for k in missing)
        out.append("")
        out.append("**Not found:** " + rng.choice(NOT_FOUND_EN).format(x=m) + "; I will not guess a solution for it.")
    out.append("")
    covered = ", ".join(ASPECTS[s["aspect"]][1] for s in sources)
    out.append(f"**Summary:** the documented ideas above cover {covered} only; the rest needs more searching.")
    return "\n".join(out)


def queries_for(topic, ks: list) -> list:
    base = topic[1]
    q = [f"{base} architecture", f"{base} {ASPECTS[ks[0]][1]}"]
    for k in ks[1:3]:
        q.append(f"{base} {ASPECTS[k][1]}")
    return q[:4]


# ---------------------------------------------------------------- the kinds
def row_grounded(topic, rng, tools_d, sys_txt):
    ar = rng.random() < 0.65
    ks = pick_aspects(topic, rng, rng.choice([2, 3]))
    covered = ks[: max(1, len(ks) - rng.choice([0, 1]))]
    missing = [k for k in ks if k not in covered]
    sources = make_sources(topic, ks, covered, rng)
    t = topic[0] if ar else topic[1]
    req = rng.choice(REQ_AR if ar else REQ_EN).format(t=t, a=asked_text(ks, ar))
    qs = queries_for(topic, ks)
    cid = f"call_{rng.randint(100000, 999999)}"
    msgs = [{"role": "system", "content": system_with_date(sys_txt, rng)}, {"role": "user", "content": req},
            call("deep_research", {"question": req, "queries": qs}, cid),
            tool_msg(cid, "deep_research", render_research(req, qs, sources, ar)),
            {"role": "user", "content": HARNESS_OK},
            {"role": "assistant", "content": answer_grounded(sources, missing, ar, rng)}]
    return {"messages": msgs, "kind": "grounded", "meta": {"sources": [s["name"] for s in sources], "missing": missing, "ar": ar}}


def row_thin(topic, rng, tools_d, sys_txt, ends_with_call: bool):
    ar = rng.random() < 0.65
    ks = pick_aspects(topic, rng, rng.choice([2, 3]))
    t = topic[0] if ar else topic[1]
    req = rng.choice(REQ_AR if ar else REQ_EN).format(t=t, a=asked_text(ks, ar))
    qs = queries_for(topic, ks)
    cid, cid2 = f"call_{rng.randint(100000, 999999)}", f"call_{rng.randint(100000, 999999)}"
    thin_out = f"Deep research for: {req}\nQueries: " + " · ".join(f'"{q}"' for q in qs) + "\nSources read: 0/0\n\nWrite the answer from these sources only. Cite every claim as [n]."
    msgs = [{"role": "system", "content": system_with_date(sys_txt, rng)}, {"role": "user", "content": req},
            call("deep_research", {"question": req, "queries": qs}, cid), tool_msg(cid, "deep_research", thin_out),
            {"role": "user", "content": HARNESS_THIN}]
    precise = f"{topic[1]} {ASPECTS[ks[0]][1]}"
    msgs.append(call("web_search", {"query": precise}, cid2))          # acts at once with ONE precise query, no announcement
    if not ends_with_call:
        msgs.append(tool_msg(cid2, "web_search", "No results."))
        if ar:
            txt = (f"بحثتُ عن «{t}» بعدة صيغ ({'، '.join(qs[:3])}) ثم ببحث دقيق إضافي، ولم أجد أي مصدر قابل للقراءة.\n\n"
                   "**لن أخترع أسماء مشاريع أو حلولاً.** ما أستطيع قوله بصدق: لا توجد لدي مصادر عن هذا الموضوع الآن.\n\n"
                   f"للمتابعة أحتاج منك أحد أمرين: اسم مشروع محدد تريد دراسته، أو أن أبحث عن جانب واحد فقط (مثلاً {ASPECTS[ks[0]][0]}).")
        else:
            txt = (f"I searched for \"{t}\" with several phrasings ({', '.join(qs[:3])}) and then one more precise query, and found no readable source.\n\n"
                   "**I will not invent project names or solutions.** What I can honestly say: I have no sources on this topic right now.\n\n"
                   f"To continue I need one of two things: a specific project name to study, or to search a single aspect only (for example {ASPECTS[ks[0]][1]}).")
        msgs.append({"role": "assistant", "content": txt})
    return {"messages": msgs, "kind": "thin", "meta": {"ar": ar}}


ROUTES = [   # (user text AR, user text EN, assistant action)
    ("ابحث لي في الويب عن أفضل الممارسات الحالية لتقسيم الرسائل الطويلة في بوتات تلجرام", "Search the web for current best practice on splitting long messages in Telegram bots", ("load_tools", {"groups": ["web"]})),
    ("اذهب إلى جيتهوب وابحث عن مشاريع مفتوحة المصدر لبوتات الدردشة وحلل بنيتها", "Go to GitHub and find open-source chat bot projects and analyze their structure", ("load_tools", {"groups": ["github", "web"]})),
    ("اقرأ ملف README في المستودع {repo} وأخبرني كيف يعمل", "Read the README of {repo} and tell me how it works", ("load_tools", {"groups": ["github"]})),
    ("شغّل الاختبارات في {repo} وأخبرني ما الذي يفشل", "Run the tests in {repo} and tell me what fails", ("load_tools", {"groups": ["github", "computer"]})),
    ("كل صباح الساعة 9 لخّص لي القضايا المفتوحة في {repo}", "Every morning at 9 summarize the open issues in {repo}", ("load_tools", {"groups": ["schedule", "github"]})),
    ("تذكّر أنني أفضّل TypeScript في كل مشاريعي", "Remember that I prefer TypeScript in all my projects", ("load_tools", {"groups": ["memory"]})),
    ("أصلح الخطأ في المشروع", "Fix the bug in the project", ("ask_user", {"question": "في أي مستودع تريد الإصلاح؟ وما هو الخطأ الذي تراه؟"})),
    ("قارن بين ثلاثة مستودعات {repo} و {repo2} و {repo3} من حيث البنية والاختبارات", "Compare the three repositories {repo}, {repo2} and {repo3} on structure and tests",
     ("delegate", None)),
]
ROUTES_EVAL = [   # wording used ONLY by the eval cases (never in training rows)
    ("هل تقدر تدور في الإنترنت عن طرق تخفيف التأخر في بوتات المحادثة؟", "Could you look online for ways to reduce latency in chat bots?", ("load_tools", {"groups": ["web"]})),
    ("افتح لي مستودع {repo} وافهم بنيته ثم لخّصها", "Open the repo {repo}, understand how it is built, then summarise it", ("load_tools", {"groups": ["github"]})),
    ("نفّذ npm test داخل {repo} وقل لي هل نجحت", "Execute npm test inside {repo} and tell me whether it passed", ("load_tools", {"groups": ["github", "computer"]})),
    ("جدول لي كل يوم اثنين تقريراً عن طلبات الدمج في {repo}", "Schedule me a report on the pull requests of {repo} every Monday", ("load_tools", {"groups": ["schedule", "github"]})),
    ("حسّن الأداء في المشروع كله من فضلك", "Please make the whole project faster", ("ask_user", {"question": "أي جزء من المشروع تقصد؟ وفي أي مستودع؟"})),
    ("افحص {repo} و {repo2} و {repo3} بالتوازي وأعطني فروقها", "Inspect {repo}, {repo2} and {repo3} side by side and give me the differences", ("delegate", None)),
]
QA_EVAL = [
    ("ما هو الـ JSON باختصار؟", "JSON صيغة نصية خفيفة لتبادل البيانات، تعتمد أزواج مفتاح/قيمة وقوائم، ويقرؤها البشر وتفهمها كل اللغات تقريباً."),
    ("What does the `finally` block do in Python?", "The `finally` block always runs after `try` / `except`, whether or not an exception occurred, which makes it the place for cleanup."),
]
QA = [   # direct answers that need no tools (true statements)
    ("ما الفرق بين list و tuple في بايثون؟", "القائمة list قابلة للتعديل بعد إنشائها، أما tuple فثابتة لا تتغير. لذلك تصلح tuple مفتاحاً في القواميس وتكون أخف قليلاً."),
    ("What is the difference between == and is in Python?", "`==` compares values, while `is` checks whether two names point to the very same object in memory."),
    ("ما معنى REST API باختصار؟", "هو أسلوب لتصميم واجهات الويب يستعمل طرق HTTP (GET وPOST وPUT وDELETE) على موارد لها عناوين، وبلا حالة محفوظة بين الطلبات."),
    ("What does `git rebase` do?", "It replays your commits on top of another base commit, producing a linear history instead of a merge commit."),
    ("لماذا نستخدم الفهارس في قواعد البيانات؟", "الفهرس يسرّع البحث والفرز لأنه يرتّب مؤشرات للصفوف مسبقاً، بثمن مساحة أكبر وإبطاء بسيط للإدخال والتعديل."),
]


EVAL_MODE = False


def row_route(rng, tools_d, sys_txt):
    kind = rng.random()
    repos = [f"{rng.choice(OWNERS)}/{rng.choice(REPOS)}" for _ in range(3)]
    system = {"role": "system", "content": system_with_date(sys_txt, rng)}
    if kind < 0.22:                      # a plain question: answer, no tool
        q = rng.choice(QA_EVAL if EVAL_MODE else QA)
        return {"messages": [system, {"role": "user", "content": q[0]}, {"role": "assistant", "content": q[1]}], "tools": tools_d["first_step"], "kind": "route", "meta": {"expect": None}}
    ar_text, en_text, action = rng.choice(ROUTES_EVAL if EVAL_MODE else ROUTES)
    ar = rng.random() < 0.6
    user = (ar_text if ar else en_text).format(repo=repos[0], repo2=repos[1], repo3=repos[2])
    cid = f"call_{rng.randint(100000, 999999)}"
    name, args = action
    if name == "delegate":
        args = {"tasks": [{"title": ("بنية " if ar else "Structure of ") + r.split("/")[1], "task": (f"اقرأ README والبنية الرئيسية للمستودع {r} واذكر المسارات الأهم" if ar else f"Read the README and main structure of {r} and list the key paths"), "role": "reader"} for r in repos]}
    return {"messages": [system, {"role": "user", "content": user}, call(name, args, cid)], "tools": tools_d["first_step"], "kind": "route", "meta": {"expect": name, "groups": (args or {}).get("groups")}}


REPORT_SCENARIOS = ["merge_declined", "read_ok", "search_none", "denied_delete", "write_ok"]


def report_text(job: str, done: str, notdone: str, output: str) -> str:
    return f"JOB: {job}\nDONE: {done}\nNOT DONE: {notdone}\nOUTPUT: {output}"


def row_report(rng, tools_d, worker_sys, reader_sys):
    ar = rng.random() < 0.65
    sc = rng.choice(REPORT_SCENARIOS)
    repo = f"{rng.choice(OWNERS)}/{rng.choice(REPOS)}"
    pr = rng.randint(3, 90)
    cid = f"call_{rng.randint(100000, 999999)}"
    if sc in ("merge_declined", "denied_delete", "write_ok"):
        system, role = worker_sys, "worker"
    else:
        system, role = reader_sys, "reader"
    if sc == "merge_declined":
        task = (f"ادمج طلب الدمج رقم {pr} في {repo}" if ar else f"Merge pull request #{pr} in {repo}")
        msgs = [call("github_merge_pr", {"repo": repo, "number": pr}, cid), tool_msg(cid, "github_merge_pr", DECLINED)]
        rep = report_text(task, ("حاولتُ دمج الطلب وطلبتُ موافقة المستخدم." if ar else "I tried to merge it and asked the user for approval."),
                          (f"لم يُدمج الطلب #{pr}: رفض المستخدم الخطوة." if ar else f"Pull request #{pr} was NOT merged: the user declined."), "none" if not ar else "لا شيء")
    elif sc == "denied_delete":
        br = f"old-{rng.randint(1, 40)}"
        task = (f"احذف الفرع {br} من {repo}" if ar else f"Delete the branch {br} in {repo}")
        msgs = [call("github_delete_branch", {"repo": repo, "branch": br}, cid), tool_msg(cid, "github_delete_branch", DENIED.format(cat="delete"))]
        rep = report_text(task, ("لا شيء نُفّذ." if ar else "Nothing was executed."), (f"لم أحذف الفرع {br}: سياسة المستخدم تمنع الحذف التلقائي." if ar else f"I did not delete {br}: the user's policy denies deletes."), "none")
    elif sc == "write_ok":
        br = f"fix/agent-{rng.randint(1, 99)}"
        task = (f"أنشئ الفرع {br} في {repo}" if ar else f"Create the branch {br} in {repo}")
        msgs = [call("github_create_branch", {"repo": repo, "branch": br, "from": "main"}, cid), tool_msg(cid, "github_create_branch", f"created {br} at {rng.randint(1000000, 9999999):x}")]
        rep = report_text(task, (f"أنشأتُ الفرع {br} من main." if ar else f"Created the branch {br} from main."), ("لا شيء" if ar else "nothing"), br)
    elif sc == "read_ok":
        task = (f"اقرأ README في {repo} وأخبرني كيف يُشغَّل" if ar else f"Read the README of {repo} and tell me how to run it")
        cmd = rng.choice(["npm install && npm start", "pip install -r requirements.txt && python main.py", "go run ./cmd/server"])
        msgs = [call("github_read_file", {"repo": repo, "path": "README.md"}, cid), tool_msg(cid, "github_read_file", f"# {repo.split('/')[1]}\n\n## Run\n\n```\n{cmd}\n```\n\nRequires a TELEGRAM_TOKEN environment variable.")]
        rep = report_text(task, (f"README.md: التشغيل بالأمر `{cmd}`، ويتطلب متغير البيئة TELEGRAM_TOKEN." if ar else f"README.md: run with `{cmd}`; it needs the TELEGRAM_TOKEN environment variable."), ("لم أقرأ بقية الملفات." if ar else "I did not read the other files."), "none")
    else:   # search_none
        task = (f"ابحث في الكود عن دالة retry في {repo}" if ar else f"Search the code of {repo} for a retry function")
        msgs = [call("github_search_code", {"repo": repo, "query": "retry"}, cid), tool_msg(cid, "github_search_code", "No matches.")]
        rep = report_text(task, ("بحثتُ بكلمة retry في المستودع." if ar else "I searched the repository for the word retry."), ("لم أجد أي مطابقة، ولا أستطيع الجزم بغياب الدالة تحت اسم آخر." if ar else "No match found; I cannot rule out the function under another name."), "none")
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": task}] + msgs + [{"role": "assistant", "content": rep}]
    return {"messages": msgs, "kind": "report", "meta": {"role": role, "scenario": sc}}


def row_combine(rng, tools_d, sys_txt):
    ar = rng.random() < 0.65
    n = rng.choice([2, 3])
    repos = [f"{rng.choice(OWNERS)}/{rng.choice(REPOS)}" for _ in range(n)]
    user = ("ادمج طلبات الدمج المفتوحة في المستودعات التالية وأخبرني بالنتيجة: " + "، ".join(repos)) if ar else ("Merge the open pull requests in these repositories and tell me the result: " + ", ".join(repos))
    cid = f"call_{rng.randint(100000, 999999)}"
    blocks, said = [], []
    for i, r in enumerate(repos):
        ok = rng.random() < 0.5
        pr = rng.randint(3, 90)
        status = "[status: done]"
        job = (f"دمج الطلب #{pr} في {r}" if ar else f"Merge #{pr} in {r}")
        if ok:
            done, nd, out = (f"دُمج الطلب #{pr} بعد موافقة المستخدم." if ar else f"#{pr} was merged after the user approved."), "nothing", f"PR #{pr}"
            said.append((r, pr, True))
        else:
            done, nd, out = ("لا شيء نُفّذ." if ar else "Nothing was executed."), (f"لم يُدمج #{pr}: رفض المستخدم." if ar else f"#{pr} was NOT merged: the user declined."), "none"
            said.append((r, pr, False))
        blocks.append(f"## Agent {i + 1}: {job}\n{status}\nJOB: {job}\nNOT DONE: {nd}\nOUTPUT: {out}\nDONE: {done}")
    tool = COMBINE_HEAD.format(n=n) + "\n\n" + "\n\n".join(blocks)
    tasks = [{"title": f"merge {r.split('/')[1]}", "task": f"Merge the open pull request in {r}", "role": "worker"} for r in repos]
    merged = [(r, pr) for r, pr, ok in said if ok]
    skipped = [(r, pr) for r, pr, ok in said if not ok]
    if ar:
        parts = ["هذه نتيجة المهمة كما أبلغ بها الوكلاء:"]
        parts += [f"• تم دمج #{pr} في {r}." for r, pr in merged]
        if not merged:
            parts.append("• لم يُدمج أي طلب.")
        if skipped:
            parts.append("")
            parts.append("**لم يتم:** " + "، ".join(f"#{pr} في {r} (رفضتَ الخطوة)" for r, pr in skipped) + ". يمكنني إعادة المحاولة إن أردت.")
        final = "\n".join(parts)
    else:
        parts = ["Here is the result as the agents reported it:"]
        parts += [f"• #{pr} was merged in {r}." for r, pr in merged]
        if not merged:
            parts.append("• No pull request was merged.")
        if skipped:
            parts.append("")
            parts.append("**Not done:** " + ", ".join(f"#{pr} in {r} (you declined the step)" for r, pr in skipped) + ". I can retry if you want.")
        final = "\n".join(parts)
    msgs = [{"role": "system", "content": system_with_date(sys_txt, rng)}, {"role": "user", "content": user}, call("delegate", {"tasks": tasks}, cid), tool_msg(cid, "delegate", tool), {"role": "assistant", "content": final}]
    return {"messages": msgs, "kind": "combine", "meta": {"merged": [list(x) for x in merged], "skipped": [list(x) for x in skipped]}}


# ---------------------------------------------------------------- build
def build(n: int, seed: int, topics, avoid=frozenset()):
    rng = random.Random(seed)
    tools_d, sys_txt, worker_sys, reader_sys = runtime()
    mix = [("grounded", 0.28), ("thin_full", 0.12), ("thin_call", 0.12), ("route", 0.22), ("report", 0.16), ("combine", 0.10)]
    kinds = [k for k, _ in mix]
    weights = [w for _, w in mix]
    rows, seen = [], set()
    guard = 0
    while len(rows) < n and guard < n * 60:
        guard += 1
        k = rng.choices(kinds, weights)[0]
        topic = rng.choice(topics)
        if k == "grounded":
            r = row_grounded(topic, rng, tools_d, sys_txt)
        elif k == "thin_full":
            r = row_thin(topic, rng, tools_d, sys_txt, False)
        elif k == "thin_call":
            r = row_thin(topic, rng, tools_d, sys_txt, True)
        elif k == "route":
            r = row_route(rng, tools_d, sys_txt)
        elif k == "report":
            r = row_report(rng, tools_d, worker_sys, reader_sys)
        else:
            r = row_combine(rng, tools_d, sys_txt)
        key = json.dumps([m.get("content") or m.get("tool_calls") for m in r["messages"][1:]], ensure_ascii=False, sort_keys=True)
        if key in seen or r["messages"][1]["content"] in avoid:
            continue
        seen.add(key)
        r["source"] = "nova_agent"
        rows.append(r)
    return rows


def check_row(r: dict) -> list:
    """Problems of one row (empty = fine). The grounding rules the eval also uses."""
    bad = []
    msgs = r["messages"]
    final = msgs[-1].get("content") or ""
    if r["kind"] == "grounded":
        tool = next(m["content"] for m in msgs if m["role"] == "tool")
        names = set(re.findall(r"\*\*([\w-]+/[\w-]+)\*\*", final))
        if not names or not names <= set(re.findall(r"\[\d+\] ([\w-]+/[\w-]+) —", tool)):
            bad.append("names not in sources")
        if not re.search(r"\[\d\]", final):
            bad.append("no citation")
        if r["meta"]["missing"] and not re.search(r"لم أجد|لا تتناول|لا يوجد|do not cover|found nothing|None of the sources|Not found|ما لم أجده", final):
            bad.append("missing aspect not admitted")
    if r["kind"] == "thin" and msgs[-1].get("role") == "assistant" and msgs[-1].get("content"):
        if re.search(r"github\.com/|https?://", final) or "[1]" in final:
            bad.append("thin answer cites something")
        if not re.search(r"لن أخترع|will not invent", final):
            bad.append("thin answer does not refuse to invent")
    if r["kind"] == "report":
        if not re.search(r"^JOB: .+\nDONE: .+\nNOT DONE: .+\nOUTPUT: .+$", final, re.S):
            bad.append("report shape")
    if r["kind"] == "combine" and r["meta"]["skipped"] and not re.search(r"لم يتم|Not done", final):
        bad.append("combine hides NOT DONE")
    if re.search(r"Qwen|OpenAI|ChatGPT|Claude|Anthropic|Alibaba|通义", json.dumps(msgs, ensure_ascii=False)):
        bad.append("provider name")
    users = [m for m in msgs if m["role"] == "user" and not (m.get("content") or "").startswith("[harness]")]
    if not users or len(users[0]["content"].strip()) < 16:
        bad.append("short user prompt")
    return bad


def main() -> None:
    global EVAL_MODE
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1800)
    ap.add_argument("--eval", type=int, default=0, help="write this many held-out eval cases (topic pool B, other seed) instead of training rows")
    ap.add_argument("--seed", type=int, default=20261024)
    ap.add_argument("--out", default=str(HERE / "data" / "nova_agent.jsonl"))
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()
    if a.selfcheck:
        rows = build(400, a.seed, TOPICS_A)
        kinds = {}
        problems = 0
        for r in rows:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
            b = check_row(r)
            if b:
                problems += 1
                print("PROBLEM", r["kind"], b)
        EVAL_MODE = True
        ev = build(40, a.seed + 1, TOPICS_B)
        EVAL_MODE = False
        assert not ({json.dumps(r["messages"][1]["content"]) for r in ev if r["kind"] in ("grounded", "thin")} & {json.dumps(r["messages"][1]["content"]) for r in rows if r["kind"] in ("grounded", "thin")}), "eval requests overlap training"
        print("selfcheck:", kinds, "problems:", problems)
        raise SystemExit(1 if problems else 0)
    EVAL_MODE = bool(a.eval)
    avoid = frozenset()
    if a.eval:      # an eval case never repeats a training request, whatever the wording pool: the training rows are rebuilt (same seed) and their requests excluded
        EVAL_MODE = False
        avoid = frozenset(r["messages"][1]["content"] for r in build(1800, a.seed, TOPICS_A))
        EVAL_MODE = True
    rows = build(a.eval or a.n, a.seed + (1 if a.eval else 0), TOPICS_B if a.eval else TOPICS_A, avoid)
    bad = [(r["kind"], check_row(r)) for r in rows if check_row(r)]
    if bad:
        raise SystemExit(f"{len(bad)} rows failed their checks, e.g. {bad[0]}")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w") as f:
        for r in rows:
            if not a.eval:                       # training rows carry only what the trainer needs (the meta dicts differ per kind and break the dataset schema)
                r = {k: v for k, v in r.items() if k not in ("meta", "kind")}
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} rows to {a.out}")


if __name__ == "__main__":
    main()
