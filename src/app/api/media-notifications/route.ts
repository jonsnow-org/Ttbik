import { NextRequest, NextResponse } from "next/server";
import { mediaDb, mediaUser } from "@/lib/mediaSocial";
import { isRateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Real, server-side, cross-device notification delivery for the media mini-app.
// Who the caller is always comes from Telegram-signed init_data (mediaUser),
// never from a client-sent user_id/from_id: those let anyone read anyone's
// notifications, mark them read, or send notifications in someone else's name.

const TYPES = new Set(["like", "follow", "comment", "reply"]);

export async function GET(req: NextRequest) {
  const me = mediaUser(req.nextUrl.searchParams.get("init_data") || "");
  if (!me) return NextResponse.json({ notifications: [] });

  const db = await mediaDb();
  if (!db) return NextResponse.json({ notifications: [] });

  const { data } = await db
    .from("media_notifications")
    .select("id,from_id,from_name,type,read,created_at,post_id")
    .eq("to_id", me.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    notifications: (data || []).map((n: any) => ({
      id: String(n.id),
      fromId: String(n.from_id || ""),
      fromName: String(n.from_name || "مستخدم"),
      type: String(n.type || "follow"),
      read: !!n.read,
      at: n.created_at ? Math.floor(new Date(n.created_at).getTime() / 1000) : 0,
      postId: n.post_id ? String(n.post_id) : undefined,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const toId = String(body.to_id || "").trim();
  const type = String(body.type || "");
  if (!/^\d{1,20}$/.test(toId) || toId === me.id || !TYPES.has(type)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (isRateLimited(`media-notif:${me.id}`, 60, 10 * 60_000)) {
    return NextResponse.json({ ok: true }); // silently drop spam bursts
  }

  const db = await mediaDb();
  if (db) {
    await db.from("media_notifications").insert({
      to_id: toId,
      from_id: me.id,
      from_name: String(body.from_name || me.name).slice(0, 40),
      type,
      post_id: body.post_id ? String(body.post_id).slice(0, 64) : null,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = await mediaDb();
  if (db) {
    await db.from("media_notifications").update({ read: true }).eq("to_id", me.id);
  }
  return NextResponse.json({ ok: true });
}
