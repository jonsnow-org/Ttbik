"""
Identity resolution + daily-quota/subscription enforcement against the
shared NovaUser table. Mirrors the ledger/quota patterns already used
in src/lib/adBotLogic.ts (isolated table, plain string status fields,
no automated payment/checkout — subscriptions start PENDING_APPROVAL
and the owner flips them to ACTIVE manually, same as this project's
standing product rule against auto-checkout).
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.config import FREE_DAILY_QUOTA, SUPER_ADMIN_TELEGRAM_ID
from app.supabase_client import get_supabase


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: str) -> datetime:
    """Parses a Postgres timestamp string from Supabase into a
    timezone-AWARE datetime. NovaUser.dailyResetAt/subscriptionExpiresAt
    are `TIMESTAMP(3)` columns (no time zone) — Supabase returns those
    as naive ISO strings with no "Z"/offset at all, so the old
    `.replace("Z", "+00:00")` was a no-op and datetime.fromisoformat()
    silently produced a naive datetime. Subtracting/comparing that
    against `_now()` (aware) then raised "can't subtract offset-naive
    and offset-aware datetimes" on every single request. Assume UTC for
    any naive value, since that's what CURRENT_TIMESTAMP stores."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def resolve_or_create_user(
    channel: str, telegram_id: str | None = None, email: str | None = None, api_key: str | None = None
) -> dict:
    """channel is one of TELEGRAM | WEB | API — picks the matching identity column."""
    db = get_supabase()

    if channel == "API":
        if not api_key:
            raise ValueError("API channel requires an apiKey")
        res = db.table("NovaUser").select("*").eq("apiKey", api_key).limit(1).execute()
        if not res.data:
            raise ValueError("invalid apiKey")
        return res.data[0]

    if channel == "TELEGRAM":
        if not telegram_id:
            raise ValueError("TELEGRAM channel requires telegram_id")
        res = db.table("NovaUser").select("*").eq("telegramId", telegram_id).limit(1).execute()
        if res.data:
            return res.data[0]
        new_row = {"id": str(uuid.uuid4()), "telegramId": telegram_id}
        return db.table("NovaUser").insert(new_row).execute().data[0]

    if channel == "WEB":
        if not email:
            raise ValueError("WEB channel requires email")
        res = db.table("NovaUser").select("*").eq("email", email).limit(1).execute()
        if res.data:
            return res.data[0]
        new_row = {"id": str(uuid.uuid4()), "email": email}
        return db.table("NovaUser").insert(new_row).execute().data[0]

    raise ValueError(f"unknown channel: {channel}")


def has_active_subscription(user: dict) -> bool:
    if user.get("plan") != "PRO":
        return False
    expires_at = user.get("subscriptionExpiresAt")
    if not expires_at:
        return False
    return _parse_ts(expires_at) > _now()


def check_and_reserve_quota(user: dict) -> tuple[bool, int, str]:
    """Returns (allowed, remaining_after, message). The platform owner
    and PRO users skip the daily cap entirely. FREE users reset at
    each new UTC day."""
    if SUPER_ADMIN_TELEGRAM_ID and str(user.get("telegramId")) == SUPER_ADMIN_TELEGRAM_ID:
        return True, -1, "مالك المنصة — بلا حد يومي"
    if has_active_subscription(user):
        return True, -1, "PRO — بلا حد يومي"

    db = get_supabase()
    reset_at = _parse_ts(user["dailyResetAt"])
    used = user["dailyUsed"]

    if _now() - reset_at > timedelta(days=1):
        used = 0
        reset_at = _now()

    if used >= FREE_DAILY_QUOTA:
        return False, 0, "انتهى حدك المجاني اليومي — أرسل /ترقية للاشتراك في الخطة المدفوعة لاستخدام غير محدود."

    used += 1
    db.table("NovaUser").update({"dailyUsed": used, "dailyResetAt": reset_at.isoformat()}).eq(
        "id", user["id"]
    ).execute()
    return True, FREE_DAILY_QUOTA - used, f"متبقٍ لك اليوم: {FREE_DAILY_QUOTA - used} رسالة"


def log_usage(user_id: str, channel: str, query_type: str, message: str | None = None, answer: str | None = None) -> None:
    # message/answer double as real training data for the Kaggle
    # notebook's scheduled LoRA fine-tuning run (fetched over Supabase's
    # REST API — see ai-system/colab/merge_and_finetune.ipynb), instead
    # of the old hand-typed placeholder example.
    db = get_supabase()
    db.table("NovaUsageLog").insert(
        {
            "id": str(uuid.uuid4()),
            "novaUserId": user_id,
            "channel": channel,
            "queryType": query_type,
            "message": message,
            "answer": answer,
        }
    ).execute()


