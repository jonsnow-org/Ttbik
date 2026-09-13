"""
Zero-cost RAG — several independent "banks" (ChromaDB collections, all
free, on-disk) Nova draws from depending on what a message needs,
instead of one undifferentiated memory:

  - A per-user PRIVATE memory bank — continuity with one specific
    person's own past conversations. ONE shared collection
    (nova_memory_all), not one collection per user: a real, measured
    memory leak (see _memory_collection's own docstring) found a
    separate named collection per user costs several MB of fixed
    overhead each regardless of how little data it holds — with enough
    distinct users this alone can exceed a free-tier memory limit.
    Isolation between users is by a user_id metadata field instead.
  - A shared LIVE-INFO knowledge bank (nova_knowledge_bank) — caches
    real DuckDuckGo web-search results (free, no API key) across every
    user, so a price looked up for one user on Telegram is immediately
    available to the next user asking the same thing on the web UI.
  - A shared SOLUTIONS bank (nova_solutions_bank) — every real
    CODE/GENERAL question that got a real answer, from every user,
    gets indexed here too. A new question retrieves the most similar
    past solved ones as worked precedent before answering — this is
    what actually strengthens code/reasoning help beyond plain text
    replies (owner request, 2026-09-06: "يساعد بقوة على... التنفيذ
    والتفكير, وليس فقط اجابات نصية"), without needing to retrain
    anything. It's the same underlying real-conversation data
    (NovaUsageLog in Supabase) the Kaggle notebook already pulls for
    the weekly LoRA fine-tune — this bank makes that same data useful
    at ANSWER time too, immediately, every time it accumulates, not
    only once a week when the notebook happens to run.

Owner's own words on why this stays separate from — and doesn't
change — the training schedule: "نفذ الخطوات... ونقوم بتدريبه عليها
مرة واحدة او مرتين بالكثير وليس كل يوم" — these banks update
continuously in real time on every message; the LoRA fine-tune itself
stays on its own weekly Kaggle schedule regardless, since retraining
weights and retrieving from a vector store are two entirely different
operations with entirely different costs.

Uses Chroma's own bundled ONNX embedding function (a small ~80MB
MiniLM model via onnxruntime), NOT sentence-transformers/PyTorch —
importing PyTorch alone uses several hundred MB of RAM before the app
even finishes starting, which reliably OOM-killed this service on
Render's free instance type (512MB total). The ONNX path needs no
torch at all and fits comfortably.

Owner spec, 2026-09-08 ("يذهب للبحث على الانترنت عن بنك معلومات ويخزنه
في المخازن التي صنعناها ويحلله ويتدرب عليه"): two changes on top of the
original design above.

  1. Durability. Render's free-tier disk is NOT persistent — every
     restart/redeploy wipes ./chroma_data clean, silently resetting the
     shared knowledge bank to empty with no error anywhere (found while
     building this: Render restarts happen routinely, on every deploy
     of this very service, which this session does often). The shared
     knowledge bank now also writes through to a durable
     NovaKnowledgeEntry table in the same Supabase project NovaUsageLog
     already lives in (prisma/migration_23_nova_knowledge_bank.sql),
     and rehydrates Chroma from it on first use after a cold start. Per
     -user private memory and the solutions bank keep the old
     Chroma-only behavior for now — same exposure, smaller stakes (a
     user's own chat continuity resetting is a worse UX than a lost
     memory, but not a silently-regressing "the AI learned nothing"
     problem the way the shared knowledge bank is).
  2. Reach. A live web search used to fire ONLY for LIVE_INFO queries
     (prices, news — anything with a real freshness window). It now
     also fires for GENERAL/CODE queries once nothing useful turns up
     in per-user memory or the shared solutions bank — i.e. whenever
     Nova has no existing basis for an answer, not just when the
     question is explicitly about something time-sensitive. Raw search
     results get synthesized into one clean answer by
     council.analyze_knowledge before being stored, so what's kept is
     an actual learned fact, not a page of raw snippets.
"""
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

import chromadb
import requests
from chromadb.utils import embedding_functions
from ddgs import DDGS

