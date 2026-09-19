import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_SECRET = "8452320";
const OWNER = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").trim();

function secretOk(req: NextRequest): boolean {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || DEFAULT_SECRET).trim();
  const got = (req.headers.get("x-feed-secret") || "").trim();
  return !!expected && got === expected;
}

function ownerOk(req: NextRequest, body?: any): boolean {
  const uid = String(body?.owner_id || req.headers.get("x-owner-id") || "").trim();
  return uid && uid === OWNER;
}

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** GET — public settings + admin stats */
export async function GET(req: NextRequest) {
  const db = await sb();
  const settings: Record<string, unknown> = {
    force_sub_channels: [],
    daily_limit_free: 8,
    daily_limit_share: 20,
    features: { party: true, clone: true, feed: true },
  };
  let stats = { posts: 0, hidden: 0, clones: 0, publishers: 0 };

  if (db) {
    const { data: rows } = await db.from("bot_settings").select("key,value");
    for (const r of rows || []) {
      settings[r.key] = r.value;
    }
    const { data: feed } = await db.from("media_feed").select("id,clones,sharer_id,hidden");
    if (feed) {
      stats.posts = feed.filter((x: any) => !x.hidden).length;
      stats.hidden = feed.filter((x: any) => x.hidden).length;
      stats.clones = feed.reduce((a: number, b: any) => a + Number(b.clones || 0), 0);
      stats.publishers = new Set(feed.map((x: any) => x.sharer_id)).size;
    }
  }

  return NextResponse.json({ settings, stats });
}

/** POST — admin actions: hide, unhide, broadcast, set_force_sub, set_limits */
export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!ownerOk(req, body)) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const action = String(body.action || "");
  const db = await sb();

  if (action === "hide" || action === "unhide") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (db) {
      const { error } = await db
        .from("media_feed")
        .update({ hidden: action === "hide" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id, hidden: action === "hide" });
  }

  if (action === "set_force_sub") {
    const channels = Array.isArray(body.channels)
      ? body.channels.map(String).slice(0, 2)
      : [];
    if (db) {
      await db.from("bot_settings").upsert({
        key: "force_sub_channels",
        value: channels,
        updated_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true, channels });
  }

  if (action === "set_limits") {
    const free = Number(body.daily_limit_free ?? 8);
    const share = Number(body.daily_limit_share ?? 20);
    if (db) {
      await db.from("bot_settings").upsert([
        { key: "daily_limit_free", value: free, updated_at: new Date().toISOString() },
        { key: "daily_limit_share", value: share, updated_at: new Date().toISOString() },
      ]);
    }
    return NextResponse.json({ ok: true, daily_limit_free: free, daily_limit_share: share });
  }

  if (action === "broadcast") {
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) {
      return NextResponse.json({
        ok: false,
        error: "BOT_TOKEN not set on Vercel — add it to enable broadcast from TMA",
        preview: text.slice(0, 200),
      });
    }
    // Send to owner first as preview delivery; full fanout needs user list from bot store
    const ownerId = OWNER;
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: ownerId,
          text: `📢 إذاعة (معاينة للمالك):\n\n${text}`,
          parse_mode: "HTML",
        }),
      });
      const j = await r.json();
      return NextResponse.json({
        ok: !!j.ok,
        sent_to_owner: !!j.ok,
        note: "الإذاعة الكاملة لجميع المستخدمين تتم من لوحة البوت على Render (قائمة known_users). تم إرسال معاينة للمالك.",
        telegram: j,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
