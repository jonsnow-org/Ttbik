import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  kind: string;
  title: string;
  purpose: string;
  durationHours: number;
  visibility: string;
  plan: string;
  status: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  closesAt: number;
  closedAt?: number;
  participantIds: string[];
  roles: Record<string, string>;
  botId?: string;
};

type Contribution = {
  id: string;
  sessionId: string;
  authorId: string;
  authorName: string;
  role: string;
  kind: string;
  text: string;
  createdAt: number;
  hidden?: boolean;
};

const g = globalThis as unknown as {
  __fadaaSessions?: Session[];
  __fadaaContribs?: Contribution[];
};
if (!g.__fadaaSessions) g.__fadaaSessions = [];
if (!g.__fadaaContribs) g.__fadaaContribs = [];

function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: NextRequest) {
  const botId = req.nextUrl.searchParams.get("bot") || "";
  const status = req.nextUrl.searchParams.get("status") || "open";
  const db = sb();
  if (db) {
    try {
      let q = db.from("fadaa_sessions").select("*").order("created_at", { ascending: false }).limit(80);
      if (botId) q = q.eq("bot_id", botId);
      if (status === "open" || status === "closed") q = q.eq("status", status);
      const { data } = await q;
      if (data) {
        const sessions = data.map(mapSession);
        const ids = sessions.map((s) => s.id);
        let contributions: Contribution[] = [];
        if (ids.length) {
          const { data: c } = await db.from("fadaa_contributions").select("*").in("session_id", ids).limit(500);
          contributions = (c || []).map(mapContrib);
        }
        return NextResponse.json({ source: "supabase", sessions, contributions });
      }
    } catch {
      /* fall through */
    }
  }
  let sessions = g.__fadaaSessions!.slice();
  if (botId) sessions = sessions.filter((s) => s.botId === botId);
  if (status === "open" || status === "closed") sessions = sessions.filter((s) => s.status === status);
  const ids = new Set(sessions.map((s) => s.id));
  const contributions = g.__fadaaContribs!.filter((c) => ids.has(c.sessionId));
  return NextResponse.json({ source: "memory", sessions, contributions });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create_session");
  const db = sb();

  if (action === "create_session") {
    const s: Session = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      kind: String(body.kind || "knowledge"),
      title: String(body.title || "").slice(0, 120),
      purpose: String(body.purpose || "").slice(0, 500),
      durationHours: Number(body.durationHours) || 24,
      visibility: String(body.visibility || "public"),
      plan: String(body.plan || "free"),
      status: "open",
      ownerId: String(body.ownerId || "anon"),
      ownerName: String(body.ownerName || "مستخدم").slice(0, 40),
      createdAt: Math.floor(Date.now() / 1000),
      closesAt: Math.floor(Date.now() / 1000) + (Number(body.durationHours) || 24) * 3600,
      participantIds: [String(body.ownerId || "anon")],
      roles: { [String(body.ownerId || "anon")]: String(body.role || "منظّم") },
      botId: body.botId ? String(body.botId) : undefined,
    };
    if (!s.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    g.__fadaaSessions!.unshift(s);
    if (g.__fadaaSessions!.length > 500) g.__fadaaSessions!.length = 500;
    if (db) {
      try {
        await db.from("fadaa_sessions").insert({
          id: s.id,
          bot_id: s.botId || null,
          kind: s.kind,
          title: s.title,
          purpose: s.purpose,
          duration_hours: s.durationHours,
          visibility: s.visibility,
          plan: s.plan,
          status: s.status,
          owner_id: s.ownerId,
          owner_name: s.ownerName,
          created_at: new Date(s.createdAt * 1000).toISOString(),
          closes_at: new Date(s.closesAt * 1000).toISOString(),
          participant_ids: s.participantIds,
          roles: s.roles,
        });
      } catch {
        /* optional */
      }
    }
    return NextResponse.json({ ok: true, session: s });
  }

  if (action === "add_contribution") {
    const c: Contribution = {
      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: String(body.sessionId || ""),
      authorId: String(body.authorId || "anon"),
      authorName: String(body.authorName || "مستخدم").slice(0, 40),
      role: String(body.role || "").slice(0, 40),
      kind: String(body.kind || "clarify"),
      text: String(body.text || "").slice(0, 2000),
      createdAt: Math.floor(Date.now() / 1000),
    };
    if (!c.sessionId || !c.text) return NextResponse.json({ error: "sessionId, text required" }, { status: 400 });
    g.__fadaaContribs!.unshift(c);
    if (db) {
      try {
        await db.from("fadaa_contributions").insert({
          id: c.id,
          session_id: c.sessionId,
          author_id: c.authorId,
          author_name: c.authorName,
          role: c.role,
          kind: c.kind,
          text: c.text,
          created_at: new Date(c.createdAt * 1000).toISOString(),
        });
      } catch {
        /* optional */
      }
    }
    return NextResponse.json({ ok: true, contribution: c });
  }

  if (action === "close_session") {
    const id = String(body.sessionId || "");
    const mem = g.__fadaaSessions!.find((s) => s.id === id);
    if (mem) {
      mem.status = "closed";
      mem.closedAt = Math.floor(Date.now() / 1000);
    }
    if (db) {
      try {
        await db
          .from("fadaa_sessions")
          .update({ status: "closed", closed_at: new Date().toISOString() })
          .eq("id", id);
      } catch {
        /* optional */
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

function mapSession(r: any): Session {
  return {
    id: String(r.id),
    kind: String(r.kind || "knowledge"),
    title: String(r.title || ""),
    purpose: String(r.purpose || ""),
    durationHours: Number(r.duration_hours || r.durationHours || 24),
    visibility: String(r.visibility || "public"),
    plan: String(r.plan || "free"),
    status: String(r.status || "open"),
    ownerId: String(r.owner_id || r.ownerId || ""),
    ownerName: String(r.owner_name || r.ownerName || ""),
    createdAt: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : Number(r.createdAt || 0),
    closesAt: r.closes_at ? Math.floor(new Date(r.closes_at).getTime() / 1000) : Number(r.closesAt || 0),
    closedAt: r.closed_at ? Math.floor(new Date(r.closed_at).getTime() / 1000) : undefined,
    participantIds: Array.isArray(r.participant_ids) ? r.participant_ids : r.participantIds || [],
    roles: typeof r.roles === "object" && r.roles ? r.roles : {},
    botId: r.bot_id || r.botId || undefined,
  };
}

function mapContrib(r: any): Contribution {
  return {
    id: String(r.id),
    sessionId: String(r.session_id || r.sessionId),
    authorId: String(r.author_id || r.authorId),
    authorName: String(r.author_name || r.authorName || ""),
    role: String(r.role || ""),
    kind: String(r.kind || ""),
    text: String(r.text || ""),
    createdAt: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : Number(r.createdAt || 0),
    hidden: !!r.hidden,
  };
}