from app.concurrency import with_hard_deadline
from app.config import GROQ_API_KEY, GROQ_MODEL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TAVILY_API_KEY
from app.supabase_client import get_supabase

logger = logging.getLogger("nova")

_chroma_client = chromadb.PersistentClient(path="./chroma_data")
_embedder = embedding_functions.DefaultEmbeddingFunction()

# How long a cached knowledge-bank answer stays trustworthy before we
# treat it as stale and search again. Live facts (prices, news) go bad
# fast — 6 hours is a deliberate middle ground between "never re-search
# the same question twice" (useless for prices) and "re-search every
# single time" (defeats the whole point of a growing knowledge bank).
_KNOWLEDGE_MAX_AGE_SECONDS = 6 * 3600
# General facts (how something works, historical/factual background)
# don't go stale the way a price does — reusing the 6h price-freshness
# window for these would mean re-searching the same stable fact every
# few hours forever, defeating the point of "learning" it once.
_GENERAL_KNOWLEDGE_MAX_AGE_SECONDS = 30 * 24 * 3600


def _parse_supabase_ts(value: str) -> float:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


# Render incident, 2026-09-13 (real evidence: Render's own alert — "Web
# Service nova-ai-backend exceeded its memory limit", auto-restarted):
# every rehydrate_* below used to hand its whole batch (up to 1000
# documents) to one single bank.add() call. Chroma's embedding function
# tokenizes and runs inference on the ENTIRE batch at once before
# returning — a 1000-document batch spikes peak memory far above what
# processing the same documents 40 at a time would need, on a free-tier
# instance with very little headroom to begin with. Chunking changes
# nothing about what ends up restored (same documents, same ids), only
# how much memory is live at any one instant while restoring them.
_REHYDRATE_CHUNK_SIZE = 40


def _add_in_chunks(collection, *, documents: list, ids: list, metadatas: list | None = None) -> None:
    for start in range(0, len(documents), _REHYDRATE_CHUNK_SIZE):
        end = start + _REHYDRATE_CHUNK_SIZE
        collection.add(
            documents=documents[start:end],
            ids=ids[start:end],
            metadatas=metadatas[start:end] if metadatas is not None else None,
        )


def _memory_collection():
    """Render incident, 2026-09-13 (real evidence: Render's own alert
    recurring — "Web Service nova-ai-backend exceeded its memory
    limit" — after the earlier rehydration-batch fix, on the SAME day):
    a separate Chroma collection per user (nova_memory_<user_id>) was
    the dominant cause, confirmed by direct measurement, not guessed —
    300 tiny per-user collections (5 short documents each) cost ~1.49GB
    RSS in a real local test, versus ~309MB for the SAME 1500 documents
    in ONE shared collection filtered by a user_id metadata field —
    each separate named collection carries several MB of fixed
    overhead regardless of how little data it holds, so memory grew
    with the number of DISTINCT USERS who ever chatted, not with the
    amount of data — exactly the "recurs as the day goes on" pattern
    reported. One shared collection scales with total documents
    instead, like nova_knowledge_bank/nova_solutions_bank already did
    from day one."""
    return _chroma_client.get_or_create_collection(name="nova_memory_all", embedding_function=_embedder)


def _user_has_memory(col, user_id: str) -> bool:
    return bool(col.get(where={"user_id": user_id}, limit=1)["ids"])


def _collection_for(user_id: str):
    """Owner report, 2026-09-13 (real complaint: "لا يتذكر المحادثة
    والسجل"): root cause confirmed, not guessed — Render's FREE web
    services have an EPHEMERAL filesystem (confirmed via Render's own
    docs: wiped on every redeploy AND every spin-down/restart after
    idle, which free services do routinely). _chroma_client's storage
    path (./chroma_data) lives on that same disk, so per-user memory
    was being silently erased roughly daily — it "worked" only within a
    single container lifetime. Rehydrates from NovaUsageLog (the
    durable Supabase table every real conversation turn is already
    logged into by quota.log_usage) only for THIS user, checked via a
    cheap local metadata-filtered query (_user_has_memory) rather than
    the shared collection's own .count(), which now counts every user's
    documents together and would rehydrate at most once total instead
    of once per user."""
    col = _memory_collection()
    if not _user_has_memory(col, user_id):
        _rehydrate_user_memory(col, user_id)
    return col


