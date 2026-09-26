"""Media-bot paid upgrade: verifies an order code against the site's own
services/orders tables (owner decision -- reuse the site's existing
paid-service + manual-approval flow instead of inventing a second one)."""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

DEFAULT_SECRET = "8452320"


def _secret() -> str:
    return (os.getenv("FEED_SECRET") or os.getenv("ADMIN_PASSWORD") or DEFAULT_SECRET).strip()


def _api_url() -> str:
    # Swaps FEED_API_URL's trailing /api/media-feed for /api/media-bot/
    # verify-premium, so this reuses the one env var already configured
    # for services/feed.py instead of needing a second one set on Render.
    base = (os.getenv("FEED_API_URL") or "https://ttbik.vercel.app/api/media-feed").rstrip("/")
    base = base.rsplit("/api/", 1)[0]
    return f"{base}/api/media-bot/verify-premium"


async def verify_premium_code(order_code: str, tg_user_id: int) -> tuple[bool, str]:
    order_code = (order_code or "").strip()
    if not order_code:
        return False, "الرجاء إرسال رمز الطلب بعد الأمر، مثال:\n/premium ABC123"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                _api_url(),
                json={"orderCode": order_code, "tgUserId": str(tg_user_id)},
                headers={"x-feed-secret": _secret(), "content-type": "application/json"},
            )
            data = r.json() if r.content else {}
            if r.status_code == 200 and data.get("unlocked"):
                return True, "✅ تم تفعيل الترقية المدفوعة بنجاح! حدك اليومي أعلى الآن."
            return False, data.get("error") or "رمز الطلب غير صالح أو لم تتم الموافقة عليه بعد."
    except Exception as e:
        logger.warning("premium verify failed: %s", e)
        return False, "تعذّر التحقق من الرمز حالياً، حاول لاحقاً."


def _sync_api_url() -> str:
    return _api_url().rsplit("/verify-premium", 1)[0] + "/sync-premium"


async def sync_premium_grant(tg_user_id: int, source: str) -> None:
    """Mirrors a premium grant made outside the order-code flow (e.g. a
    Telegram Stars payment, handled entirely locally via
    store.set_premium()) into the site's media_premium_users table, so it's
    visible outside this bot process -- the admin panel, and any future
    mini-app feature that checks premium status (owner concern, 2026-09-26).
    Best-effort only: the local grant already happened and must not depend
    on this call succeeding."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                _sync_api_url(),
                json={"tgUserId": str(tg_user_id), "source": source},
                headers={"x-feed-secret": _secret(), "content-type": "application/json"},
            )
    except Exception as e:
        logger.warning("premium sync failed: %s", e)
