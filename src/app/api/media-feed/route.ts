import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramOwner } from "@/lib/verifyTelegramOwner";
import { isPlaceholderTitle, isTikTok, loadRelations, mediaDb, mediaUser, notifyFollowers, resolveRealTitle } from "@/lib/mediaSocial";

export const dynamic = "force-dynamic";

const OWNER = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").trim();

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
      .limit(500);

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

function offset0(req: NextRequest) {
  return Math.max(0, Number(req.nextUrl.searchParams.get("offset") || 0) || 0);
}

function mixFeed(list: FeedItem[], round: number): FeedItem[] {
  const HEAD = 15;
  const WINDOW = 15;
  const head = list.slice(0, HEAD);
  const tail = list.slice(HEAD);
  let older: FeedItem[] = [];
  if (tail.length) {
    const start = (round * WINDOW) % tail.length;
    older = [...tail.slice(start), ...tail.slice(0, start)].slice(0, WINDOW);
  } else {
    // Small feed: rotate what there is so the order still changes.
    const shift = round % head.length;
    return [...head.slice(shift), ...head.slice(0, shift)];
  }
  // Rotate the head a little too, so even the newest block isn't identical.
  const shift = round % Math.max(1, Math.min(5, head.length));
  const rotatedHead = [...head.slice(shift), ...head.slice(0, shift)];
  const page: FeedItem[] = [];
  for (let i = 0; i < Math.max(rotatedHead.length, older.length); i++) {
    if (rotatedHead[i]) page.push(rotatedHead[i]);
    if (older[i]) page.push(older[i]);
  }
  const used = new Set(page.map((x) => x.id));
  return [...page, ...list.filter((x) => !used.has(x.id))];
}

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "all").toLowerCase();
  const sort = (req.nextUrl.searchParams.get("sort") || "latest").toLowerCase();
  const tag = (req.nextUrl.searchParams.get("tag") || "").trim();
  const squad = (req.nextUrl.searchParams.get("squad") || "").trim();
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  // admin=1 alone used to be enough to see hidden items -- anyone could just
  // append it to the URL. Now it also requires a real Telegram-signed
  // init_data (see verifyTelegramOwner), same as the other admin actions,
  // since it's about to ALSO reveal private squad-only content below.
  const botToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const wantsAdmin = req.nextUrl.searchParams.get("admin") === "1";
  const includeHidden = wantsAdmin && verifyTelegramOwner(req.nextUrl.searchParams.get("init_data") || "", botToken, OWNER);

  const fromDb = await loadFromSupabase();
  const byId = new Map<string, FeedItem>();
  for (const it of fromDb || []) byId.set(it.id, it);
  for (const it of g.__mediaFeed || []) {
    if (!byId.has(it.id)) byId.set(it.id, it);
  }
  let items = Array.from(byId.values());

  if (!includeHidden) items = items.filter((i) => !i.hidden);
  // Per-viewer filtering (needs the viewer's verified Telegram identity):
  // muted and blocked users' posts disappear for them, and ?feed=following
  // keeps only the users they follow. ?sharer=<id> is one profile's posts.
  const feed = (req.nextUrl.searchParams.get("feed") || "").trim();
  const sharer = (req.nextUrl.searchParams.get("sharer") || "").trim();
  const viewer = mediaUser(req.nextUrl.searchParams.get("init_data") || "");
  if (viewer) {
    try {
      const db = await mediaDb();
      if (db) {
        const rel = await loadRelations(db, viewer.id);
        // Muting hides someone from your feeds, but opening their profile
        // directly still shows it; blocking hides it everywhere.
        const hiddenFor = new Set(sharer ? [...rel.blocks, ...rel.blockedBy] : [...rel.mutes, ...rel.blocks, ...rel.blockedBy]);
        if (sharer && sharer === viewer.id) hiddenFor.clear();
        items = items.filter((i) => !hiddenFor.has(i.sharer_id));
        if (feed === "following") {
          const f = new Set(rel.following);
          items = items.filter((i) => f.has(i.sharer_id));
        }
      }
    } catch {
      if (feed === "following") items = [];
    }
  } else if (feed === "following") {
    items = [];
  }
  if (sharer) items = items.filter((i) => i.sharer_id === sharer);

  if (squad) items = items.filter((i) => (i.squad_code || "") === squad);
  // Private squads previously hid their content from the owner too --
  // there was no way to reach or moderate what got posted inside one. The
  // owner's verified admin view now sees everything, squad or not; the
  // normal public feed still excludes squad-only posts by default.
  else if (!includeHidden) items = items.filter((i) => !i.squad_code);

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
    // Real bug (fixed): this ranked purely by raw, all-time clone count.
    // One old item that happened to accumulate a lot of clones (or was
    // cloned repeatedly during testing) could never be displaced by
    // anything newer, however well that new content was actually doing --
    // exactly the "one card stuck at the top of Trending forever"
    // symptom. A real trending score blends engagement (clones weighted
    // highest since they're the strongest signal, then likes, then
    // views) with a mild recency decay (same shape as Hacker News'
    // ranking), so genuinely popular NEW content can actually surface.
    const now = Math.floor(Date.now() / 1000);
    const score = (i: FeedItem) => {
      const ageHours = Math.max(0, (now - (i.created_at || now)) / 3600);
      const engagement = (i.clones || 0) * 3 + (i.likes || 0) * 2 + (i.views || 0) * 1;
      return engagement / Math.pow(ageHours + 2, 1.5);
    };
    items = [...items].sort((a, b) => score(b) - score(a));
  } else {
    items = [...items].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  // ?mix=<round> (first page of Trending / Following, owner request
  // 2026-09-25): every pull-to-refresh sends the next round number, and the
  // first page becomes newest/top posts interleaved with a window of OLDER
  // posts that moves further back each round (and wraps around), so the
  // screen really changes on refresh and older posts get seen too, instead
  // of the same top 30 forever. Later pages (?offset>0) stay in plain order.
  const mixRound = Number(req.nextUrl.searchParams.get("mix"));
  if (Number.isFinite(mixRound) && mixRound >= 0 && offset0(req) === 0 && items.length > 6) {
    items = mixFeed(items, Math.floor(mixRound));
  }

  // Lazy backfill of real titles for older rows saved with a numeric id as
  // the title: a few per request, time-boxed, written back so it's once only.
  const needTitles = items.slice(offset0(req), offset0(req) + 40).filter((i) => isPlaceholderTitle(i.title) && i.url).slice(0, 4);
  if (needTitles.length) {
    const db = await mediaDb();
    await Promise.race([
      Promise.all(
        needTitles.map(async (i) => {
          const real = await resolveRealTitle(i.url);
          if (!real) return;
          i.title = real;
          if (db) await db.from("media_feed").update({ title: real }).eq("id", i.id).then(() => {}, () => {});
        })
      ),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  }

  // Paging: ?offset=N (20-80 per page) so the feed can keep loading older posts.
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || 0) || 0);
  const pageSize = Math.min(80, Math.max(10, Number(req.nextUrl.searchParams.get("limit") || 40) || 40));
  const total = items.length;
  items = items.slice(offset, offset + pageSize);

  // Which of these the viewer has liked (server truth, not this device's memory).
  let likedIds = new Set<string>();
  if (viewer && items.length) {
    try {
      const ldb = await mediaDb();
      const { data: lk } = ldb ? await ldb.from("media_likes").select("post_id").eq("user_id", viewer.id).in("post_id", items.map((i) => i.id)) : { data: [] as any[] };
      likedIds = new Set((lk || []).map((r: any) => String(r.post_id)));
    } catch {
      /* table not created yet */
    }
  }

  const publicItems = items.map(({ file_id: _f, ...rest }) => ({
    liked: likedIds.has(rest.id),
    ...rest,
    // TikTok thumbnails are never stored (and expire) — see /api/media-thumb.
    thumbnail: isTikTok(rest.url) || !rest.thumbnail ? (isTikTok(rest.url) ? `/api/media-thumb?id=${rest.id}` : "") : rest.thumbnail,
  }));
  return NextResponse.json({
    items: publicItems,
    count: publicItems.length,
    total,
    next_offset: offset + publicItems.length < total ? offset + publicItems.length : null,
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
  // The downloader often only knows the platform's numeric id; fetch the
  // real caption/title (TikTok/X oEmbed) so cards don't show a number.
  if (isPlaceholderTitle(item.title) && item.url) {
    const real = await Promise.race([resolveRealTitle(item.url), new Promise<string>((r) => setTimeout(() => r(""), 4000))]);
    if (real) item.title = real;
  }

  const saved = await saveToSupabase(item);
  if (saved.id) item.id = saved.id;
  g.__mediaFeed = [item, ...(g.__mediaFeed || []).filter((x) => x.id !== item.id)].slice(0, 200);

  // Followers get a bot message about the new share (private squad posts excluded).
  if (saved.id && !item.squad_code) {
    await Promise.race([notifyFollowers(item).catch(() => null), new Promise((r) => setTimeout(r, 8000))]);
  }

  return NextResponse.json({
    ok: true,
    id: item.id,
    persisted: !!saved.id,
    persist_error: saved.error || null,
  });
}

// Public engagement counters only (clone/view/like) -- deliberately no
// secret/owner check here: these are meant to be triggerable by any real
// visitor from the mini-app. Hiding/unhiding content is an owner-only admin
// action and lives exclusively in /api/media-admin, which verifies the
// caller's real Telegram identity; it used to also be reachable here behind
// nothing but a hardcoded default secret, which was both a real
// authorization hole and, once a real secret got configured, would have
// silently broken these legitimate public counters too (same shared check).
// Real bug (fixed): "unlike" used to not exist as its own action -- the
// mini-app's toggleLike() sent action:"like" on EVERY tap, whether liking
// OR un-liking, so every toggle cycle only ever incremented the stored
// count and never brought it back down. A post someone liked and unliked
// a few times while testing ended up with a likes count with no relation
// to reality, and (worse) fed the same inflated-forever pattern into
// "clones" for trending. Each action now maps to a real +1 or -1.
const PATCH_DELTAS: Record<string, { col: string; delta: number }> = {
  clone: { col: "clones", delta: 1 },
  view: { col: "views", delta: 1 },
  like: { col: "likes", delta: 1 },
  unlike: { col: "likes", delta: -1 },
};

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const action = String(body.action || "clone");
  const spec = PATCH_DELTAS[action];
  if (!spec) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const { col, delta } = spec;
  const db = await mediaDb();

  async function bump(d: number) {
    const mem = (g.__mediaFeed || []).find((x) => x.id === id);
    if (mem) (mem as any)[col] = Math.max(0, ((mem as any)[col] || 0) + d);
    if (!db) return;
    const { data } = await db.from("media_feed").select(col).eq("id", id).maybeSingle();
    const next = Math.max(0, Number((data as any)?.[col] || 0) + d);
    await db.from("media_feed").update({ [col]: next }).eq("id", id);
  }

  // Views and likes count once per real Telegram user per post (verified
  // initData), never for the post's own sharer — so refreshing, replaying
  // or scripting the endpoint can't inflate them. Anonymous calls count
  // nothing. Clones are counted by the bot itself.
  if (action === "view" || action === "like" || action === "unlike") {
    const viewer = mediaUser(String(body.init_data || ""));
    if (!viewer || !db) return NextResponse.json({ ok: true, counted: false });
    try {
      if (action === "view") {
        const { data: post } = await db.from("media_feed").select("sharer_id").eq("id", id).maybeSingle();
        if (!post || String((post as any).sharer_id) === viewer.id) return NextResponse.json({ ok: true, counted: false });
        const { error } = await db.from("media_views").insert({ post_id: id, viewer_id: viewer.id });
        if (error) {
          if (error.code === "23505") return NextResponse.json({ ok: true, counted: false });
          throw error;
        }
        await bump(1);
      } else if (action === "like") {
        const { error } = await db.from("media_likes").insert({ post_id: id, user_id: viewer.id });
        if (error) {
          if (error.code === "23505") return NextResponse.json({ ok: true, counted: false });
          throw error;
        }
        await bump(1);
      } else {
        const { data: removed, error } = await db.from("media_likes").delete().eq("post_id", id).eq("user_id", viewer.id).select("post_id");
        if (error) throw error;
        if (!removed?.length) return NextResponse.json({ ok: true, counted: false });
        await bump(-1);
      }
      return NextResponse.json({ ok: true, counted: true });
    } catch {
      // Dedup tables not created yet (migration pending): old behaviour.
      await bump(delta).catch(() => {});
      return NextResponse.json({ ok: true, counted: true, dedup: false });
    }
  }

  try {
    await bump(delta);
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