def _rehydrate_user_memory(col, user_id: str) -> None:
    """Runs at most once per container lifetime per user (only when
    this user has no matching documents yet in the shared collection) —
    never allowed to break the request that triggered it: a Supabase
    hiccup here just means this cold start starts empty for this user,
    same as before this durability fix existed."""
    try:
        rows = (
            get_supabase()
            .table("NovaUsageLog")
            .select("id, message, answer")
            .eq("novaUserId", user_id)
            .not_.is_("message", "null")
            .not_.is_("answer", "null")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
            .data
        )
    except Exception:
        logger.exception("rehydrate_user_memory: failed to read NovaUsageLog for user_id=%s", user_id)
        return
    if not rows:
        return
    _add_in_chunks(
        col,
        documents=[f"سؤال سابق: {r['message']}\nإجابة سابقة: {r['answer']}" for r in rows],
        ids=[f"restored-{r['id']}" for r in rows],
        metadatas=[{"user_id": user_id} for _ in rows],
    )
    logger.info("rehydrate_user_memory: restored %d past turns for user_id=%s after a cold start", len(rows), user_id)


def _knowledge_bank():
    # ONE shared collection across every user/channel — this is the
    # "bank of information" that grows over time from real search
    # results, instead of each user's search vanishing after their own
    # reply. A price looked up for one user on Telegram is immediately
    # available for the next user asking the same thing on the web UI.
    bank = _chroma_client.get_or_create_collection(name="nova_knowledge_bank", embedding_function=_embedder)
    if bank.count() == 0:
        _rehydrate_knowledge_bank(bank)
    return bank


def _rehydrate_knowledge_bank(bank) -> None:
    """Runs at most once per container lifetime (only when Chroma comes
    up empty) — refills the in-memory bank from the durable Supabase
    table so a Render restart doesn't erase everything Nova has ever
    looked up. Never allowed to break the request that triggered it: a
    Supabase hiccup here just means this cold start starts empty again,
    same as before this durability fix existed."""
    try:
        rows = (
            get_supabase()
            .table("NovaKnowledgeEntry")
            .select("id, query, content, source, created_at")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
            .data
        )
    except Exception:
        logger.exception("rehydrate_knowledge_bank: failed to read NovaKnowledgeEntry from Supabase")
        return
    if not rows:
        return
    _add_in_chunks(
        bank,
        documents=[r["content"] for r in rows],
        metadatas=[
            {"ts": _parse_supabase_ts(r["created_at"]), "query": r["query"], "category": r.get("source") or "general"}
            for r in rows
        ],
        ids=[r["id"] for r in rows],
    )
    logger.info("rehydrate_knowledge_bank: restored %d entries from Supabase after a cold start", len(rows))


def _solutions_bank():
    # ONE shared collection (across every user) of real CODE/GENERAL
    # question-answer pairs — the "tunnel" to a second bank the owner
    # asked for: separate from per-user private memory and from the
    # live-info cache above, indexed by query_type so a CODE question
    # retrieves worked coding precedent specifically, not an unrelated
    # general-chat answer.
    #
    # Same real ephemeral-disk bug _collection_for was fixed for, same
    # day (see that function's own docstring) — this shared bank never
    # got the rehydration _knowledge_bank() already had either.
    bank = _chroma_client.get_or_create_collection(name="nova_solutions_bank", embedding_function=_embedder)
    if bank.count() == 0:
        _rehydrate_solutions_bank(bank)
    return bank


