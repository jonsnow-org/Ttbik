import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as {
  __parties?: Record<string, any>;
  __partyMsgs?: Record<string, any[]>;
};
if (!g.__parties) g.__parties = {};
if (!g.__partyMsgs) g.__partyMsgs = {};

function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return { url, key };
}

async function client() {
  const c = sb();
  if (!c) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(c.url, c.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function rid() {
  return "room_" + Math.random().toString(36).slice(2, 10);
}

/** GET ?id=room_xxx — room state + recent messages */
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = await client();
  if (db) {
    const { data: room } = await db.from("party_rooms").select("*").eq("id", id).maybeSingle();
    if (room) {
      const { data: msgs } = await db
        .from("party_messages")
        .select("id,user_id,user_name,body,kind,created_at")
        .eq("room_id", id)
        .order("id", { ascending: false })
        .limit(40);
      return NextResponse.json({
        room: mapRoom(room),
        messages: (msgs || []).reverse().map(mapMsg),
        source: "supabase",
      });
    }
  }

  const mem = g.__parties![id];
  if (!mem) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    room: mem,
    messages: (g.__partyMsgs![id] || []).slice(-40),
    source: "memory",
  });
}

/** POST — create room or action */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");

  if (action === "create") {
    const id = rid();
    const room = {
      id,
      host_id: String(body.host_id || "0"),
      host_name: String(body.host_name || "مضيف").slice(0, 40),
      media_id: String(body.media_id || ""),
      media_title: String(body.media_title || "فيديو").slice(0, 120),
      media_url: String(body.media_url || ""),
      media_thumb: String(body.media_thumb || ""),
      media_type: String(body.media_type || "video"),
      playing: false,
      current_time: 0,
      host_only: body.host_only !== false,
      members: [
        {
          id: String(body.host_id || "0"),
          name: String(body.host_name || "مضيف").slice(0, 40),
        },
      ],
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    };
    g.__parties![id] = room;
    g.__partyMsgs![id] = [];

    const db = await client();
    if (db) {
      await db.from("party_rooms").upsert({
        id: room.id,
        host_id: room.host_id,
        host_name: room.host_name,
        media_id: room.media_id,
        media_title: room.media_title,
        media_url: room.media_url,
        media_thumb: room.media_thumb,
        media_type: room.media_type,
        playing: room.playing,
        current_time: room.current_time,
        host_only: room.host_only,
        members: room.members,
        updated_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, room });
  }

  if (action === "join") {
    const id = String(body.room_id || "");
    const uid = String(body.user_id || "0");
    const uname = String(body.user_name || "ضيف").slice(0, 40);
    let room = g.__parties![id];
    const db = await client();
    if (!room && db) {
      const { data } = await db.from("party_rooms").select("*").eq("id", id).maybeSingle();
      if (data) room = mapRoom(data);
    }
    if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });
    const members = Array.isArray(room.members) ? [...room.members] : [];
    if (!members.some((m: any) => String(m.id) === uid)) {
      members.push({ id: uid, name: uname });
    }
    room.members = members;
    room.updated_at = Math.floor(Date.now() / 1000);
    g.__parties![id] = room;
    if (db) {
      await db
        .from("party_rooms")
        .update({ members, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
    return NextResponse.json({ ok: true, room });
  }

  if (action === "sync") {
    const id = String(body.room_id || "");
    const uid = String(body.user_id || "");
    let room = g.__parties![id];
    const db = await client();
    if (!room && db) {
      const { data } = await db.from("party_rooms").select("*").eq("id", id).maybeSingle();
      if (data) room = mapRoom(data);
    }
    if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });

    const isHost = String(room.host_id) === uid;
    if (room.host_only && !isHost) {
      return NextResponse.json({ error: "host_only", room }, { status: 403 });
    }

    if (typeof body.playing === "boolean") room.playing = body.playing;
    if (typeof body.current_time === "number") room.current_time = body.current_time;
    if (typeof body.host_only === "boolean" && isHost) room.host_only = body.host_only;
    room.updated_at = Math.floor(Date.now() / 1000);
    g.__parties![id] = room;

    if (db) {
      await db
        .from("party_rooms")
        .update({
          playing: room.playing,
          current_time: room.current_time,
          host_only: room.host_only,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
    return NextResponse.json({ ok: true, room });
  }

  if (action === "chat" || action === "react") {
    const id = String(body.room_id || "");
    const msg = {
      id: Date.now(),
      user_id: String(body.user_id || "0"),
      user_name: String(body.user_name || "مستخدم").slice(0, 40),
      body: String(body.body || "").slice(0, 200),
      kind: action === "react" ? "react" : "chat",
      created_at: Math.floor(Date.now() / 1000),
    };
    if (!g.__partyMsgs![id]) g.__partyMsgs![id] = [];
    g.__partyMsgs![id].push(msg);
    g.__partyMsgs![id] = g.__partyMsgs![id].slice(-80);

    const db = await client();
    if (db) {
      await db.from("party_messages").insert({
        room_id: id,
        user_id: msg.user_id,
        user_name: msg.user_name,
        body: msg.body,
        kind: msg.kind,
      });
    }
    return NextResponse.json({ ok: true, message: msg });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

function mapRoom(r: any) {
  return {
    id: String(r.id),
    host_id: String(r.host_id),
    host_name: String(r.host_name || "مضيف"),
    media_id: String(r.media_id || ""),
    media_title: String(r.media_title || ""),
    media_url: String(r.media_url || ""),
    media_thumb: String(r.media_thumb || ""),
    media_type: String(r.media_type || "video"),
    playing: !!r.playing,
    current_time: Number(r.current_time || 0),
    host_only: r.host_only !== false,
    members: Array.isArray(r.members) ? r.members : [],
    created_at: r.created_at
      ? Math.floor(new Date(r.created_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
    updated_at: r.updated_at
      ? Math.floor(new Date(r.updated_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  };
}

function mapMsg(m: any) {
  return {
    id: m.id,
    user_id: String(m.user_id),
    user_name: String(m.user_name || "مستخدم"),
    body: String(m.body || ""),
    kind: String(m.kind || "chat"),
    created_at: m.created_at
      ? Math.floor(new Date(m.created_at).getTime() / 1000)
      : 0,
  };
}
