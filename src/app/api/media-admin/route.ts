import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramOwner } from "@/lib/verifyTelegramOwner";
import { recentErrors, selfTest, write } from "@/lib/mediaSafe";

export const dynamic = "force-dynamic";

const OWNER = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").trim();

function ownerOk(body?: any): boolean {
  const botToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const initData = String(body?.init_data || "");
  return verifyTelegramOwner(initData, botToken, OWNER);
}

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * GET — only the settings required by the public mini-app.
 * Operational bot_settings rows and aggregate admin analytics are never
 * returned from this public endpoint. Admin metrics are fetched through
 * /api/media-stats, which verifies Telegram initData.
 */
export async function GET(_req: NextRequest) {
  const db = await sb();
  const settings: Record<string, unknown> = {
    force_sub_channels: [],
    daily_limit_free: 8,
    daily_limit_share: 20,
    features: { party: true, clone: true, feed: true },
  };

  if (db) {
    const publicKeys = ["force_sub_channels", "daily_limit_free", "daily_limit_share", "features"];
    const { data: rows } = await db.from("bot_settings").select("key,value").in("key", publicKeys);
    for (const row of rows || []) {
      if (publicKeys.includes(String(row.key))) settings[row.key] = row.value;
    }
  }

  // No admin stats here. The owner dashboard loads verified metrics separately.
  return NextResponse.json({ settings, stats: {} }, { headers: { "cache-control": "no-store" } });
}

/** POST — admin actions: hide, unhide, broadcast, set_force_sub, set_limits */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!ownerOk(body)) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const action = String(body.action || "");
  const db = await sb();

  if (action === "hide" || action === "unhide") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (db) {
      const w = await write("feed hide", db.from("media_feed").update({ hidden: action === "hide" }).eq("id", id));
      if (!w.ok) return NextResponse.json({ error: w.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id, hidden: action === "hide" });
  }

  if (action === "set_force_sub") {
    const channels = Array.isArray(body.channels) ? body.channels.map(String).slice(0, 2) : [];
    if (db) {
      const w = await write("force sub save", db.from("bot_settings").upsert({ key: "force_sub_channels", value: channels, updated_at: new Date().toISOString() }));
      if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, channels });
  }

  if (action === "set_limits") {
    const free = Math.max(0, Math.min(1000, Math.floor(Number(body.daily_limit_free ?? 8))));
    const share = Math.max(0, Math.min(1000, Math.floor(Number(body.daily_limit_share ?? 20))));
    if (!Number.isFinite(free) || !Number.isFinite(share)) return NextResponse.json({ ok: false, error: "invalid limits" }, { status: 400 });
    if (db) {
      const w = await write("limits save", db.from("bot_settings").upsert([
        { key: "daily_limit_free", value: free, updated_at: new Date().toISOString() },
        { key: "daily_limit_share", value: share, updated_at: new Date().toISOString() },
      ]));
      if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, daily_limit_free: free, daily_limit_share: share });
  }

  if (action === "selftest") {
    if (!db) return NextResponse.json({ ok: false, error: "database not configured" });
    const checks = await selfTest(db);
    return NextResponse.json({ ok: checks.every((c) => c.ok), checks, errors: recentErrors().slice(0, 12) });
  }

  if (action === "recount") {
    if (!db) return NextResponse.json({ ok: false, error: "database not configured" });
    const [views, likes, feed] = await Promise.all([
      db.from("media_views").select("post_id,times").limit(200000),
      db.from("media_likes").select("post_id").limit(200000),
      db.from("media_feed").select("id,views,likes").limit(5000),
    ]);
    if (views.error || likes.error || feed.error) return NextResponse.json({ ok: false, error: (views.error || likes.error || feed.error)?.message });
    const v = new Map<string, number>(), l = new Map<string, number>();
    for (const row of views.data || []) v.set(String(row.post_id), (v.get(String(row.post_id)) || 0) + Number((row as any).times || 1));
    for (const row of likes.data || []) l.set(String(row.post_id), (l.get(String(row.post_id)) || 0) + 1);
    let fixed = 0;
    for (const post of feed.data || []) {
      const nv = v.get(String(post.id)) ?? 0, nl = l.get(String(post.id)) ?? 0;
      const patch: Record<string, number> = {};
      if (nv > Number(post.views || 0)) patch.views = nv;
      if (nl !== Number(post.likes || 0)) patch.likes = nl;
      if (Object.keys(patch).length) {
        const w = await write("recount", db.from("media_feed").update(patch).eq("id", post.id));
        if (w.ok) fixed++;
      }
    }
    return NextResponse.json({ ok: true, fixed });
  }

  if (action === "broadcast") {
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "BOT_TOKEN not set on Vercel", preview: text.slice(0, 200) });
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: OWNER, text: `📢 إذاعة (معاينة للمالك):\n\n${text}`, parse_mode: "HTML" }),
      });
      const j = await r.json();
      return NextResponse.json({ ok: !!j.ok, sent_to_owner: !!j.ok, note: "الإذاعة الكاملة لجميع المستخدمين تتم من لوحة البوت على Render (قائمة known_users). تم إرسال معاينة للمالك.", telegram: j });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
