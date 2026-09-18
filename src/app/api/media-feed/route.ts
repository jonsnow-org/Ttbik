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
  created_at: number;
};

// Warm-instance memory (survives soft reuse on Vercel; Supabase is the durable path).
const g = globalThis as unknown as { __mediaFeed?: FeedItem[] };
if (!g.__mediaFeed) g.__mediaFeed = [];

function secretOk(req: NextRequest): boolean {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) return false;
  return (req.headers.get("x-feed-secret") || "").trim() === expected;
}

async function loadFromSupabase(): Promise<FeedItem[] | null> {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    if (!url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db
      .from("media_feed")
      .select("id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error || !data) return null;
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
    const { data, error } = await db
      .from("media_feed")
      .insert({
        id: item.id,
        file_id: item.file_id,
        media_type: item.media_type,
        title: item.title,
        url: item.url,
        thumbnail: item.thumbnail,
        sharer_name: item.sharer_name,
        sharer_id: item.sharer_id,
        clones: item.clones,
      })
      .select("id")
      .single();
    if (error) return null;
    return data?.id ? String(data.id) : item.id;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "all").toLowerCase();
  const sort = (req.nextUrl.searchParams.get("sort") || "latest").toLowerCase();

  let items = (await loadFromSupabase()) || g.__mediaFeed || [];
  if (type !== "all") {
    items = items.filter((i) => i.media_type === type || (type === "video" && i.media_type === "video"));
  }
  if (sort === "trending") {
    items = [...items].sort((a, b) => (b.clones || 0) - (a.clones || 0) || (b.created_at || 0) - (a.created_at || 0));
  } else {
    items = [...items].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  // Never expose raw file_id publicly in list — clone uses id only via bot deep-link.
  const publicItems = items.slice(0, 60).map(({ file_id: _f, ...rest }) => rest);
  return NextResponse.json({ items: publicItems });
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    created_at: Number(body.created_at || Math.floor(Date.now() / 1000)),
  };
  if (!item.file_id) {
    return NextResponse.json({ error: "file_id required" }, { status: 400 });
  }

  const savedId = await saveToSupabase(item);
  if (savedId) item.id = savedId;

  g.__mediaFeed = [item, ...(g.__mediaFeed || []).filter((x) => x.id !== item.id)].slice(0, 200);
  return NextResponse.json({ ok: true, id: item.id });
}

/** Internal lookup for clone by id — requires secret */
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
