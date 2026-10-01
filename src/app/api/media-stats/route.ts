import { NextRequest, NextResponse } from "next/server";
import { mediaUser } from "@/lib/mediaSocial";
import { verifyTelegramOwner } from "@/lib/verifyTelegramOwner";

export const dynamic = "force-dynamic";

type Visit = { id: string; name: string; at: number };
type BehaviorEvent = {
  id: string;
  user_id: string;
  name: string;
  event: string;
  meta: Record<string, string>;
  at: number;
};

const ALLOWED = new Set([
  "open",
  "tab",
  "play",
  "view",
  "like",
  "unlike",
  "follow",
  "unfollow",
  "search",
  "profile",
  "share",
  "clone",
  "comment",
  "report",
  "settings",
]);

const g = globalThis as unknown as {
  __maUsers?: Map<string, Visit>;
  __maSessions?: Map<string, number>;
  __maEvents?: BehaviorEvent[];
};

if (!g.__maUsers) g.__maUsers = new Map();
if (!g.__maSessions) g.__maSessions = new Map();
if (!g.__maEvents) g.__maEvents = [];

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function pushEvent(ev: BehaviorEvent) {
  g.__maEvents!.unshift(ev);
  if (g.__maEvents!.length > 2000) g.__maEvents!.length = 2000;
}

/** POST — session open and/or a single behavior event */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = me.id;
  const name = me.name;
  const now = Math.floor(Date.now() / 1000);

  g.__maUsers!.set(id, { id, name, at: now });
  g.__maSessions!.set(id, now);

  const rawEvent = String(body.event || "open").slice(0, 32).toLowerCase();
  const event = ALLOWED.has(rawEvent) ? rawEvent : "open";
  const metaIn = body.meta && typeof body.meta === "object" ? body.meta : {};
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(metaIn as Record<string, unknown>).slice(0, 8)) {
    const key = String(k).slice(0, 32);
    const val = String(v ?? "").slice(0, 120);
    if (key) meta[key] = val;
  }

  const ev: BehaviorEvent = {
    id: `${now}-${id}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: id,
    name,
    event,
    meta,
    at: now,
  };
  pushEvent(ev);

  const db = await sb();
  if (db) {
    try {
      const iso = new Date(now * 1000).toISOString();
      const { data: existing } = await db.from("mini_app_users").select("id").eq("id", id).maybeSingle();
      if (existing) {
        await db.from("mini_app_users").update({ name, last_seen: iso }).eq("id", id);
      } else {
        await db.from("mini_app_users").insert({ id, name, first_seen: iso, last_seen: iso });
      }
    } catch {
      /* optional table */
    }
    try {
      await db.from("mini_app_events").insert({
        user_id: id,
        name,
        event,
        meta,
        created_at: new Date(now * 1000).toISOString(),
      });
    } catch {
      /* optional table */
    }
  }

  return NextResponse.json({ ok: true, event });
}

/** GET — owner dashboard: users + behavior aggregates */
export async function GET(req: NextRequest) {
  const init = req.nextUrl.searchParams.get("init_data") || "";
  const botToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.MEDIA_BOT_TOKEN || "").trim();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").trim();
  const ownerOk = !!(init && botToken && verifyTelegramOwner(init, botToken, ownerId));
  const now = Math.floor(Date.now() / 1000);
  const users = Array.from(g.__maUsers!.values());
  const online = users.filter((u) => now - u.at < 15 * 60).length;
  const active24 = users.filter((u) => now - u.at < 86400).length;

  let posts = 0;
  let publishers = 0;
  let clones = 0;
  let miniUsers = users.length;
  let online15 = online;
  let active = active24;
  let new24 = users.filter((u) => now - u.at < 86400).length;
  let source = "memory";

  const db = await sb();
  if (db) {
    try {
      const { data } = await db.from("media_feed").select("id,sharer_id,clones,squad_code").limit(5000);
      if (data) {
        posts = data.filter((r: any) => !r.squad_code).length;
        publishers = new Set(data.map((r: any) => r.sharer_id).filter(Boolean)).size;
        clones = data.reduce((a: number, r: any) => a + (Number(r.clones) || 0), 0);
      }
    } catch {
      /* ignore */
    }
    try {
      const { data: mu } = await db.from("mini_app_users").select("id,last_seen,first_seen").limit(100000);
      if (mu && mu.length) {
        source = "supabase";
        miniUsers = mu.length;
        new24 = mu.filter((r: any) => {
          const ts = r.first_seen ? Math.floor(new Date(r.first_seen).getTime() / 1000) : 0;
          return now - ts < 86400;
        }).length;
        online15 = mu.filter((r: any) => {
          const ts = r.last_seen ? Math.floor(new Date(r.last_seen).getTime() / 1000) : 0;
          return now - ts < 15 * 60;
        }).length;
        active = mu.filter((r: any) => {
          const ts = r.last_seen ? Math.floor(new Date(r.last_seen).getTime() / 1000) : 0;
          return now - ts < 86400;
        }).length;
      }
    } catch {
      /* ignore */
    }
  }

  // Behavior aggregates (last 24h from memory ring; optional DB later)
  const dayEvents = g.__maEvents!.filter((e) => now - e.at < 86400);
  const byEvent: Record<string, number> = {};
  for (const e of dayEvents) byEvent[e.event] = (byEvent[e.event] || 0) + 1;
  const topTabs: Record<string, number> = {};
  for (const e of dayEvents.filter((x) => x.event === "tab")) {
    const t = e.meta.tab || "?";
    topTabs[t] = (topTabs[t] || 0) + 1;
  }
  const recent = ownerOk
    ? dayEvents.slice(0, 40).map((e) => ({
        event: e.event,
        name: e.name,
        user_id: e.user_id,
        meta: e.meta,
        at: e.at,
      }))
    : [];

  return NextResponse.json({
    source,
    mini_app_users: miniUsers,
    online_15m: online15,
    active_24h: active,
    new_24h: new24,
    public_posts: posts,
    publishers,
    total_clones: clones,
    behavior_24h: byEvent,
    tabs_24h: topTabs,
    events_24h: dayEvents.length,
    recent_events: recent,
  });
}
