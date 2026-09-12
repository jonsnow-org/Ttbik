"""
Owner spec, 2026-09-12 ("نريد ان نجعله حر آليا ولكن مقيد بأوامر وقوانين
لايتخطاها... تطوير ذاتي آلي... ليس مجرد جمع وتخزين وحين يُسأل يجيب من
الذي خزّنه — هذا ليس تطوير وتحديث"): this is the PROACTIVE half of a
mechanism that already existed REACTIVELY — rag.py's build_context has,
since 2026-09-08, done a real live web search + Groq synthesis +
storage into NovaKnowledgeEntry whenever a real user's question hit a
gap in what Nova already knew, and merge_and_finetune.ipynb's cell 4ب
already folds every row of that same table into REAL weekly training
(actual weight updates via LoRA, not just retrieval at answer time).
What was missing, exactly as the owner described it: Nova only ever
learned something when a user happened to ask about it first. This
script makes the SAME table grow on its own schedule too, independent
of any user ever asking.

Owner follow-up, 2026-09-12 ("بنوك لا تحصى... بحثه عن تغذية تخصه وتقوي
نظامه في جميع المجالات وليس مجال واحد... وظيفته التفكير وليس فقط
البحث والتخزين... اذا وجد ان هذا الامر خطأ يقوم حينها باستبداله
بالصحيح"): topics are now drawn from a real, broad DOMAIN taxonomy
(knowledge_store.DOMAINS) — one topic per domain each run, not a flat
list that could cluster on one area for a while — and every store now
goes through knowledge_store.store_or_update, which really compares
against whatever is already on file for the same question and decides
SAME/UPDATE/DIFFERENT via a real model call instead of blindly
inserting a duplicate every time (see that module's own docstring).

Runs on a GitHub Actions runner specifically, not on Render: this
project's own history (real, confirmed evidence, not guessed) already
established that DuckDuckGo blocks scraping from Render's shared cloud
IP — GitHub Actions runners are not blocked the same way, and this
script needs the real live search DDGS() gives, not the much narrower
DuckDuckGo Instant-Answer fallback rag.py falls back to for that
reason.

Topic selection, real not random:
  1. One topic per DOMAIN (knowledge_store.DOMAINS) — a deterministic,
     date-based rotation through each domain's own topic list, so every
     domain gets attention every run (real breadth) while still cycling
     back to earlier topics over time (a real chance to catch and
     correct something that's gone stale, via the reconciliation step
     above) rather than a one-shot "collect once" pass.
  2. Gap-driven: real questions pulled from NovaUsageLog where Nova's
     own past answer contains one of the exact "I don't have live
     data" phrases this project has directly observed it produce (see
     _GAP_PHRASES below — taken from real owner-reported screenshots in
     this same project, not guessed) — genuine holes in what Nova
     already knows, found from real usage, not invented topics.
"""
import datetime
import os
import sys
import time

import requests
from ddgs import DDGS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import knowledge_store  # noqa: E402  (needs the sys.path insert above first)

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

_MAX_GAP_PER_RUN = 3

# A real topic list PER DOMAIN (knowledge_store.DOMAINS) — every run
# picks exactly one topic from each domain (rotated deterministically
# by day-of-year so the same one isn't repeated every single day),
# guaranteeing the bank grows across every real capability area this
# project has instead of narrowing into whichever topic happened to be
# picked at random.
_TOPICS_BY_DOMAIN: dict[str, list[str]] = {
    "IMAGE_GEN": [
        "أدوات مجانية حقيقية لتحسين جودة توليد الصور بالذكاء الاصطناعي",
        "تقنيات تقليل تشوّه الوجوه والأيدي في الصور المولَّدة",
        "أفضل نماذج توليد صور مفتوحة المصدر منخفضة الموارد",
    ],
    "VIDEO_GEN": [
        "أدوات مجانية حقيقية لتوليد فيديو حقيقي سريع بمعالج رسومي",
        "نماذج فيديو مفتوحة المصدر تعمل بسرعة على معالج رسومي صغير",
    ],
    "AUDIO_GEN": [
        "أفضل أدوات تحويل نص إلى صوت مفتوحة المصدر ومجانية",
        "تقنيات تحسين طبيعية الصوت المولَّد بالذكاء الاصطناعي",
    ],
    "LIVE_SEARCH": [
        "واجهات برمجية مجانية حقيقية للبحث الحي الفوري على الويب",
        "طرق موثوقة لجلب أخبار وأسعار لحظية مجاناً عبر واجهة برمجية",
    ],
    "CODE_DEV": [
        "أفضل ممارسات كتابة كود بايثون نظيف وقابل للصيانة",
        "أدوات مجانية لاكتشاف الأخطاء البرمجية تلقائياً قبل النشر",
    ],
    "SECURITY": [
        "أفضل ممارسات حماية مفاتيح API والأسرار في مشاريع البرمجة",
        "طرق حقيقية لاكتشاف تسرّب بيانات حساسة في الكود تلقائياً",
    ],
    "CONVERSATION_QUALITY": [
        "تقنيات تحسين فهم النوايا في المحادثات الطبيعية بالذكاء الاصطناعي",
        "أفضل ممارسات تصميم شخصية مساعد ذكاء اصطناعي متسقة وودودة",
    ],
    "GENERAL_KNOWLEDGE": [
        "أهم الاكتشافات العلمية الحديثة",
        "أساسيات الاستثمار للمبتدئين",
        "تاريخ صعود شركات التقنية الكبرى",
        "أساسيات إدارة الوقت والإنتاجية",
    ],
}

