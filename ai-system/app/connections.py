"""
Owner spec, 2026-09-13 ("نظام الربط الحقيقي... يضيف نوفا لمواقعه كما
اضفتك انا لمواقعي... لااريد ان يكون كل مستخدم يكتب في البوت اذهب ونفذ
كذا فيقوم بالتنفيذ"): the real trust boundary the owner described,
made literal as a database table. Nova can act on an external
repo/site ONLY if a row exists here naming exactly which service,
whose account, and what credential — there is no code path anywhere
in this project that reads a GitHub/Vercel token from a chat message,
an env var per user, or anywhere else. No row, no access.

Real security design decision, stated plainly rather than glossed
over: a credential is added through a PRIVATE WEB PAGE
(src/app/nova/connections/page.tsx, gated the same way
src/app/nova/dashboard already is — an unguessable NovaUser UUID as the
bearer credential), never by pasting a token into a Telegram message.
This is not caution for its own sake — it is a real, already-existing
leak this project would otherwise walk straight into: EVERY ordinary
chat message goes through council.classify_intent (sent to Groq, a
third party) and then quota.log_usage, which durably stores message
text into NovaUsageLog — the exact table
ai-system/colab/merge_and_finetune.ipynb's cell 4 feeds into next
week's training corpus. A token pasted in chat would be forwarded to
Groq AND baked into training data. Routing credentials through their
own dedicated, un-logged web form (src/app/api/nova/connections/route.ts)
avoids both exposures entirely, by construction, not by hoping
guardrails.py catches it after the fact.

Deliberately built on plain `requests` (no supabase-py client) so this
imports cleanly everywhere in this codebase with no extra dependency —
same real reason knowledge_store.py made the identical choice.
"""
import logging
import uuid
from datetime import datetime, timezone

import requests

logger = logging.getLogger("nova")

# Real, tested services only — see dev_agent.py (github) and any future
# vercel_agent.py. Adding a new service means adding real code that
# knows how to act with that service's credential, not just a string
# here.
SUPPORTED_SERVICES = ("github",)


class ConnectionError_(Exception):
    """Distinct name from the stdlib's own ConnectionError — raised for
    a real problem with a connection itself (not found, wrong service,
    revoked), never for the underlying GitHub/Vercel call, which raises
    its own module's error type (e.g. dev_agent.DevAgentError)."""


def _headers(supabase_key: str) -> dict:
    return {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json"}


def list_connections(user_id: str, supabase_url: str, supabase_key: str) -> list[dict]:
    """Every ACTIVE connection for this user — never includes the raw
    credential value; callers that need to actually act on a connection
    use get_connection below instead. This is what a "ما هي مواقعي
    المربوطة؟" reply is built from."""
    try:
        resp = requests.get(
            f"{supabase_url.rstrip('/')}/rest/v1/NovaConnection",
            headers=_headers(supabase_key),
            params={"select": "id,service,label,created_at", "novaUserId": f"eq.{user_id}", "status": "eq.ACTIVE"},
            timeout=20,
        )
        return resp.json() if resp.ok else []
    except Exception:
        logger.exception("connections: list_connections failed for user_id=%s", user_id)
        return []


def get_connection(user_id: str, service: str, supabase_url: str, supabase_key: str) -> dict | None:
    """The ONE real credential a caller (e.g. a generalized dev_agent
    call) needs to act on this user's own external repo/site. Returns
    None for "not connected" — every caller must treat that as "cannot
    act here", never fall back to this project's own env-var
    credentials, or a user's chat command would silently start acting
    on the OWNER's repo instead of failing honestly."""
    try:
        resp = requests.get(
            f"{supabase_url.rstrip('/')}/rest/v1/NovaConnection",
            headers=_headers(supabase_key),
            params={
                "select": "id,service,label,credential,baseBranch",
                "novaUserId": f"eq.{user_id}",
                "service": f"eq.{service}",
                "status": "eq.ACTIVE",
                "limit": "1",
            },
            timeout=20,
        )
        rows = resp.json() if resp.ok else []
        return rows[0] if rows else None
    except Exception:
        logger.exception("connections: get_connection failed for user_id=%s service=%s", user_id, service)
        return None


def save_connection(
    user_id: str, service: str, label: str, credential: str, base_branch: str | None,
    supabase_url: str, supabase_key: str,
) -> str:
    """Called ONLY from src/app/api/nova/connections/route.ts (the
    private web form) — never from anything that touches Telegram/Groq.
    Returns the new connection's id."""
    if service not in SUPPORTED_SERVICES:
        raise ConnectionError_(f"الخدمة '{service}' غير مدعومة بعد — المدعومة حالياً: {', '.join(SUPPORTED_SERVICES)}")
    connection_id = f"conn-{uuid.uuid4().hex[:12]}"
    requests.post(
        f"{supabase_url.rstrip('/')}/rest/v1/NovaConnection",
        headers=_headers(supabase_key),
        json={
            "id": connection_id,
            "novaUserId": user_id,
            "service": service,
            "label": label,
            "credential": credential,
            "baseBranch": base_branch,
        },
        timeout=20,
    ).raise_for_status()
    return connection_id


def revoke_connection(connection_id: str, user_id: str, supabase_url: str, supabase_key: str) -> bool:
    """Scoped to (connection_id AND novaUserId) together on purpose —
    without the ownership check here too, the API route's own check
    would be the only thing standing between one user and revoking
    another user's connection by guessing an id."""
    resp = requests.patch(
        f"{supabase_url.rstrip('/')}/rest/v1/NovaConnection",
        headers=_headers(supabase_key),
        params={"id": f"eq.{connection_id}", "novaUserId": f"eq.{user_id}"},
        json={"status": "REVOKED", "revoked_at": datetime.now(timezone.utc).isoformat()},
        timeout=20,
    )
    return resp.ok
