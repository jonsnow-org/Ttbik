import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DEFAULT_SECRET = "8452320";

function secretOk(req: NextRequest): boolean {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || DEFAULT_SECRET).trim();
  const got = (req.headers.get("x-feed-secret") || "").trim();
  return !!expected && got === expected;
}

/**
 * Bot-facing endpoint for the media-bot's "/premium <code>" upgrade path.
 * Mirrors the order-code-unlock trust model already used by /api/tools/verify
 * (an approved order for the right service = unlocked), plus a one-time
 * claim (redeemed_by_tg_id) so the same $5 order code can't be shared
 * publicly to unlock premium for an unlimited number of Telegram accounts.
 */
export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ unlocked: false, error: "unauthorized" }, { status: 401 });
  }

  const { orderCode, tgUserId } = await req.json().catch(() => ({}));
  if (typeof orderCode !== "string" || !orderCode.trim() || typeof tgUserId !== "string" || !tgUserId.trim()) {
    return NextResponse.json({ unlocked: false, error: "بيانات ناقصة" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: order } = await db
    .from("orders")
    .select("id, status, redeemed_by_tg_id, services(slug)")
    .eq("order_code", orderCode.trim().toUpperCase())
    .single();

  const service = order?.services as unknown as { slug: string | null } | null;
  const isPremiumOrder = order?.status === "approved" && service?.slug === "media-bot-premium";

  if (!order || !isPremiumOrder) {
    return NextResponse.json(
      { unlocked: false, error: "رمز الطلب غير صالح أو لم تتم الموافقة عليه بعد" },
      { status: 403 }
    );
  }

  if (order.redeemed_by_tg_id && order.redeemed_by_tg_id !== tgUserId.trim()) {
    return NextResponse.json(
      { unlocked: false, error: "رمز الطلب مُفعّل مسبقاً على حساب تليجرام آخر" },
      { status: 403 }
    );
  }

  if (!order.redeemed_by_tg_id) {
    // Atomic claim: only succeeds if still unclaimed, so two concurrent
    // /premium calls with the same fresh code can't both "win" for
    // different accounts.
    const { data: claimed } = await db
      .from("orders")
      .update({ redeemed_by_tg_id: tgUserId.trim() })
      .eq("id", order.id)
      .is("redeemed_by_tg_id", null)
      .select("id")
      .maybeSingle();

    if (!claimed) {
      return NextResponse.json(
        { unlocked: false, error: "رمز الطلب مُفعّل مسبقاً على حساب تليجرام آخر" },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ unlocked: true });
}
