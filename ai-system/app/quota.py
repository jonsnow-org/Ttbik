"""
Identity resolution + tiered daily/weekly-quota/subscription
enforcement against the shared NovaUser table. Mirrors the
ledger/quota patterns already used in src/lib/adBotLogic.ts (isolated
table, plain string status fields, no automated payment/checkout —
subscriptions start PENDING_APPROVAL and the owner flips them to
ACTIVE manually, same as this project's standing product rule against
auto-checkout).

Owner spec, 2026-09-08: every feature (text, vision, voice, files,
image generation) stays available to EVERY plan, including FREE —
plans only scale HOW MUCH of it you get per day/week, not WHICH
features you can reach at all. Images get a much stricter cap than
plain text everywhere (heavier to compute on our own free hardware),
and every plan also carries a weekly ceiling on top of its daily one —
the same shape the owner described Claude's own consumer plans using —
so a paid plan can't be hammered non-stop every single day. Pricing
below is a starting proposal (owner: "must be cheaper than yours,
mine's a beginner") — change the numbers here whenever the owner wants
a different price or limit; nothing else in the codebase needs to
change for that.
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.config import SUPER_ADMIN_TELEGRAM_ID
from app.supabase_client import get_supabase

PLANS: dict[str, dict] = {
    "FREE": {
        "label": "مجاني",
        "daily_text": 100,
        "daily_image": 3,
        "weekly_text": 600,
        "weekly_image": 18,
        "price_usd": 0.0,
    },
    "PRO_BASIC": {
        "label": "نوفا الأساسي",
        "daily_text": 500,
        "daily_image": 20,
        "weekly_text": 3000,
        "weekly_image": 120,
        "price_usd": 2.0,
    },
    "PRO_PLUS": {
        "label": "نوفا بلس",
        "daily_text": 2000,
        "daily_image": 60,
        "weekly_text": 12000,
        "weekly_image": 360,
        "price_usd": 4.0,
    },
    "PRO_ULTRA": {
        "label": "نوفا الكامل",
        "daily_text": 999_999,
        "daily_image": 999_999,
        "weekly_text": 999_999,
        "weekly_image": 999_999,
        "price_usd": 7.0,
    },
}


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


def effective_plan(user: dict) -> str:
    """A stale/expired paid plan silently behaves as FREE from here on —
    no separate "is it still active" check needed anywhere else."""
    plan = user.get("plan") or "FREE"
    if plan == "FREE" or plan not in PLANS:
        return "FREE"
    expires_at = user.get("subscriptionExpiresAt")
    if not expires_at or _parse_ts(expires_at) <= _now():
        return "FREE"
    return plan


def has_active_subscription(user: dict) -> bool:
    return effective_plan(user) != "FREE"


def check_and_reserve_quota(user: dict, kind: str = "TEXT") -> tuple[bool, int, str]:
    """Returns (allowed, remaining_after, message). kind is "TEXT" (chat/
    voice/file) or "IMAGE" (understand or generate — they share one
    cap). The platform owner skips every cap entirely; every other
    user, FREE included, is checked against their plan's daily AND
    weekly ceiling for that kind (see PLANS above) — daily resets each
    UTC day, weekly every 7 days, independently."""
    if SUPER_ADMIN_TELEGRAM_ID and str(user.get("telegramId")) == SUPER_ADMIN_TELEGRAM_ID:
        return True, -1, "مالك المنصة — بلا حد"

    plan = effective_plan(user)
    limits = PLANS[plan]
    is_image = kind == "IMAGE"
    daily_cap = limits["daily_image"] if is_image else limits["daily_text"]
    weekly_cap = limits["weekly_image"] if is_image else limits["weekly_text"]
    daily_field = "dailyUsedImage" if is_image else "dailyUsed"
    weekly_field = "weeklyUsedImage" if is_image else "weeklyUsedText"
    kind_label = "الصور" if is_image else "الرسائل"

    db = get_supabase()
    daily_reset_at = _parse_ts(user["dailyResetAt"])
    weekly_reset_at = _parse_ts(user.get("weeklyResetAt") or user["dailyResetAt"])
    daily_used = user.get(daily_field) or 0
    weekly_used = user.get(weekly_field) or 0

    if _now() - daily_reset_at > timedelta(days=1):
        daily_used = 0
        daily_reset_at = _now()
    if _now() - weekly_reset_at > timedelta(days=7):
        weekly_used = 0
        weekly_reset_at = _now()

    if daily_used >= daily_cap:
        return False, 0, f"انتهى حدك اليومي من {kind_label} ({daily_cap}) — أرسل /ترقية للاشتراك أو انتظر التصفير غداً."
    if weekly_used >= weekly_cap:
        return False, 0, f"انتهى حدك الأسبوعي من {kind_label} ({weekly_cap}) — أرسل /ترقية لرفع حدك."

    daily_used += 1
    weekly_used += 1
    db.table("NovaUser").update(
        {
            daily_field: daily_used,
            "dailyResetAt": daily_reset_at.isoformat(),
            weekly_field: weekly_used,
            "weeklyResetAt": weekly_reset_at.isoformat(),
        }
    ).eq("id", user["id"]).execute()
    remaining = daily_cap - daily_used
    return True, remaining, f"متبقٍ لك اليوم من {kind_label}: {remaining}"


def log_usage(user_id: str, channel: str, query_type: str, message: str | None = None, answer: str | None = None) -> str:
    # message/answer double as real training data for the Kaggle
    # notebook's scheduled LoRA fine-tuning run (fetched over Supabase's
    # REST API — see ai-system/colab/merge_and_finetune.ipynb), instead
    # of the old hand-typed placeholder example. Returns the row's own
    # id so the caller (main.py) can hand it back to novaBotLogic.ts,
    # which attaches it to the 👍/👎 feedback buttons on this exact
    # answer (see set_feedback below).
    db = get_supabase()
    log_id = str(uuid.uuid4())
    db.table("NovaUsageLog").insert(
        {
            "id": log_id,
            "novaUserId": user_id,
            "channel": channel,
            "queryType": query_type,
            "message": message,
            "answer": answer,
        }
    ).execute()
    return log_id


def set_feedback(log_id: str, rating: str) -> bool:
    """rating is "UP" or "DOWN" — a real thumbs-down here becomes the
    "rejected" half of a DPO preference pair (see
    ai-system/colab/build_dpo_dataset.py). Returns False if the log row
    doesn't exist (stale/tampered callback data), True otherwise."""
    if rating not in ("UP", "DOWN"):
        raise ValueError(f"invalid rating: {rating}")
    db = get_supabase()
    existing = db.table("NovaUsageLog").select("id").eq("id", log_id).limit(1).execute()
    if not existing.data:
        return False
    db.table("NovaUsageLog").update({"rating": rating}).eq("id", log_id).execute()
    return True


