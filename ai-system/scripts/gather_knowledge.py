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
of any user ever asking — real self-directed growth, still gated by
the exact same guardrail rule as the reactive path (see
app.guardrails.sanitize_for_storage, imported directly, not
reimplemented — one rule, enforced identically in both places).

Runs on a GitHub Actions runner specifically, not on Render: this
project's own history (real, confirmed evidence, not guessed) already
established that DuckDuckGo blocks scraping from Render's shared cloud
IP — GitHub Actions runners are not blocked the same way, and this
script needs the real live search DDGS() gives, not the much narrower
DuckDuckGo Instant-Answer fallback rag.py falls back to for that
reason.

Topic selection, real not random:
  1. A fixed rotating list of general-knowledge categories (below) —
     a few per run, cycled so the same ones aren't hit every single
     day.
  2. Gap-driven: real questions pulled from NovaUsageLog where Nova's
     own past answer contains one of the exact "I don't have live
     data" phrases this project has directly observed it produce (see
     _GAP_PHRASES below — taken from real owner-reported screenshots
     in this same project, not guessed) — genuine holes in what Nova
     already knows, found from real usage, not invented topics.

Each topic that already has a NovaKnowledgeEntry row is skipped — this
script grows the bank, it does not re-churn the same entries every run.
"""
import os
import random
import sys
import time
import uuid

import requests
from ddgs import DDGS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import guardrails  # noqa: E402  (needs the sys.path insert above first)

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

_MAX_TOPICS_PER_RUN = 6
_MAX_GENERAL_PER_RUN = 3
_MAX_GAP_PER_RUN = 3

# A real, fixed rotating set — general knowledge broad enough to be
# useful across ordinary conversation, not a narrow niche.
_GENERAL_TOPICS = [
    "أهم الاكتشافات العلمية الحديثة",
    "كيف يعمل الذكاء الاصطناعي التوليدي",
    "أساسيات التغذية الصحية",
    "تاريخ صعود شركات التقنية الكبرى",
    "أساسيات الاستثمار للمبتدئين",
    "أهم قواعد كرة القدم الحديثة",
    "كيف تعمل محركات البحث",
    "أساسيات الأمن السيبراني للمستخدم العادي",
    "أهم التطورات في الطاقة المتجددة",
    "كيف تُصنع اللقاحات",
    "أساسيات إدارة الوقت والإنتاجية",
    "تاريخ الإنترنت وتطوره",
]

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


def _pick_general_topics() -> list[str]:
    candidates = [t for t in _GENERAL_TOPICS if not _already_known(t)]
    random.shuffle(candidates)
    return candidates[:_MAX_GENERAL_PER_RUN]


def _pick_gap_topics() -> list[str]:
    """Real questions Nova already answered with a "no live data"-style
    phrase, pulled from actual usage — the genuine gaps, not a guess."""
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
    return seen


def _web_search(query: str, max_results: int = 3) -> str:
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
    return "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)


def _analyze(query: str, raw_snippets: str) -> str:
    """Same real synthesis step the reactive path uses
    (council.analyze_knowledge) — a direct Groq REST call here instead
    of importing council.py, since this standalone script deliberately
    stays free of every heavy project dependency (chromadb, torch, …)
    that importing council.py/rag.py in full would drag in."""
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


def _store(query: str, content: str) -> bool:
    safe_content = guardrails.sanitize_for_storage(content)
    if safe_content is None:
        print(f"gather-knowledge: rejected by guardrails, not stored ('{query}')")
        return False
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/NovaKnowledgeEntry",
        headers=_supabase_headers(),
        json={"id": f"pk-{uuid.uuid4().hex[:12]}", "query": query, "content": safe_content, "source": "proactive_web"},
        timeout=20,
    )
    if not resp.ok:
        print(f"gather-knowledge: Supabase insert failed for '{query}' ({resp.status_code}): {resp.text[:200]}")
        return False
    return True


def main() -> None:
    topics = _pick_general_topics() + _pick_gap_topics()
    topics = topics[:_MAX_TOPICS_PER_RUN]
    if not topics:
        print("gather-knowledge: nothing new to gather this run (all candidate topics already known).")
        return

    stored = 0
    for topic in topics:
        print(f"gather-knowledge: researching '{topic}'...")
        try:
            raw = _web_search(topic)
        except Exception as e:
            print(f"gather-knowledge: web search failed for '{topic}' ({e}) — skipping")
            continue
        if not raw.strip():
            print(f"gather-knowledge: no search results for '{topic}' — skipping")
            continue
        analyzed = _analyze(topic, raw)
        if _store(topic, analyzed):
            stored += 1
        time.sleep(2)  # real, deliberate pacing — a courtesy to DuckDuckGo, not a requirement it imposes

    print(f"gather-knowledge: done — stored {stored}/{len(topics)} new knowledge-bank entries this run.")


if __name__ == "__main__":
    main()
