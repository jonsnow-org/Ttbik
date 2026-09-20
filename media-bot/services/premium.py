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