def request_subscription(user_id: str, plan: str = "PRO_MONTHLY", amount_usd: float = 5.0) -> str:
    """Creates a PENDING_APPROVAL row — the owner approves it manually
    (no automated checkout), then flips status to ACTIVE and sets
    startedAt/expiresAt via the admin endpoints below (called from
    NOVA_BOT's own admin panel — see novaBotLogic.ts)."""
    db = get_supabase()
    sub_id = str(uuid.uuid4())
    db.table("NovaSubscription").insert(
        {"id": sub_id, "novaUserId": user_id, "plan": plan, "amountUsd": amount_usd}
    ).execute()
    return sub_id


# ---------------------------------------------------------------------
# Admin panel (owner report, 2026-09-06: NOVA_BOT had no way for the
# owner to see usage or act on a subscription request short of opening
# Supabase's table editor by hand — every other bot template on this
# platform has a real in-bot admin panel). Auth for these is the same
# X-Internal-Secret check every other endpoint already uses (main.py) —
# only Ttbik's own server calls these, gated further there by checking
# the caller's Telegram id against SUPER_ADMIN_TELEGRAM_ID before it
# ever reaches here.
# ---------------------------------------------------------------------


def get_admin_stats() -> dict:
    db = get_supabase()
    users = db.table("NovaUser").select("id, plan", count="exact").execute()
    total_users = users.count if users.count is not None else len(users.data)
    pro_users = sum(1 for u in users.data if u.get("plan") == "PRO")
    pending = db.table("NovaSubscription").select("id", count="exact").eq("status", "PENDING_APPROVAL").execute()
    pending_count = pending.count if pending.count is not None else len(pending.data)
    logs = db.table("NovaUsageLog").select("id", count="exact").execute()
    total_messages = logs.count if logs.count is not None else len(logs.data)
    return {
        "total_users": total_users,
        "pro_users": pro_users,
        "free_users": total_users - pro_users,
        "pending_subscriptions": pending_count,
        "total_messages": total_messages,
    }


def list_pending_subscriptions(limit: int = 20) -> list[dict]:
    db = get_supabase()
    subs = (
        db.table("NovaSubscription")
        .select("id, novaUserId, plan, amountUsd, created_at")
        .eq("status", "PENDING_APPROVAL")
        .order("created_at")
        .limit(limit)
        .execute()
        .data
    )
    if not subs:
        return []
    # Two queries instead of a PostgREST embed (db.table(...).select("...,
    # NovaUser(...)")) — simpler and doesn't depend on how the Supabase
    # project's foreign-key introspection happens to be configured.
    user_ids = list({s["novaUserId"] for s in subs})
    users = db.table("NovaUser").select("id, telegramId, email").in_("id", user_ids).execute().data
    users_by_id = {u["id"]: u for u in users}
    for s in subs:
        u = users_by_id.get(s["novaUserId"], {})
        s["telegramId"] = u.get("telegramId")
        s["email"] = u.get("email")
    return subs


def _find_pending_subscription(sub_id: str) -> dict | None:
    res = get_supabase().table("NovaSubscription").select("*").eq("id", sub_id).eq("status", "PENDING_APPROVAL").limit(1).execute()
    return res.data[0] if res.data else None


def approve_subscription(sub_id: str, approved_by: str, days: int = 30) -> dict | None:
    """Returns the affected NovaUser's telegramId/email (for the caller
    to notify them), or None if the subscription doesn't exist or was
    already decided."""
    db = get_supabase()
    sub = _find_pending_subscription(sub_id)
    if not sub:
        return None
    now = _now()
    expires = now + timedelta(days=days)
    db.table("NovaSubscription").update(
        {"status": "ACTIVE", "approvedBy": approved_by, "startedAt": now.isoformat(), "expiresAt": expires.isoformat()}
    ).eq("id", sub_id).execute()
    db.table("NovaUser").update({"plan": "PRO", "subscriptionExpiresAt": expires.isoformat()}).eq(
        "id", sub["novaUserId"]
    ).execute()
    user_res = db.table("NovaUser").select("telegramId, email").eq("id", sub["novaUserId"]).limit(1).execute()
    user = user_res.data[0] if user_res.data else {}
    return {"telegramId": user.get("telegramId"), "email": user.get("email")}


def reject_subscription(sub_id: str) -> dict | None:
    db = get_supabase()
    sub = _find_pending_subscription(sub_id)
    if not sub:
        return None
    db.table("NovaSubscription").update({"status": "EXPIRED"}).eq("id", sub_id).execute()
    user_res = db.table("NovaUser").select("telegramId, email").eq("id", sub["novaUserId"]).limit(1).execute()
    user = user_res.data[0] if user_res.data else {}
    return {"telegramId": user.get("telegramId"), "email": user.get("email")}


def list_telegram_user_ids() -> list[str]:
    res = get_supabase().table("NovaUser").select("telegramId").not_.is_("telegramId", "null").execute()
    return [r["telegramId"] for r in res.data if r.get("telegramId")]