# Real phrases this project has directly observed Nova produce when it
# has no live answer (owner screenshots, this same conversation) —
# used to find genuine gaps, not guessed keywords.
_GAP_PHRASES = [
    "لا أملك بيانات حية",
    "لا أستطيع الوصول",
    "ليس لدي معلومات دقيقة",
    "لا يمكنني الوصول للشبكة",
]


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _already_known(query: str) -> bool:
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/NovaKnowledgeEntry",
        headers=_supabase_headers(),
        params={"select": "id", "query": f"eq.{query}", "limit": "1"},
        timeout=20,
    )
    return resp.ok and len(resp.json()) > 0


def _pick_domain_topics() -> list[tuple[str, str]]:
    """One (domain, topic) pair per domain, rotated deterministically
    by day-of-year through that domain's own topic list — real breadth
    every run, with a real chance to revisit (and, via
    knowledge_store's reconciliation, correct) an earlier topic over
    time instead of only ever collecting new ones once."""
    day_of_year = datetime.date.today().timetuple().tm_yday
    picks = []
    for domain, topics in _TOPICS_BY_DOMAIN.items():
        topic = topics[day_of_year % len(topics)]
        picks.append((domain, topic))
    return picks


def _pick_gap_topics() -> list[tuple[str, str]]:
    """Real questions Nova already answered with a "no live data"-style
    phrase, pulled from actual usage — the genuine gaps, not a guess.
    Tagged LIVE_SEARCH since that's what every one of these represents
    by definition."""
    or_filter = ",".join(f"answer.ilike.*{phrase}*" for phrase in _GAP_PHRASES)
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/NovaUsageLog",
            headers=_supabase_headers(),
            params={
                "select": "message",
                "or": f"({or_filter})",
                "message": "not.is.null",
                "order": "created_at.desc",
                "limit": "50",
            },
            timeout=20,
        )
        if not resp.ok:
            return []
        rows = resp.json()
    except Exception:
        return []
    seen: list[str] = []
    for row in rows:
        message = (row.get("message") or "").strip()
        if message and message not in seen and not _already_known(message):
            seen.append(message)
        if len(seen) >= _MAX_GAP_PER_RUN:
            break
    return [("LIVE_SEARCH", m) for m in seen]


def _web_search(query: str, max_results: int = 3) -> str:
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
    return "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)


def _analyze(query: str, raw_snippets: str) -> str:
    """Real synthesis step (same shape as council.analyze_knowledge) —
    a direct Groq REST call here instead of importing council.py, since
    this standalone script deliberately stays free of every heavy
    project dependency (chromadb, torch, …) that importing
    council.py/rag.py in full would drag in."""
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "لديك نتائج بحث خام من الويب حول موضوع معيّن. لخّصها وادمجها في "
                            "فقرة واحدة واضحة ومباشرة بالعربية، بلا ذكر لأسماء المواقع أو أنك "
                            "تلخّص بحثاً. إن تناقضت النتائج، اذكر المعلومة الأكثر اتفاقاً بينها فقط."
                        ),
                    },
                    {"role": "user", "content": f"الموضوع: {query}\n\nنتائج البحث الخام:\n{raw_snippets}"},
                ],
                "max_tokens": 400,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"gather-knowledge: Groq analysis failed for '{query}' ({e}) — storing raw snippets instead")
        return raw_snippets


def main() -> None:
    topics = _pick_domain_topics() + _pick_gap_topics()
    if not topics:
        print("gather-knowledge: nothing to research this run.")
        return

    counts = {"inserted": 0, "updated": 0, "skipped_same": 0, "rejected_guardrails": 0, "failed": 0}
    for domain, topic in topics:
        print(f"gather-knowledge: [{domain}] researching '{topic}'...")
        try:
            raw = _web_search(topic)
        except Exception as e:
            print(f"gather-knowledge: web search failed for '{topic}' ({e}) — skipping")
            counts["failed"] += 1
            continue
        if not raw.strip():
            print(f"gather-knowledge: no search results for '{topic}' — skipping")
            counts["failed"] += 1
            continue
        analyzed = _analyze(topic, raw)
        result = knowledge_store.store_or_update(
            topic, analyzed, domain, "proactive_web", SUPABASE_URL, SUPABASE_KEY, GROQ_API_KEY, GROQ_MODEL
        )
        counts[result] = counts.get(result, 0) + 1
        print(f"gather-knowledge: [{domain}] '{topic}' -> {result}")
        time.sleep(2)  # real, deliberate pacing — a courtesy to DuckDuckGo, not a requirement it imposes

    print(
        f"gather-knowledge: done — {counts['inserted']} new, {counts['updated']} corrected/updated, "
        f"{counts['skipped_same']} already accurate, {counts['rejected_guardrails']} rejected by guardrails, "
        f"{counts['failed']} failed, across {len(topics)} topics this run."
    )


if __name__ == "__main__":
    main()