def _rehydrate_solutions_bank(bank) -> None:
    """Rebuilds from NovaUsageLog using the exact same filter
    remember_shared applies when first storing an entry (CODE/GENERAL
    only, answer long enough to be a real worked solution) — so a
    restored bank contains exactly what would have been in it had the
    container never restarted, not a looser approximation."""
    try:
        rows = (
            get_supabase()
            .table("NovaUsageLog")
            .select("id, message, answer, queryType")
            .in_("queryType", ["CODE", "GENERAL"])
            .not_.is_("message", "null")
            .not_.is_("answer", "null")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
            .data
        )
    except Exception:
        logger.exception("rehydrate_solutions_bank: failed to read NovaUsageLog from Supabase")
        return
    rows = [r for r in rows if len(r.get("answer") or "") >= _MIN_SOLUTION_LENGTH]
    if not rows:
        return
    _add_in_chunks(
        bank,
        documents=[f"سؤال: {r['message']}\nإجابة: {r['answer']}" for r in rows],
        metadatas=[{"query_type": r["queryType"], "answer": r["answer"]} for r in rows],
        ids=[f"restored-{r['id']}" for r in rows],
    )
    logger.info("rehydrate_solutions_bank: restored %d worked solutions from Supabase after a cold start", len(rows))


# Below this length an "answer" is almost always a greeting/apology/error
# message, not a worked solution worth resurfacing to a future question —
# a cheap free quality filter given there's no budget for a real scoring
# model to judge every reply before deciding whether to keep it.
_MIN_SOLUTION_LENGTH = 40


def remember(user_id: str, message: str, answer: str) -> None:
    col = _collection_for(user_id)
    # Was f"{user_id}-{col.count()}" — safe when count() meant "this
    # user's own document count" in a per-user collection, but col.count()
    # now counts every user's documents in the shared collection, so two
    # concurrent requests (even for different users) could race on the
    # same total count and collide on the same id. A random suffix has
    # no such race.
    doc_id = f"{user_id}-{uuid.uuid4().hex}"
    col.add(
        documents=[f"سؤال سابق: {message}\nإجابة سابقة: {answer}"],
        ids=[doc_id],
        metadatas=[{"user_id": user_id}],
    )


def remember_shared(message: str, answer: str, query_type: str) -> None:
    """Indexes a real, already-answered CODE/GENERAL question into the
    shared solutions bank so any future user's similar question can
    retrieve it as worked precedent (see module docstring). LIVE_INFO
    isn't included here — that has its own freshness-aware knowledge
    bank above, and a stale cached fact re-surfacing as "precedent"
    would be actively wrong, not just unhelpful."""
    if query_type not in ("CODE", "GENERAL") or len(answer) < _MIN_SOLUTION_LENGTH:
        return
    bank = _solutions_bank()
    doc_id = f"s-{abs(hash(message))}-{int(time.time())}"
    bank.add(
        documents=[f"سؤال: {message}\nإجابة: {answer}"],
        # "answer" stored raw here (not just embedded in the document
        # text above) so recall_cached_answer below can return it
        # directly on a cache hit, without re-parsing "سؤال:...\nإجابة:..."
        # back apart — owner spec 2026-09-08 (Gemini architecture
        # review, "التخزين المؤقت الذكي"/semantic caching).
        metadatas=[{"query_type": query_type, "answer": answer}],
        ids=[doc_id],
    )


def _recall_solutions(query: str, query_type: str, n_results: int = 2) -> list[str]:
    bank = _solutions_bank()
    if bank.count() == 0:
        return []
    results = bank.query(
        query_texts=[query],
        n_results=min(n_results, bank.count()),
        where={"query_type": query_type},
    )
    docs = results.get("documents") or []
    return docs[0] if docs else []


# Owner spec, 2026-09-08 (Gemini architecture review): _recall_solutions
# above only ever hands a past answer to the model as extra CONTEXT — it
# still pays the full 45-95s CPU generation cost every time, since the
# model rewrites the answer from that context rather than reusing it
# verbatim. True semantic caching skips generation entirely on a
# near-duplicate question, which is the one lever that actually cuts
# the reported real latency (network hops between Vercel/Render/
# ModelScope are milliseconds by comparison — see the architecture
# reply this was requested alongside). Real evidence, not guessed: this
# risks returning a stale/wrong-context answer for a question that
# LOOKS similar but isn't (e.g. two different bugs with similar
# wording), so it's deliberately conservative — same CODE/GENERAL scope
# as the solutions bank (never LIVE_INFO, which already has its own
# distinct 6h-freshness cache), and a tight distance threshold.
#
# Threshold math: Chroma's default collection distance metric is
# squared L2. For roughly unit-length sentence embeddings (Chroma's
# bundled MiniLM ONNX model), squared L2 distance relates to cosine
# similarity as d² ≈ 2·(1 − cos_sim). A distance below 0.15 corresponds
# to cos_sim above ~0.925 — i.e. two questions phrased almost
# identically, not just topically related. This is a principled
# starting point based on how the embedding model behaves in general,
# not a live-measured value for THIS specific corpus — if real cache
# hits ever look wrong in practice, tighten this further; a missed
# cache hit only costs the normal generation time back, while a wrong
# one serves an incorrect answer, so err conservative.
_CACHE_MAX_DISTANCE = 0.15


