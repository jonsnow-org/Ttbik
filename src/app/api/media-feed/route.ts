import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FeedItem = {
  id: string;
  file_id: string;
  media_type: string;
  title: string;
  url: string;
  thumbnail: string;
  sharer_name: string;
  sharer_id: string;
  clones: number;
  tags?: string[];
  squad_code?: string;
  created_at: number;
};

const g = globalThis as unknown as { __mediaFeed?: FeedItem[] };
if (!g.__mediaFeed) g.__mediaFeed = [];

const DEFAULT_SECRET = "8452320";

function secretOk(req: NextRequest): boolean {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || DEFAULT_SECRET).trim();
  const got = (req.headers.get("x-feed-secret") || "").trim();
  return !!expected && got === expected;
}

async function loadFromSupabase(): Promise<FeedItem[] | null> {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Prefer full select; fall back if columns missing
    let data: any[] | null = null;
    {
      const r = await db
        .from("media_feed")
        .select("id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,created_at,tags,squad_code")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!r.error && r.data) data = r.data;
    }
    if (!data) {
      const r = await db
        .from("media_feed")
        .select("id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!r.error && r.data) data = r.data;
    }
    if (!data) return null;
    return data.map((r: any) => ({
      id: String(r.id),
      file_id: String(r.file_id || ""),
      media_type: String(r.media_type || "video"),
      title: String(r.title || ""),
      url: String(r.url || ""),
      thumbnail: String(r.thumbnail || ""),
      sharer_name: String(r.sharer_name || "مستخدم"),
      sharer_id: String(r.sharer_id || ""),
      clones: Number(r.clones || 0),
      tags: Array.isArray(r.tags) ? r.tags : [],
      squad_code: String(r.squad_code || ""),
      created_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : 0,
    }));
  } catch {
    return null;
  }
}

async function saveToSupabase(item: FeedItem): Promise<string | null> {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Try full insert first
    const full = {
      id: item.id,
      file_id: item.file_id,
      media_type: item.media_type,
      title: item.title,
      url: item.url,
      thumbnail: item.thumbnail,
      sharer_name: item.sharer_name,
      sharer_id: item.sharer_id,
      clones: item.clones,
      tags: item.tags || [],
      squad_code: item.squad_code || "",
    };
    let { data, error } = await db.from("media_feed").insert(full).select("id").single();
    if (error) {
      // schema without tags/squad_code
      const minimal = {
        id: item.id,
        file_id: item.file_id,
        media_type: item.media_type,
        title: item.title,
        url: item.url,
        thumbnail: item.thumbnail,
        sharer_name: item.sharer_name,
        sharer_id: item.sharer_id,
        clones: item.clones,
      };
      const r2 = await db.from("media_feed").insert(minimal).select("id").single();
      data = r2.data;
      error = r2.error;
    }
    if (error) return null;
    return data?.id ? String(data.id) : item.id;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "all").toLowerCase();
  const sort = (req.nextUrl.searchParams.get("sort") || "latest").toLowerCase();
  const tag = (req.nextUrl.searchParams.get("tag") || "").trim();
  const squad = (req.nextUrl.searchParams.get("squad") || "").trim();

  let items = (await loadFromSupabase()) || g.__mediaFeed || [];

  if (squad) {
    items = items.filter((i) => (i.squad_code || "") === squad);
  } else {
    // public feed: hide private squad-only posts
    items = items.filter((i) => !i.squad_code);
  }

  if (type !== "all") {
    items = items.filter(
      (i) => i.media_type === type || (type === "audio" && (i.media_type === "audio" || i.media_type === "voice"))
    );
  }
  if (tag) {
    items = items.filter((i) => (i.tags || []).includes(tag));
  }
  if (sort === "trending") {
    items = [...items].sort((a, b) => (b.clones || 0) - (a.clones || 0) || (b.created_at || 0) - (a.created_at || 0));
  } else {
    items = [...items].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  const publicItems = items.slice(0, 60).map(({ file_id: _f, ...rest }) => rest);
  return NextResponse.json({ items: publicItems, count: publicItems.length });
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: "unauthorized", hint: "set FEED_SECRET=8452320 on both Render and Vercel" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const item: FeedItem = {
    id: String(body.id || crypto.randomUUID().replace(/-/g, "").slice(0, 12)),
    file_id: String(body.file_id || ""),
    media_type: String(body.media_type || "video"),
    title: String(body.title || "بدون عنوان").slice(0, 120),
    url: String(body.url || ""),
    thumbnail: String(body.thumbnail || ""),
    sharer_name: String(body.sharer_name || "مستخدم").slice(0, 40),
    sharer_id: String(body.sharer_id || ""),
    clones: Number(body.clones || 0),
    tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 5) : [],
    squad_code: String(body.squad_code || ""),
    created_at: Number(body.created_at || Math.floor(Date.now() / 1000)),
  };
  if (!item.file_id) {
    return NextResponse.json({ error: "file_id required" }, { status: 400 });
  }

  const savedId = await saveToSupabase(item);
  if (savedId) item.id = savedId;

  // Always keep in memory so GET works even without Supabase
  g.__mediaFeed = [item, ...(g.__mediaFeed || []).filter((x) => x.id !== item.id)].slice(0, 200);
  return NextResponse.json({ ok: true, id: item.id, persisted: !!savedId });
}

export async function PATCH(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const mem = (g.__mediaFeed || []).find((x) => x.id === id);
  if (mem && body.action === "clone") {
    mem.clones = (mem.clones || 0) + 1;
  }

  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (url && key && body.action === "clone") {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from("media_feed").select("clones").eq("id", id).maybeSingle();
      const next = Number(data?.clones || 0) + 1;
      await db.from("media_feed").update({ clones: next }).eq("id", id);
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const mem = (g.__mediaFeed || []).find((x) => x.id === id);
  if (mem) return NextResponse.json({ item: mem });

  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (url && key) {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from("media_feed").select("*").eq("id", id).maybeSingle();
      if (data) {
        return NextResponse.json({
          item: {
            id: String(data.id),
            file_id: String(data.file_id),
            media_type: String(data.media_type),
            title: String(data.title || ""),
            url: String(data.url || ""),
            thumbnail: String(data.thumbnail || ""),
            sharer_name: String(data.sharer_name || ""),
            sharer_id: String(data.sharer_id || ""),
            clones: Number(data.clones || 0),
            tags: Array.isArray(data.tags) ? data.tags : [],
            squad_code: String(data.squad_code || ""),
            created_at: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : 0,
          },
        });
      }
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
