import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Visit = { id: string; name: string; at: number };

const g = globalThis as unknown as {
  __maUsers?: Map<string, Visit>;
  __maSessions?: Map<string, number>;
};

if (!g.__maUsers) g.__maUsers = new Map();
if (!g.__maSessions) g.__maSessions = new Map();

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** POST — record mini-app open (per user) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.user_id || "").trim();
  const name = String(body.name || "مستخدم").slice(0, 40);
  if (!id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  g.__maUsers!.set(id, { id, name, at: now });
  g.__maSessions!.set(id, now);

  const db = await sb();
  if (db) {
    try {
      await db.from("mini_app_users").upsert(
        {
          id,
          name,
          last_seen: new Date(now * 1000).toISOString(),
          first_seen: new Date(now * 1000).toISOString(),
        },
        { onConflict: "id" }
      );
    } catch {
      /* table optional */
    }
  }

  return NextResponse.json({ ok: true });
}

/** GET — mini-app stats for owner dashboard */
export async function GET(req: NextRequest) {
  const now = Math.floor(Date.now() / 1000);
  const users = Array.from(g.__maUsers!.values());
  const online = users.filter((u) => now - u.at < 15 * 60).length;
  const active24 = users.filter((u) => now - u.at < 86400).length;
  const new24 = users.filter((u) => now - u.at < 86400).length; // first-seen ≈ last for mem store

  let posts = 0;
  let publishers = 0;
  let clones = 0;
  const db = await sb();
  if (db) {
    try {
      const { data } = await db
        .from("media_feed")
        .select("id,sharer_id,clones,squad_code")
        .limit(5000);
      if (data) {
        posts = data.filter((r: any) => !r.squad_code).length;
        const set = new Set(data.map((r: any) => r.sharer_id).filter(Boolean));
        publishers = set.size;
        clones = data.reduce((a: number, r: any) => a + (Number(r.clones) || 0), 0);
      }
      // Prefer DB user counts if table exists
      try {
        const { data: mu } = await db.from("mini_app_users").select("id,last_seen");
        if (mu && mu.length) {
          const onlineDb = mu.filter((r: any) => {
            const ts = r.last_seen ? Math.floor(new Date(r.last_seen).getTime() / 1000) : 0;
            return now - ts < 15 * 60;
          }).length;
          const activeDb = mu.filter((r: any) => {
            const ts = r.last_seen ? Math.floor(new Date(r.last_seen).getTime() / 1000) : 0;
            return now - ts < 86400;
          }).length;
          return NextResponse.json({
            source: "supabase",
            mini_app_users: mu.length,
            online_15m: onlineDb,
            active_24h: activeDb,
            new_24h: activeDb,
            public_posts: posts,
            publishers,
            total_clones: clones,
          });
        }
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({
    source: "memory",
    mini_app_users: users.length,
    online_15m: online,
    active_24h: active24,
    new_24h: new24,
    public_posts: posts,
    publishers,
    total_clones: clones,
  });
}