def recall_cached_answer(query: str, query_type: str) -> str | None:
    """Returns a past answer to VERBATIM-reuse (skipping model
    inference entirely) if a near-duplicate question was already
    answered, or None if nothing is close enough — in which case the
    caller must generate a real answer as usual."""
    if query_type not in ("CODE", "GENERAL"):
        return None
    bank = _solutions_bank()
    if bank.count() == 0:
        return None
    results = bank.query(
        query_texts=[query],
        n_results=1,
        where={"query_type": query_type},
        include=["metadatas", "distances"],
    )
    metadatas = results.get("metadatas") or []
    distances = results.get("distances") or []
    if not metadatas or not metadatas[0] or not distances or not distances[0]:
        return None
    if distances[0][0] > _CACHE_MAX_DISTANCE:
        return None
    return metadatas[0][0].get("answer")


def recall(user_id: str, query: str, n_results: int = 3) -> list[str]:
    col = _collection_for(user_id)
    # No more min(n_results, col.count()) guard — col.count() now
    # counts every user's documents, not just this one's, and chroma
    # already returns however many actually match a `where` filter
    # (fewer than n_results, or none) without erroring — verified
    # directly against this exact chromadb version before relying on it.
    results = col.query(query_texts=[query], n_results=n_results, where={"user_id": user_id})
    return results["documents"][0] if results["documents"] else []


def _web_search_tavily(query: str, max_results: int) -> list[dict]:
    """Owner spec, 2026-09-12 ("ابحث عن api مجاني يحل لنا كل مشاكل
    البحث المباشر والوصول الحي للشبكة"): real research (not guessed)
    found Tavily — a real search API purpose-built for LLM agents, free
    (1,000 requests/month, NO credit card required to sign up — checked
    directly, not assumed after Brave Search API dropped its own
    card-free tier in Feb 2026). Tried FIRST now: unlike ddgs (which
    scrapes DuckDuckGo's HTML search and is confirmed blocked on
    Render's shared cloud IP — see this module's own docstring/history),
    this is a real, documented REST API call — no scraping, no IP
    reputation to get caught by. Returns [] (never raises) on any
    failure — including TAVILY_API_KEY simply not being configured yet
    — so ddgs/Instant-Answer below remain the real fallback chain,
    unchanged, exactly as before this existed."""
    if not TAVILY_API_KEY:
        return []
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {TAVILY_API_KEY}", "Content-Type": "application/json"},
            json={"query": query, "search_depth": "basic", "max_results": max_results},
            timeout=15,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return [{"title": r.get("title", ""), "body": r.get("content", "")} for r in results]
    except Exception as e:
        logger.info("web_search: Tavily call failed (%s) — falling back to ddgs/Instant Answer", e)
        return []


def _web_search_ddgs_blocking(query: str, max_results: int) -> list[dict]:
    with DDGS() as ddgs:
        return list(ddgs.text(query, max_results=max_results))


def _web_search_ddgs(query: str, max_results: int) -> list[dict]:
    """Owner report, 2026-09-13 (real evidence: a deep-thinking answer
    got zero reply, not even an error, well past a minute): ddgs's own
    default per-engine timeout (5s, verified in its installed source) is
    real, but `_search_sync` waits on a THREAD POOL across however many
    search engines its own "auto" backend tries, in batches — a slow or
    blocked engine can cost multiple multiples of that 5s before this
    call returns anything at all, worse now that deep_think.py may call
    this twice in one answer (once per search query the plan produced)
    ahead of the already-bounded final model call. Wrapped in the same
    real hard deadline used everywhere else in this project for exactly
    this failure shape (see app/concurrency.py) — 20s is generous given
    ddgs's own internal 5s default, and the caller (web_search below)
    already treats None/[] identically, falling through to the Instant
    Answer API next exactly as it always has."""
    return with_hard_deadline(_web_search_ddgs_blocking, query, max_results, timeout=20) or []


