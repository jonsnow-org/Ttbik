"""
Owner spec, 2026-09-12 ("هو وظيفته التفكير وليس فقط البحث والتخزين...
اذا وجد ان هذا الامر خطأ يقوم حينها باستبداله بالصحيح... بنوك لا
تحصى... بحثه عن تغذية تخصه وتقوي نظامه في جميع المجالات"): the ONE real
chokepoint for every write to Nova's knowledge bank (NovaKnowledgeEntry)
— reactive (rag.py's build_context), on-demand (rag.learn_now), and
proactive/scheduled (scripts/gather_knowledge.py) all funnel through
this single function now, so the same real behavior applies everywhere
identically: guardrail redaction (guardrails.py) AND real
reconciliation against what's already stored, not four slightly
different copies of similar logic.

"بنوك لا تحصى" — real, stated-plainly design decision: a genuinely
unlimited number of PHYSICAL database tables would be unmaintainable
and buys nothing a single well-indexed table doesn't already give for
free (Postgres handles millions of rows without issue). What actually
delivers "countless organized banks that never fill up or blur
together" is a real, broad DOMAIN taxonomy (DOMAINS below) tagged on
every entry — callers doing proactive/self-directed research are
expected to rotate across ALL of these, not repeatedly deepen one.

Real "thinking, not just storing": before inserting anything new,
store_or_update checks whether an entry already exists for the same
real question. If one does, a real model call decides:
  - SAME: the new finding just reconfirms the old one — skip, no
    duplicate created.
  - UPDATE: the new finding corrects/refines the old one — the OLD row
    is overwritten in place, not duplicated alongside a now-wrong one.
  - DIFFERENT: a genuinely separate fact about a related question —
    stored as its own new entry (Supabase's real primary key here is
    "id", not "query" — multiple rows sharing the same query text is
    fine).
This is the real fix for a knowledge bank that only ever grows and
never corrects itself.

Deliberately built on plain `requests` (no supabase-py client, no
groq SDK) so this is importable identically from the heavy FastAPI
process (rag.py) AND a lightweight standalone script running on a bare
GitHub Actions runner (scripts/gather_knowledge.py) with none of this
project's other dependencies installed.
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

import requests

from app import guardrails

logger = logging.getLogger("nova")

# A real, broad taxonomy spanning every real capability area this
# project actually has — not a guess. Proactive/self-directed research
# (gather_knowledge.py, self_improve.py) is expected to rotate across
# ALL of these over time so the bank grows broad, not narrow.
DOMAINS = [
    "IMAGE_GEN",
    "VIDEO_GEN",
    "AUDIO_GEN",
    "LIVE_SEARCH",
    "CODE_DEV",
    "SECURITY",
    "CONVERSATION_QUALITY",
    "GENERAL_KNOWLEDGE",
]

_RECONCILE_PROMPT = (
    "لديك معلومة مخزَّنة سابقاً حول سؤال/موضوع معيّن، ومعلومة جديدة وردت الآن حول نفس السؤال تقريباً. "
    "قارن بينهما بعناية وأجب حصراً بصيغة JSON صحيحة بدون أي نص إضافي:\n"
    '{{"action": "SAME أو UPDATE أو DIFFERENT", "merged_content": "النص النهائي المحدَّث إن كان UPDATE فقط، وإلا فارغ"}}\n\n'
    "SAME = الجديدة تؤكد القديمة بلا تغيير جوهري.\n"
    "UPDATE = الجديدة تصحح أو تحدّث القديمة (نفس السؤال، معلومة مختلفة/أدق/أحدث) — استبدل القديمة بالكامل.\n"
    "DIFFERENT = الجديدة عن جانب مختلف فعلياً من نفس الموضوع العام، يجب تخزينها كإدخال مستقل.\n\n"
    "القديمة:\n{old_content}\n\nالجديدة:\n{new_content}"
)


def _groq_call(prompt: str, groq_api_key: str, groq_model: str) -> str:
    if not groq_api_key:
        return ""
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {groq_api_key}"},
            json={"model": groq_model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 400},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.info("knowledge_store: reconciliation Groq call failed (%s)", e)
        return ""


def _parse_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def _headers(supabase_key: str) -> dict:
    return {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json"}


def store_or_update(
    query: str,
    content: str,
    domain: str,
    source: str,
    supabase_url: str,
    supabase_key: str,
    groq_api_key: str,
    groq_model: str = "openai/gpt-oss-120b",
) -> str:
    """Returns one of: "inserted", "updated", "skipped_same",
    "rejected_guardrails". Every real writer to Nova's knowledge bank
    calls this — never inserts directly."""
    safe_content = guardrails.sanitize_for_storage(content)
    if safe_content is None:
        return "rejected_guardrails"

    headers = _headers(supabase_key)
    base = supabase_url.rstrip("/")
    try:
        existing_resp = requests.get(
            f"{base}/rest/v1/NovaKnowledgeEntry",
            headers=headers,
            params={"select": "id,content", "query": f"eq.{query}", "limit": "1"},
            timeout=20,
        )
        existing = existing_resp.json() if existing_resp.ok else []
    except Exception:
        logger.exception("knowledge_store: existing-entry lookup failed (query=%s)", query)
        existing = []

    if not existing:
        try:
            requests.post(
                f"{base}/rest/v1/NovaKnowledgeEntry",
                headers=headers,
                json={
                    "id": f"k-{uuid.uuid4().hex[:12]}",
                    "query": query,
                    "content": safe_content,
                    "source": source,
                    "domain": domain,
                },
                timeout=20,
            )
        except Exception:
            logger.exception("knowledge_store: insert failed (query=%s)", query)
        return "inserted"

    old_row = existing[0]
    raw = _groq_call(
        _RECONCILE_PROMPT.format(old_content=old_row.get("content", ""), new_content=safe_content),
        groq_api_key,
        groq_model,
    )
    decision = _parse_json(raw)
    action = str(decision.get("action") or "DIFFERENT").strip().upper()

    if action == "SAME":
        return "skipped_same"

    if action == "UPDATE":
        merged = str(decision.get("merged_content") or "").strip()
        merged_safe = guardrails.sanitize_for_storage(merged) if merged else None
        final_content = merged_safe or safe_content
        try:
            requests.patch(
                f"{base}/rest/v1/NovaKnowledgeEntry",
                headers=headers,
                params={"id": f"eq.{old_row['id']}"},
                json={"content": final_content, "created_at": datetime.now(timezone.utc).isoformat()},
                timeout=20,
            )
        except Exception:
            logger.exception("knowledge_store: update failed (id=%s)", old_row["id"])
        return "updated"

    # DIFFERENT — a genuinely separate fact, stored as its own new row.
    try:
        requests.post(
            f"{base}/rest/v1/NovaKnowledgeEntry",
            headers=headers,
            json={
                "id": f"k-{uuid.uuid4().hex[:12]}",
                "query": query,
                "content": safe_content,
                "source": source,
                "domain": domain,
            },
            timeout=20,
        )
    except Exception:
        logger.exception("knowledge_store: insert (DIFFERENT branch) failed (query=%s)", query)
    return "inserted"
