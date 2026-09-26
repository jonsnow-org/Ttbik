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
 * Bot-facing endpoint the media bot calls right after granting premium
 * locally via store.set_premium() (any source — a Telegram Stars payment
 * today, in main.py's successful_payment_callback). Mirrors that grant into
 * media_premium_users so it's visible outside the bot process — the site's
 * admin panel, and any future mini-app feature that needs to check premium
 * status (owner concern, 2026-09-26: a payment made in the bot must not be
 * invisible everywhere else). The bot's own local grant is what actually
 * enforces the daily limit; this call is a best-effort mirror, never a
 * dependency for the upgrade to work.
 */
export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { tgUserId, source } = await req.json().catch(() => ({}));
  if (typeof tgUserId !== "string" || !tgUserId.trim()) {
    return NextResponse.json({ ok: false, error: "بيانات ناقصة" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("media_premium_users")
    .upsert({ tg_user_id: tgUserId.trim(), source: typeof source === "string" && source.trim() ? source.trim() : "unknown" });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