def _web_search_duckduckgo_instant_answer(query: str, max_results: int) -> list[dict]:
    """Owner report, 2026-09-12 (real complaint): asked Nova something
    needing live info, got a flat "I can't reach the live web" instead
    of a real answer. Real, already-anticipated cause (see the comment
    this function is a fallback for): ddgs scrapes DuckDuckGo's HTML
    search rather than calling an official API, and shared cloud IPs
    like Render's are a well-known target for that kind of scraping to
    get rate-limited/blocked — the model's honest "no live data" answer
    was very likely correct given what actually reached it (nothing),
    not a wiring bug.

    Real second attempt, not a guess: DuckDuckGo's own official Instant
    Answer JSON API (no key, no scraping, a real documented endpoint) —
    genuinely more limited (mostly infobox-style facts: definitions,
    disambiguation, some named entities; NOT general web results,
    prices, or news) but a real, different code path that can succeed
    when the scraping one is blocked. Tries AbstractText first (a real
    prose answer), then RelatedTopics (whatever it has) as a last
    resort — returns [] on anything else, same "let the caller admit
    it has no data" contract as the function above."""
    try:
        resp = requests.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
            timeout=8,
        )
        if not resp.ok:
            return []
        data = resp.json()
        if data.get("AbstractText"):
            return [{"title": data.get("Heading") or query, "body": data["AbstractText"]}]
        related = [t for t in data.get("RelatedTopics", []) if isinstance(t, dict) and t.get("Text")]
        return [{"title": query, "body": t["Text"]} for t in related[:max_results]]
    except Exception:
        return []


def web_search(query: str, max_results: int = 3) -> list[dict]:
    tavily_results = _web_search_tavily(query, max_results)
    if tavily_results:
        return tavily_results

    try:
        results = _web_search_ddgs(query, max_results)
        if results:
            return results
    except Exception:
        # A search-provider hiccup (rate limiting is common on shared
        # cloud IPs like Render's) should never take the whole chat
        # down — the council still answers from its own knowledge.
        # But it must never be invisible: without this log line, a
        # search that silently fails on every request looks identical
        # to one that never runs, and the model quietly starts
        # guessing/hallucinating "live" answers instead of admitting
        # it has no current data (exactly what showed up as fabricated
        # gold-price figures with wrong currency and raw LaTeX).
        logger.exception("web_search: ddgs failed for query: %s — trying the Instant Answer API fallback", query)

    fallback = _web_search_duckduckgo_instant_answer(query, max_results)
    if not fallback:
        logger.warning("web_search: both ddgs and the Instant Answer fallback returned nothing for: %s", query)
    return fallback


def _recall_knowledge(query: str, category: str, max_age_seconds: float) -> str | None:
    """Returns a still-fresh cached answer from the shared knowledge
    bank for a semantically similar past query in the same category
    (LIVE_INFO's raw price/date snippets and GENERAL's analyzed prose
    are shaped too differently, and go stale on too different a
    schedule, to share one lookup), or None if nothing fresh enough
    exists — in which case the caller must search live."""
    bank = _knowledge_bank()
    if bank.count() == 0:
        return None
    results = bank.query(query_texts=[query], n_results=1, where={"category": category})
    docs = results.get("documents") or []
    metas = results.get("metadatas") or []
    if not docs or not docs[0]:
        return None
    age = time.time() - float(metas[0][0].get("ts", 0))
    if age > max_age_seconds:
        return None
    return docs[0][0]


