import { prisma } from "@/lib/prisma";

// «رموز» footage store: every English concept query the tool has ever looked
// up, with the real clips found for it (from Pexels, free licence). Each new
// word a visitor writes grows the store; repeated words are served from here
// without touching the Pexels API. Created on first use, like bashar's tables.

export type Clip = {
  id: number;
  kind: "video" | "photo";
  words: string; // what the clip shows (its Pexels title), used for matching
  url: string; // mp4 or jpeg, CORS-enabled
  poster: string;
  w: number;
  h: number;
  dur: number;
  author: string;
  authorUrl: string;
  page: string;
};

const FRESH_DAYS = 30;
let ready: Promise<void> | null = null;

function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS rumooz_clips (
          query text NOT NULL,
          kind text NOT NULL,
          media_id bigint NOT NULL,
          words text NOT NULL,
          file_url text NOT NULL,
          poster text,
          width int,
          height int,
          duration real,
          author text,
          author_url text,
          page_url text,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (query, kind, media_id)
        )`);
      await prisma.$executeRawUnsafe(`ALTER TABLE rumooz_clips ENABLE ROW LEVEL SECURITY`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export const pexelsConfigured = () => Boolean(process.env.PEXELS_API_KEY);

function slugWords(pageUrl: string) {
  // https://www.pexels.com/video/a-cat-playing-with-a-ball-854982/ → "a cat playing with a ball"
  const m = pageUrl.match(/\/(?:video|photo)\/([^/]+?)-?\d*\/?$/);
  return m ? m[1].replace(/-/g, " ").trim() : "";
}

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: { name: string; url: string };
  video_files: { link: string; width: number; height: number; file_type: string }[];
};
type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string;
  photographer: string;
  photographer_url: string;
  src: { large: string; portrait: string };
};

function pickFile(v: PexelsVideo) {
  const files = v.video_files.filter((f) => f.file_type === "video/mp4" && f.link.startsWith("https://videos.pexels.com/") && f.width && f.height);
  // smallest file that still fills a 540×960 frame; otherwise the largest there is
  const fits = files.filter((f) => Math.min(f.width, f.height) >= 540).sort((a, b) => a.width * a.height - b.width * b.height);
  return fits[0] || files.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

async function pexels<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.pexels.com${path}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY || "" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function fetchFromPexels(query: string): Promise<Clip[]> {
  const q = encodeURIComponent(query);
  const clips: Clip[] = [];
  for (const orientation of ["portrait", ""]) {
    const data = await pexels<{ videos: PexelsVideo[] }>(`/videos/search?query=${q}&per_page=15${orientation ? `&orientation=${orientation}` : ""}`);
    for (const v of data?.videos || []) {
      const f = pickFile(v);
      if (!f || clips.some((c) => c.id === v.id)) continue;
      clips.push({ id: v.id, kind: "video", words: slugWords(v.url), url: f.link, poster: v.image, w: f.width, h: f.height, dur: v.duration, author: v.user?.name || "", authorUrl: v.user?.url || "", page: v.url });
    }
    if (clips.length >= 8) break;
  }
  if (clips.length < 3) {
    // no footage for this idea: real photographs, animated by the camera
    const data = await pexels<{ photos: PexelsPhoto[] }>(`/v1/search?query=${q}&per_page=10&orientation=portrait`);
    for (const p of data?.photos || []) {
      clips.push({ id: p.id, kind: "photo", words: p.alt || slugWords(p.url), url: p.src.portrait || p.src.large, poster: p.src.portrait || p.src.large, w: 800, h: 1200, dur: 0, author: p.photographer, authorUrl: p.photographer_url, page: p.url });
    }
  }
  return clips;
}

type Row = { kind: string; media_id: bigint; words: string; file_url: string; poster: string | null; width: number | null; height: number | null; duration: number | null; author: string | null; author_url: string | null; page_url: string | null };

/** Clips for one English query: from the store if we already have them, else from Pexels (and stored). */
export async function clipsFor(query: string): Promise<Clip[]> {
  await ensureTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT kind, media_id, words, file_url, poster, width, height, duration, author, author_url, page_url
     FROM rumooz_clips WHERE query = $1 AND created_at > now() - interval '${FRESH_DAYS} days'`,
    query,
  );
  if (rows.length) {
    return rows.map((r) => ({
      id: Number(r.media_id),
      kind: r.kind as Clip["kind"],
      words: r.words,
      url: r.file_url,
      poster: r.poster || "",
      w: r.width || 0,
      h: r.height || 0,
      dur: r.duration || 0,
      author: r.author || "",
      authorUrl: r.author_url || "",
      page: r.page_url || "",
    }));
  }
  const clips = await fetchFromPexels(query);
  for (const c of clips) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO rumooz_clips (query, kind, media_id, words, file_url, poster, width, height, duration, author, author_url, page_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (query, kind, media_id) DO UPDATE SET file_url = EXCLUDED.file_url, created_at = now()`,
      query,
      c.kind,
      c.id,
      c.words,
      c.url,
      c.poster,
      c.w,
      c.h,
      c.dur,
      c.author,
      c.authorUrl,
      c.page,
    );
  }
  return clips;
}

export async function storeSize(): Promise<{ queries: number; clips: number }> {
  await ensureTable();
  const r = await prisma.$queryRawUnsafe<{ q: bigint; c: bigint }[]>(`SELECT count(DISTINCT query)::bigint AS q, count(*)::bigint AS c FROM rumooz_clips`);
  return { queries: Number(r[0]?.q ?? 0), clips: Number(r[0]?.c ?? 0) };
}