def request_subscription(user_id: str, plan: str) -> str:
    """Creates a PENDING_APPROVAL row — the owner approves it manually
    (no automated checkout), then flips status to ACTIVE and sets
    startedAt/expiresAt via the admin endpoints below (called from
    NOVA_BOT's own admin panel — see novaBotLogic.ts). plan must be one
    of PLANS' paid keys (PRO_BASIC/PRO_PLUS/PRO_ULTRA) — the price is
    always looked up from PLANS here, never trusted from the caller."""
    if plan not in PLANS or plan == "FREE":
        raise ValueError(f"unknown paid plan: {plan}")
    db = get_supabase()
    sub_id = str(uuid.uuid4())
    db.table("NovaSubscription").insert(
        {"id": sub_id, "novaUserId": user_id, "plan": plan, "amountUsd": PLANS[plan]["price_usd"]}
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
    plan_counts = {plan: 0 for plan in PLANS}
    for u in users.data:
        plan_counts[u.get("plan") if u.get("plan") in PLANS else "FREE"] += 1
    pending = db.table("NovaSubscription").select("id", count="exact").eq("status", "PENDING_APPROVAL").execute()
    pending_count = pending.count if pending.count is not None else len(pending.data)
    logs = db.table("NovaUsageLog").select("id", count="exact").execute()
    total_messages = logs.count if logs.count is not None else len(logs.data)
    return {
        "total_users": total_users,
        "plan_counts": plan_counts,
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
    db.table("NovaUser").update({"plan": sub["plan"], "subscriptionExpiresAt": expires.isoformat()}).eq(
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