def _store_knowledge(query: str, content: str, category: str, domain: str = "GENERAL_KNOWLEDGE") -> str:
    """Owner spec, 2026-09-12 ("قواعد للنموذج كي لا يتخطاها... وظيفته
    التفكير وليس فقط البحث والتخزين... اذا وجد ان هذا الامر خطأ يقوم
    حينها باستبداله بالصحيح"): every write to Nova's knowledge bank —
    the same table merge_and_finetune.ipynb's cell 4ب folds into REAL
    training weights — now goes through knowledge_store.store_or_update,
    the one real chokepoint every writer (this reactive path,
    learn_now, gather_knowledge.py) shares: guardrail redaction, AND
    real reconciliation against whatever is already stored for the same
    question (confirm/replace/keep-both, decided by a real model call,
    not a blind re-insert every time). See that module's own docstring
    for the full reasoning.

    The in-memory Chroma copy below still gets the fresh content
    unconditionally for this container's own lifetime (a quick win for
    this same conversation) — the durable Supabase row is what actually
    matters for training quality, and that one IS properly deduplicated/
    corrected now; Chroma re-syncs from it cleanly on the next cold
    start regardless (_rehydrate_knowledge_bank)."""
    from app import knowledge_store

    result = knowledge_store.store_or_update(
        query, content, domain, category, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY, GROQ_MODEL
    )
    if result == "rejected_guardrails":
        logger.info("store_knowledge: rejected by guardrails (query=%s)", query)
        return result
    if result == "skipped_same":
        logger.info("store_knowledge: new finding just confirmed an existing entry, no change needed (query=%s)", query)
        return result

    bank = _knowledge_bank()
    doc_id = f"k-{abs(hash(query))}-{int(time.time())}"
    bank.add(documents=[content], metadatas=[{"ts": time.time(), "category": category, "query": query}], ids=[doc_id])
    return result


def build_context(user_id: str, message: str, query_type: str) -> str:
    parts: list[str] = []

    memory = recall(user_id, message)
    if memory:
        parts.append("ذاكرة سابقة مع هذا المستخدم:\n" + "\n---\n".join(memory))

    if query_type == "LIVE_INFO":
        cached = _recall_knowledge(message, "live_info", _KNOWLEDGE_MAX_AGE_SECONDS)
        if cached:
            parts.append("معلومات محفوظة حديثاً في بنك معلومات Nova (من بحث سابق قريب):\n" + cached)
        else:
            results = web_search(message)
            if results:
                # Stored as-is, never through analyze_knowledge — a
                # price/date has to stay exact, not paraphrased by a
                # second model.
                web_snippets = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)
                parts.append("نتائج بحث حية من الويب:\n" + web_snippets)
                # Real evidence, 2026-09-13 ("لا احد يستخدم ذكاء يستغرق
                # 5 دقائق للرد"): this write is pure bookkeeping for
                # FUTURE questions — it has zero bearing on the answer
                # this turn is about to generate from web_snippets
                # above — yet it used to block this exact reply on a
                # Supabase round-trip (up to 20s). Backgrounded so the
                # bank still fills in, without taxing this user's wait.
                threading.Thread(
                    target=_store_knowledge, args=(message, web_snippets, "live_info"), daemon=True
                ).start()
        return "\n\n".join(parts)

    # CODE/GENERAL: pull worked precedent from the shared solutions
    # bank (real past questions from EVERY user, not just this one)
    # instead of leaving these two query types with no retrieval
    # augmentation at all — this is what actually strengthens
    # execution/reasoning help beyond plain unaided generation.
    solutions = _recall_solutions(message, query_type)
    if solutions:
        parts.append("أمثلة سابقة مشابهة أُجيبت بنجاح من بنك حلول Nova المشترك:\n" + "\n---\n".join(solutions))

    # Owner spec, 2026-09-08: if Nova has neither this user's own past
    # memory nor shared worked precedent to draw on, it has no real
    # basis for this specific question at all — go research it live
    # instead of letting the model guess from its own weights alone,
    # the same "never fabricate" principle council.py's system prompt
    # already enforces for LIVE_INFO, extended to ordinary knowledge
    # gaps. A 30-day freshness window (vs. LIVE_INFO's 6 hours) since
    # an ordinary fact rarely goes stale the way a price does.
    if not memory and not solutions:
        cached = _recall_knowledge(message, "general", _GENERAL_KNOWLEDGE_MAX_AGE_SECONDS)
        if cached:
            parts.append("معلومة محفوظة في بنك معلومات Nova (من بحث سابق):\n" + cached)
        else:
            results = web_search(message)
            if results:
                raw_snippets = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)
                # Real evidence, 2026-09-13 ("لا احد يستخدم ذكاء يستغرق
                # 5 دقائق للرد"): this used to run analyze_knowledge
                # HERE, synchronously, before the user's own answer was
                # even generated — a full call to our own model
                # (~45-95s on this CPU-only free host, per
                # call_modelscope_specialist's own measured docstring),
                # then council.answer() below made a SECOND full call to
                # the same model to actually answer the user. Two heavy
                # sequential model calls for one reply, on top of
                # web_search's own up-to-~40s worst case, is exactly how
                # a text reply reaches minutes.
                #
                # Fix: hand the raw snippets straight into context, the
                # same treatment LIVE_INFO above already gets — the one
                # real answer call below is perfectly capable of reading
                # and understanding raw web results itself (that's the
                # whole point of "our own model must do the real
                # understanding", not a second preliminary pass). The
                # nicely-analyzed version is only useful for FUTURE
                # questions via the knowledge bank, so it now runs after
                # this reply is already on its way, off the critical path.
                parts.append("نتائج بحث حية من الويب (بيانات خام):\n" + raw_snippets)
                threading.Thread(
                    target=_analyze_and_store_general_knowledge, args=(message, raw_snippets), daemon=True
                ).start()

    return "\n\n".join(parts)


