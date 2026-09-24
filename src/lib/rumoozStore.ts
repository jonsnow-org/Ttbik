import { prisma } from "@/lib/prisma";

// «رموز» footage store: every English concept query the tool has ever looked
// up, with the real clips found for it. Sources: Pexels (free licence, when
// PEXELS_API_KEY is set) and Wikimedia Commons (free licences, no key needed).
// Each new word a visitor writes grows the store; repeated words are served
// from here. Created on first use, like bashar's tables.

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

const UA = "TtbikRumooz/1.0 (https://ttbik.vercel.app)";
const stripHtml = (x: string) => x.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

type CommonsPage = {
  title: string;
  videoinfo?: { width: number; height: number; duration?: number; descriptionurl: string; derivatives?: { src: string; type: string; width: number; height: number }[]; extmetadata?: Record<string, { value: string }> }[];
  imageinfo?: { width: number; height: number; thumburl?: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[];
};

async function commons(query: string, filetype: "video" | "bitmap"): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:${filetype} ${NOT_FOOTAGE_SEARCH}`,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: filetype === "video" ? "videoinfo" : "imageinfo",
    ...(filetype === "video" ? { viprop: "url|size|derivatives|extmetadata" } : { iiprop: "url|size|extmetadata", iiurlwidth: "1080" }),
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  return Object.values(data.query?.pages || {});
}

// Only real camera footage / photographs: no drawings, prints, animation, film trailers, maps, diagrams…
const NOT_FOOTAGE = /\b(drawing|illustration|engraving|lithograph|painting|print|poster|map|diagram|chart|logo|icon|cartoon|anime|animation|animated|render|3d|cgi|sketch|trailer|film|movie|lecture|interview|slideshow|screenshot|billboard|advertisement|stereograph|postcard|stamp|coin|manuscript|book|page|scan|plate|figure|svg|clip art)\b|\b1[5-9]\d\d\b/i;
const NOT_FOOTAGE_SEARCH = "-drawing -illustration -painting -engraving -cartoon -animation -trailer -map -diagram";

const titleWords = (title: string) => title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_\-()]+/g, " ").trim();

/** Real footage and photos from Wikimedia Commons (no key). Short clips only, 480p WebM. */
async function fetchFromCommons(query: string): Promise<Clip[]> {
  const clips: Clip[] = [];
  for (const p of await commons(query, "video")) {
    const v = p.videoinfo?.[0];
    if (!v || !v.duration || v.duration < 3 || v.duration > 120) continue;
    if (NOT_FOOTAGE.test(`${p.title} ${stripHtml(v.extmetadata?.ImageDescription?.value || "")} ${stripHtml(v.extmetadata?.Categories?.value || "")}`)) continue;
    const webm = (v.derivatives || []).filter((d) => d.type.startsWith("video/webm") && d.src.includes("/transcoded/") && d.height >= 360 && d.height <= 720).sort((a, b) => a.height - b.height)[0];
    if (!webm) continue;
    const meta = v.extmetadata || {};
    clips.push({
      id: hash(p.title),
      kind: "video",
      words: `${titleWords(p.title)} ${stripHtml(meta.ImageDescription?.value || "").slice(0, 160)}`,
      url: webm.src,
      poster: "",
      w: webm.width,
      h: webm.height,
      dur: v.duration,
      author: `${stripHtml(meta.Artist?.value || "Wikimedia Commons").slice(0, 60)} (${meta.LicenseShortName?.value || "Commons"})`,
      authorUrl: v.descriptionurl,
      page: v.descriptionurl,
    });
  }
  if (clips.length < 4) {
    for (const p of await commons(query, "bitmap")) {
      const im = p.imageinfo?.[0];
      if (!im?.thumburl || im.width < 800) continue;
      if (NOT_FOOTAGE.test(`${p.title} ${stripHtml(im.extmetadata?.ImageDescription?.value || "")} ${stripHtml(im.extmetadata?.Categories?.value || "")}`)) continue;
      const meta = im.extmetadata || {};
      clips.push({
        id: hash(p.title),
        kind: "photo",
        words: `${titleWords(p.title)} ${stripHtml(meta.ImageDescription?.value || "").slice(0, 160)}`,
        url: im.thumburl,
        poster: im.thumburl,
        w: im.width,
        h: im.height,
        dur: 0,
        author: `${stripHtml(meta.Artist?.value || "Wikimedia Commons").slice(0, 60)} (${meta.LicenseShortName?.value || "Commons"})`,
        authorUrl: im.descriptionurl,
        page: im.descriptionurl,
      });
    }
  }
  return clips;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
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
  let stored = true;
  try {
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
  } catch (e) {
    // the store is an accelerator: without it the tool still fetches live
    console.error("rumooz store unavailable", e);
    stored = false;
  }
  let clips = pexelsConfigured() ? await fetchFromPexels(query).catch(() => []) : [];
  if (clips.length < 6) clips = clips.concat(await fetchFromCommons(query).catch(() => []));
  if (!stored) return clips;
  for (const c of clips) {
    await prisma
      .$executeRawUnsafe(
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
      )
      .catch(() => null);
  }
  return clips;
}

export async function storeSize(): Promise<{ queries: number; clips: number }> {
  await ensureTable();
  const r = await prisma.$queryRawUnsafe<{ q: bigint; c: bigint }[]>(`SELECT count(DISTINCT query)::bigint AS q, count(*)::bigint AS c FROM rumooz_clips`);
  return { queries: Number(r[0]?.q ?? 0), clips: Number(r[0]?.c ?? 0) };
}
