import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/verifyTelegramOwner";
import { MEDIA_OWNER_ID, isBlockedEitherWay, loadRelations, mediaDb, mediaUser, namesFor, tgApi } from "@/lib/mediaSocial";

export const dynamic = "force-dynamic";

// Real bug (fixed): user_id/from_id here used to be plain, unverified
// values the client could set to anything -- and since a Telegram user id
// is already public (it's the same value shown as every post's
// sharer_id in the feed), anyone could read or send as any user's DM
// inbox just by knowing/guessing that public id. The verified Telegram
// identity from init_data (see verifyTelegramOwner.ts) is the only value
// here a caller can't forge; every handler below now trusts THAT for who
// the caller actually is, not whatever the request claims.
function authedUserId(initData: string): string | null {
  const botToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const user = verifyTelegramInitData(initData, botToken);
  return user?.id || null;
}

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

/** GET ?init_data= — inbox threads (for the verified caller) + optional ?with= for one thread */
export async function GET(req: NextRequest) {
  const uid = authedUserId(req.nextUrl.searchParams.get("init_data") || "");
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("admin") === "1") return adminView(req, uid);
  const withId = (req.nextUrl.searchParams.get("with") || "").trim();

  const db = await sb();
  let messages: Msg[] = [];

  if (db) {
    try {
      // table optional — create via SQL if missing; fail soft to memory.
      // Two plain .eq()-filtered queries instead of hand-building a
      // PostgREST .or() filter string out of these ids -- that string
      // used to interpolate them directly, which is exactly the kind of
      // thing that's easy to get subtly wrong (a value containing a
      // comma or parenthesis could reshape the intended filter).
      const { data: sent, error: e1 } = await db
        .from("direct_messages")
        .select("*")
        .eq("from_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);
      const { data: received, error: e2 } = await db
        .from("direct_messages")
        .select("*")
        .eq("to_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);
      const data = !e1 && !e2 ? [...(sent || []), ...(received || [])] : null;
      if (data) {
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

  // threadsMap below needs every conversation to build the inbox list;
  // the withId case narrows to just that one thread here, after fetching.
  if (withId) {
    messages = messages.filter(
      (m) => (m.from_id === uid && m.to_id === withId) || (m.from_id === withId && m.to_id === uid)
    );
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

  // Blocked either way: their conversation disappears for both sides.
  try {
    const rdb = await mediaDb();
    if (rdb) {
      const rel = await loadRelations(rdb, uid);
      const hide = new Set([...rel.blocks, ...rel.blockedBy]);
      if (hide.size) messages = messages.filter((m) => !hide.has(m.from_id === uid ? m.to_id : m.from_id));
    }
  } catch {
    /* block table not created yet */
  }

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
  // A thread where I sent the last message used to show the peer's raw id as its name.
  try {
    const ndb = await mediaDb();
    const unnamed = threads.filter((t) => !t.peer_name || t.peer_name === t.peer_id).map((t) => t.peer_id);
    if (ndb && unnamed.length) {
      const names = await namesFor(ndb, unnamed);
      for (const t of threads) if (names[t.peer_id] && (!t.peer_name || t.peer_name === t.peer_id)) t.peer_name = names[t.peer_id];
    }
  } catch {
    /* keep ids */
  }

  return NextResponse.json({
    threads,
    messages: withId ? messages.slice(0, 80).reverse() : [],
    unread: messages.filter((m) => !m.read && m.to_id === uid).length,
  });
}

/** POST — send message, as the verified caller (init_data) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const from_id = authedUserId(String(body.init_data || ""));
  if (!from_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const from_name = String(body.from_name || "مستخدم").slice(0, 40);
  const to_id = String(body.to_id || "").trim();
  const text = String(body.body || "").trim().slice(0, 1000);
  if (!to_id || !text) {
    return NextResponse.json({ error: "to_id, body required" }, { status: 400 });
  }
  if (from_id === to_id) {
    return NextResponse.json({ error: "cannot message self" }, { status: 400 });
  }
  try {
    const bdb = await mediaDb();
    if (bdb && (await isBlockedEitherWay(bdb, from_id, to_id))) {
      return NextResponse.json({ error: "blocked" }, { status: 403 });
    }
  } catch {
    /* block table not created yet */
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

  await notifyRecipient(msg).catch(() => {});
  return NextResponse.json({ ok: true, message: msg });
}

// A bot message tells the recipient they have a new DM (with a button that
// opens the conversation), at most once per sender every 10 minutes so a
// chat in progress doesn't spam them. Best-effort, per server instance.
const g2 = globalThis as unknown as { __dmNotified?: Map<string, number> };
if (!g2.__dmNotified) g2.__dmNotified = new Map();
async function notifyRecipient(msg: Msg) {
  const key = `${msg.from_id}>${msg.to_id}`;
  const last = g2.__dmNotified!.get(key) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  g2.__dmNotified!.set(key, Date.now());
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  await tgApi("sendMessage", {
    chat_id: msg.to_id,
    text: `📩 رسالة جديدة من ${msg.from_name || "مستخدم"}:\n«${msg.body.slice(0, 120)}»`,
    reply_markup: { inline_keyboard: [[{ text: "💬 افتح المحادثة", web_app: { url: `${site}/mini-app?dm=${encodeURIComponent(msg.from_id)}` } }]] },
  });
}

/**
 * Owner-only moderation view (verified initData of the app owner):
 *   ?admin=1                 → every conversation (pair) with its last message
 *   ?admin=1&a=<id>&b=<id>   → the full conversation between two users
 * Used to verify reports and to answer lawful requests from authorities.
 */
async function adminView(req: NextRequest, uid: string) {
  if (uid !== MEDIA_OWNER_ID) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ conversations: [], messages: [] });
  const a = (req.nextUrl.searchParams.get("a") || "").trim();
  const b = (req.nextUrl.searchParams.get("b") || "").trim();
  const toMsg = (r: any) => ({
    id: String(r.id), from_id: String(r.from_id), from_name: String(r.from_name || ""), to_id: String(r.to_id),
    body: String(r.body || ""), created_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : 0, read: !!r.read,
  });
  if (a && b) {
    const [x, y] = await Promise.all([
      db.from("direct_messages").select("*").eq("from_id", a).eq("to_id", b).order("created_at", { ascending: false }).limit(200),
      db.from("direct_messages").select("*").eq("from_id", b).eq("to_id", a).order("created_at", { ascending: false }).limit(200),
    ]);
    const msgs = [...(x.data || []), ...(y.data || [])].map(toMsg).sort((m, n) => m.created_at - n.created_at);
    return NextResponse.json({ messages: msgs });
  }
  const { data } = await db.from("direct_messages").select("*").order("created_at", { ascending: false }).limit(1000);
  const convs = new Map<string, { a: string; b: string; last_body: string; last_at: number; count: number }>();
  const ids = new Set<string>();
  for (const r of (data || []).map(toMsg)) {
    const [p, q] = [r.from_id, r.to_id].sort();
    ids.add(p); ids.add(q);
    const k = `${p}|${q}`;
    const c = convs.get(k);
    if (!c) convs.set(k, { a: p, b: q, last_body: r.body, last_at: r.created_at, count: 1 });
    else c.count++;
  }
  const names = await namesFor(db, Array.from(ids)).catch(() => ({} as Record<string, string>));
  const conversations = Array.from(convs.values())
    .sort((m, n) => n.last_at - m.last_at)
    .map((c) => ({ ...c, a_name: names[c.a] || c.a, b_name: names[c.b] || c.b }));
  return NextResponse.json({ conversations });
}

/** PATCH — mark thread read, as the verified caller (init_data) */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = authedUserId(String(body.init_data || ""));
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const peer = String(body.peer_id || "").trim();
  if (!peer) return NextResponse.json({ error: "peer_id required" }, { status: 400 });

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