def _analyze_and_store_general_knowledge(message: str, raw_snippets: str) -> None:
    """Runs off the critical path (see build_context's own comment
    above) — never allowed to affect a live request, since nothing
    still waiting on it by the time this runs."""
    try:
        from app import council

        analyzed = council.analyze_knowledge(message, raw_snippets)
        _store_knowledge(message, analyzed, "general")
    except Exception:
        logger.exception("background analyze_and_store_general_knowledge failed for query=%s", message)


def learn_now(topic: str) -> str:
    """Owner spec, 2026-09-12 ("اذهب وابحث عن وسائل لتطوير قدراتك... وقم
    بتغذية نفسك بها... التنفيذ الفعلي... وليس مجرد رد دون تنفيذ"): the
    on-demand twin of build_context's own reactive search-and-store
    step above — same real actions (web_search, council.analyze_knowledge,
    the same guardrails-gated _store_knowledge), just triggered directly
    by an explicit owner command (council.py's LEARN intent) instead of
    as a side effect of answering an ordinary question. Returns a real
    status string ready to send straight back to the owner — never
    silent, so "لم أتخطَّ التنفيذ فعلياً" ["I didn't actually skip
    execution"] is something the owner can verify from the reply
    itself, not something they have to take on faith."""
    try:
        results = web_search(topic)
    except Exception:
        logger.exception("learn_now: web search failed for topic=%s", topic)
        return f"تعذّر البحث عن \"{topic}\" — حدث خطأ أثناء البحث الحي على الويب."
    if not results:
        return f"بحثت فعلاً عن \"{topic}\" لكن لم أجد أي نتائج حية مفيدة الآن — لم يُخزَّن شيء."

    raw_snippets = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)
    from app import council, guardrails

    analyzed = council.analyze_knowledge(topic, raw_snippets)
    safe_content = guardrails.sanitize_for_storage(analyzed)
    if safe_content is None:
        return f"بحثت فعلاً عن \"{topic}\" لكن ما وجدته لم يجتز فحص الأمان الداخلي — لم يُخزَّن شيء."

    result = _store_knowledge(topic, analyzed, "owner_directed")
    if result == "skipped_same":
        return f"بحثت فعلاً عن \"{topic}\" — ما وجدته يؤكد معرفة مخزَّنة لديّ مسبقاً، لا حاجة لتغيير شيء."
    verb = "حدّثت معرفة سابقة كانت غير دقيقة" if result == "updated" else "خزّنت معرفة جديدة"
    return (
        f"✅ بحثت فعلاً عن \"{topic}\" الآن و{verb} في بنك معرفتي "
        f"(سيُستخدم في التدريب الأسبوعي القادم على Kaggle):\n\n{safe_content[:600]}"
    )
