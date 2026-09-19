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
  views?: number;
  likes?: number;
  tags?: string[];
  squad_code?: string;
  duration_sec?: number;
  quality?: string;
  hidden?: boolean;
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

function sbCreds(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!url || !key) return null;
  return { url, key };
}

function mapRow(r: any): FeedItem {
  const created =
    typeof r.created_at === "number"
      ? r.created_at
      : r.created_at
        ? Math.floor(new Date(r.created_at).getTime() / 1000)
        : 0;
  return {
    id: String(r.id),
    file_id: String(r.file_id || ""),
    media_type: String(r.media_type || "video"),
    title: String(r.title || ""),
    url: String(r.url || ""),
    thumbnail: String(r.thumbnail || ""),
    sharer_name: String(r.sharer_name || "مستخدم"),
    sharer_id: String(r.sharer_id || ""),
    clones: Number(r.clones || 0),
    views: Number(r.views || 0),
    likes: Number(r.likes || 0),
    tags: Array.isArray(r.tags) ? r.tags : [],
    squad_code: String(r.squad_code || ""),
    duration_sec: Number(r.duration_sec || 0),
    quality: String(r.quality || ""),
    hidden: !!r.hidden,
    created_at: created,
  };
}

async function loadFromSupabase(): Promise<FeedItem[] | null> {
  const creds = sbCreds();
  if (!creds) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(creds.url, creds.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // `r` is deliberately re-assigned below with a narrower column list as
    // a fallback for databases that haven't run the newer migration yet
    // (see the resilient-insert commit) -- the two selects have different
    // shapes on purpose, and every field is read defensively further down
    // regardless of which one ran, so this is typed loosely rather than
    // pinned to the first query's shape.
    let r: any = await db
      .from("media_feed")
      .select(
        "id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,views,likes,created_at,tags,squad_code,duration_sec,quality,hidden"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (r.error) {
      r = await db
        .from("media_feed")
        .select("id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (r.error) return null;
    }

    const mapped = (r.data || []).map(mapRow);
    if (mapped.length) g.__mediaFeed = mapped;
    return mapped;
  } catch {
    return null;
  }
}

async function saveToSupabase(item: FeedItem): Promise<{ id: string | null; error?: string }> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    return { id: null, error: "missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL" };
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const row: Record<string, unknown> = {
      id: item.id,
      file_id: item.file_id,
      media_type: item.media_type,
      title: item.title,
      url: item.url,
      thumbnail: item.thumbnail,
      sharer_name: item.sharer_name,
      sharer_id: item.sharer_id,
      clones: item.clones || 0,
      views: item.views || 0,
      likes: item.likes || 0,
      tags: item.tags || [],
      squad_code: item.squad_code || "",
      duration_sec: item.duration_sec || 0,
      quality: item.quality || "",
      hidden: false,
      created_at: new Date((item.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    };

    let { data, error } = await db.from("media_feed").upsert(row, { onConflict: "id" }).select("id").single();
    if (error) {
      const minimal = {
        id: item.id,
        file_id: item.file_id,
        media_type: item.media_type,
        title: item.title,
        url: item.url,
        thumbnail: item.thumbnail,
        sharer_name: item.sharer_name,
        sharer_id: item.sharer_id,
        clones: item.clones || 0,
      };
      const r2 = await db.from("media_feed").upsert(minimal, { onConflict: "id" }).select("id").single();
      data = r2.data;
      error = r2.error;
      if (error) return { id: null, error: error.message };
    }
    return { id: data?.id ? String(data.id) : item.id };
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "all").toLowerCase();
  const sort = (req.nextUrl.searchParams.get("sort") || "latest").toLowerCase();
  const tag = (req.nextUrl.searchParams.get("tag") || "").trim();
  const squad = (req.nextUrl.searchParams.get("squad") || "").trim();
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const includeHidden = req.nextUrl.searchParams.get("admin") === "1";

  const fromDb = await loadFromSupabase();
  const byId = new Map<string, FeedItem>();
  for (const it of fromDb || []) byId.set(it.id, it);
  for (const it of g.__mediaFeed || []) {
    if (!byId.has(it.id)) byId.set(it.id, it);
  }
  let items = Array.from(byId.values());

  if (!includeHidden) items = items.filter((i) => !i.hidden);
  if (squad) items = items.filter((i) => (i.squad_code || "") === squad);
  else items = items.filter((i) => !i.squad_code);

  if (type !== "all") {
    items = items.filter(
      (i) =>
        i.media_type === type ||
        (type === "audio" && (i.media_type === "audio" || i.media_type === "voice"))
    );
  }
  if (tag) items = items.filter((i) => (i.tags || []).includes(tag));
  if (q) {
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.sharer_name || "").toLowerCase().includes(q) ||
        (i.url || "").toLowerCase().includes(q)
    );
  }

  if (sort === "trending") {
    items = [...items].sort(
      (a, b) => (b.clones || 0) - (a.clones || 0) || (b.created_at || 0) - (a.created_at || 0)
    );
  } else {
    items = [...items].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  const publicItems = items.slice(0, 80).map(({ file_id: _f, ...rest }) => rest);
  return NextResponse.json({
    items: publicItems,
    count: publicItems.length,
    source: fromDb ? "supabase" : "memory",
  });
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
    views: Number(body.views || 0),
    likes: Number(body.likes || 0),
    tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 5) : [],
    squad_code: String(body.squad_code || ""),
    duration_sec: Number(body.duration_sec || 0),
    quality: String(body.quality || ""),
    created_at: Number(body.created_at || Math.floor(Date.now() / 1000)),
  };
  if (!item.file_id) return NextResponse.json({ error: "file_id required" }, { status: 400 });

  const saved = await saveToSupabase(item);
  if (saved.id) item.id = saved.id;
  g.__mediaFeed = [item, ...(g.__mediaFeed || []).filter((x) => x.id !== item.id)].slice(0, 200);

  return NextResponse.json({
    ok: true,
    id: item.id,
    persisted: !!saved.id,
    persist_error: saved.error || null,
  });
}

export async function PATCH(req: NextRequest) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const action = String(body.action || "clone");
  const mem = (g.__mediaFeed || []).find((x) => x.id === id);
  if (mem) {
    if (action === "clone") mem.clones = (mem.clones || 0) + 1;
    if (action === "view") mem.views = (mem.views || 0) + 1;
    if (action === "like") mem.likes = (mem.likes || 0) + 1;
    if (action === "hide") mem.hidden = true;
    if (action === "unhide") mem.hidden = false;
  }

  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (url && key) {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (action === "hide" || action === "unhide") {
        await db.from("media_feed").update({ hidden: action === "hide" }).eq("id", id);
      } else {
        const col = action === "view" ? "views" : action === "like" ? "likes" : "clones";
        const { data } = await db.from("media_feed").select(col).eq("id", id).maybeSingle();
        const next = Number((data as any)?.[col] || 0) + 1;
        await db.from("media_feed").update({ [col]: next }).eq("id", id);
      }
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const mem = (g.__mediaFeed || []).find((x) => x.id === id);
  if (mem) return NextResponse.json({ item: mem });

  try {
    const creds = sbCreds();
    if (creds) {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(creds.url, creds.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await db.from("media_feed").select("*").eq("id", id).maybeSingle();
      if (data) return NextResponse.json({ item: mapRow(data) });
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
