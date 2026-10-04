import { NextRequest, NextResponse } from "next/server";
import { MEDIA_OWNER_ID, isMediaPremium, mediaDb, mediaUser } from "@/lib/mediaSocial";
import { NOTIFY_TYPES, TYPE_LABEL_AR, isNotifyType, loadPrefs, savePrefs, type NotifyType } from "@/lib/mediaNotify";
import { write } from "@/lib/mediaSafe";

export const dynamic = "force-dynamic";

// Notifications for the media mini-app and the media bot.
//   GET    the caller's notifications + their bot-message settings (who the caller is always comes from Telegram-signed init_data)
//   POST   { action: "prefs", pushOff?, offTypes? }  change the bot-message settings. Stopping bot messages is a paid feature
//          (the media bot's 💎 upgrade). Notifications inside the app can never be switched off.
//   PATCH  mark as read: everything, or only { ids: [...] }
// Notifications themselves are created on the server where the thing happens (a like, a comment, a follow...), never by a client
// claiming it: a client-sent "someone liked you" was spoofable and is no longer accepted.

async function isPaid(uid: string) {
  return uid === MEDIA_OWNER_ID || (await isMediaPremium(uid));
}

export async function GET(req: NextRequest) {
  const me = mediaUser(req.nextUrl.searchParams.get("init_data") || "");
  if (!me) return NextResponse.json({ notifications: [] });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ notifications: [] });

  const { data, error } = await db
    .from("media_notifications")
    .select("id,from_id,from_name,type,read,created_at,post_id")
    .eq("to_id", me.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const [prefs, paid] = await Promise.all([loadPrefs(db, me.id), isPaid(me.id)]);
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
    prefs,
    paid,
    types: NOTIFY_TYPES.map((t) => ({ type: t, label: TYPE_LABEL_AR[t] })),
    storage: error ? "unavailable" : "ok",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (body.action !== "prefs") return NextResponse.json({ ok: true }); // old clients used to post notifications themselves: ignored now

  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const cur = await loadPrefs(db, me.id);
  const next = {
    pushOff: typeof body.pushOff === "boolean" ? body.pushOff : cur.pushOff,
    offTypes: Array.isArray(body.offTypes) ? (body.offTypes as unknown[]).filter(isNotifyType) as NotifyType[] : cur.offTypes,
  };
  const stopping = next.pushOff || next.offTypes.length > cur.offTypes.length || (next.pushOff && !cur.pushOff);
  if (stopping && !(await isPaid(me.id))) {
    return NextResponse.json({ ok: false, error: "paid", message: "إيقاف إشعارات البوت ميزة مدفوعة (💎 الترقية المدفوعة)." }, { status: 402 });
  }
  const w = await savePrefs(db, me.id, next);
  if (!w.ok) return NextResponse.json({ ok: false, error: "not saved" }, { status: 503 });
  return NextResponse.json({ ok: true, prefs: next });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  let q = db.from("media_notifications").update({ read: true }).eq("to_id", me.id);
  if (Array.isArray(body.ids) && body.ids.length) q = q.in("id", body.ids.map((x: unknown) => String(x)).slice(0, 200));
  const w = await write("notifications mark read", q);
  return w.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "not saved" }, { status: 503 });
}
