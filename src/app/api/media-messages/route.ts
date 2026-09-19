import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Msg = {
  id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  body: string;
  created_at: number;
  read: boolean;
};

const g = globalThis as unknown as { __dm?: Msg[] };
if (!g.__dm) g.__dm = [];

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** GET ?user_id= — inbox threads + optional ?with= for thread */
export async function GET(req: NextRequest) {
  const uid = (req.nextUrl.searchParams.get("user_id") || "").trim();
  const withId = (req.nextUrl.searchParams.get("with") || "").trim();
  if (!uid) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const db = await sb();
  let messages: Msg[] = [];

  if (db) {
    try {
      // table optional — create via SQL if missing; fail soft to memory
      let q = db.from("direct_messages").select("*").order("created_at", { ascending: false }).limit(200);
      if (withId) {
        q = q.or(
          `and(from_id.eq.${uid},to_id.eq.${withId}),and(from_id.eq.${withId},to_id.eq.${uid})`
        );
      } else {
        q = q.or(`from_id.eq.${uid},to_id.eq.${uid}`);
      }
      const { data, error } = await q;
      if (!error && data) {
        messages = data.map((r: any) => ({
          id: String(r.id),
          from_id: String(r.from_id),
          from_name: String(r.from_name || ""),
          to_id: String(r.to_id),
          body: String(r.body || ""),
          created_at: r.created_at
            ? Math.floor(new Date(r.created_at).getTime() / 1000)
            : 0,
          read: !!r.read,
        }));
      }
    } catch {
      /* table may not exist */
    }
  }

  // merge memory
  for (const m of g.__dm || []) {
    if (withId) {
      if (
        (m.from_id === uid && m.to_id === withId) ||
        (m.from_id === withId && m.to_id === uid)
      ) {
        if (!messages.find((x) => x.id === m.id)) messages.push(m);
      }
    } else if (m.from_id === uid || m.to_id === uid) {
      if (!messages.find((x) => x.id === m.id)) messages.push(m);
    }
  }

  messages.sort((a, b) => b.created_at - a.created_at);

  // build threads for inbox
  const threadsMap = new Map<
    string,
    { peer_id: string; peer_name: string; last_body: string; last_at: number; unread: number }
  >();
  for (const m of messages) {
    const peer = m.from_id === uid ? m.to_id : m.from_id;
    const peerName = m.from_id === uid ? peer : m.from_name || peer;
    const prev = threadsMap.get(peer);
    if (!prev) {
      threadsMap.set(peer, {
        peer_id: peer,
        peer_name: peerName,
        last_body: m.body,
        last_at: m.created_at,
        unread: !m.read && m.to_id === uid ? 1 : 0,
      });
    } else if (m.created_at > prev.last_at) {
      prev.last_body = m.body;
      prev.last_at = m.created_at;
      prev.peer_name = peerName || prev.peer_name;
      if (!m.read && m.to_id === uid) prev.unread += 1;
    } else if (!m.read && m.to_id === uid) {
      prev.unread += 1;
    }
  }

  const threads = Array.from(threadsMap.values()).sort((a, b) => b.last_at - a.last_at);

  return NextResponse.json({
    threads,
    messages: withId ? messages.slice(0, 80).reverse() : [],
    unread: messages.filter((m) => !m.read && m.to_id === uid).length,
  });
}

/** POST — send message */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const from_id = String(body.from_id || "").trim();
  const from_name = String(body.from_name || "مستخدم").slice(0, 40);
  const to_id = String(body.to_id || "").trim();
  const text = String(body.body || "").trim().slice(0, 1000);
  if (!from_id || !to_id || !text) {
    return NextResponse.json({ error: "from_id, to_id, body required" }, { status: 400 });
  }
  if (from_id === to_id) {
    return NextResponse.json({ error: "cannot message self" }, { status: 400 });
  }

  const msg: Msg = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    from_id,
    from_name,
    to_id,
    body: text,
    created_at: Math.floor(Date.now() / 1000),
    read: false,
  };
  g.__dm = [msg, ...(g.__dm || [])].slice(0, 500);

  const db = await sb();
  if (db) {
    try {
      await db.from("direct_messages").insert({
        id: msg.id,
        from_id: msg.from_id,
        from_name: msg.from_name,
        to_id: msg.to_id,
        body: msg.body,
        read: false,
        created_at: new Date(msg.created_at * 1000).toISOString(),
      });
    } catch {
      /* table may not exist yet */
    }
  }

  return NextResponse.json({ ok: true, message: msg });
}

/** PATCH — mark thread read */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = String(body.user_id || "").trim();
  const peer = String(body.peer_id || "").trim();
  if (!uid || !peer) return NextResponse.json({ error: "user_id, peer_id required" }, { status: 400 });

  for (const m of g.__dm || []) {
    if (m.to_id === uid && m.from_id === peer) m.read = true;
  }

  const db = await sb();
  if (db) {
    try {
      await db
        .from("direct_messages")
        .update({ read: true })
        .eq("to_id", uid)
        .eq("from_id", peer);
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({ ok: true });
}
