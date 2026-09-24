export type RssItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  /** Parsed publishedAt (ms), 0 when missing — used for sorting. */
  ts: number;
};

// Checked 2026-09-24 from the server: the old Al Jazeera URL (/aljazeera/arabic/rss)
// returns 404 and Al Arabiya's .mrss returns 403, so the ticker was BBC-only.
// Only feeds that answered 200 with <item>s are listed.
const FEEDS: { source: string; url: string }[] = [
  {
    source: "الجزيرة",
    url: "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9",
  },
  { source: "بي بي سي عربي", url: "https://feeds.bbci.co.uk/arabic/rss.xml" },
  { source: "سكاي نيوز عربية", url: "https://www.skynewsarabia.com/rss" },
  { source: "فرانس 24", url: "https://www.france24.com/ar/rss" },
  { source: "DW عربية", url: "https://rss.dw.com/xml/rss-ar-all" },
  { source: "CNN بالعربية", url: "https://arabic.cnn.com/api/v1/rss/rss.xml" },
  { source: "الشرق الأوسط", url: "https://aawsat.com/feed" },
];

const PER_FEED = 30;
const MAX_AGE_MS = 36 * 3600_000;

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function firstTag(block: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

export function parseFeed(xml: string, source: string): RssItem[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const out: RssItem[] = [];
  for (const raw of items.slice(0, PER_FEED)) {
    const title = firstTag(raw, "title");
    const link = firstTag(raw, "link") || raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() || "";
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const publishedAt = firstTag(raw, "pubDate") || firstTag(raw, "published") || null;
    const ts = publishedAt ? Date.parse(publishedAt) || 0 : 0;
    out.push({ title, link, source, publishedAt, ts });
  }
  return out;
}

/** All recent headlines from every feed, newest first, de-duplicated by link. */
export async function fetchAllNews(): Promise<RssItem[]> {
  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, {
        next: { revalidate: 600 },
        headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0 (compatible; SouqToolsNews/1.0)" },
      });
      if (!res.ok) throw new Error(String(res.status));
      return parseFeed(await res.text(), f.source);
    }),
  );
  const now = Date.now();
  const merged: RssItem[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.link.replace(/\/+$/, "");
      if (seen.has(key)) continue;
      if (item.ts && now - item.ts > MAX_AGE_MS) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.sort((a, b) => b.ts - a.ts);
}

/** Newest headlines across sources, at most 3 in a row from one source. */
export async function fetchNewsTicker(limit = 12): Promise<RssItem[]> {
  return interleaveNews(await fetchAllNews(), limit);
}

export function interleaveNews(items: RssItem[], limit: number): RssItem[] {
  const out: RssItem[] = [];
  const perSource = new Map<string, number>();
  for (const it of items) {
    const n = perSource.get(it.source) ?? 0;
    if (n >= Math.ceil(limit / 3)) continue;
    perSource.set(it.source, n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// «أكثر القصص تغطية»: headlines about the same event from different outlets,
// grouped by shared significant words. We only show each outlet's own headline
// and link — no text is written or summarised by us, so nothing is invented.

const STOP = new Set(
  (
    "في من على الى إلى عن مع بعد قبل حتى هذا هذه ذلك تلك التي الذي الذين ما ماذا لماذا كيف هل لا لم لن قد " +
    "كان كانت يكون تكون او أو ثم بين عند منذ خلال حول ضد دون غير كل بعض اي أي وقال قال قالت يقول تقول " +
    "بعد وفي وعلى ومن اليوم امس أمس الان الآن جديد جديدة اول أول عام العام سنة مقابل رغم وسط " +
    "عاجل فيديو صور شاهد بالصور بالفيديو تقرير مباشر لـ بـ"
  ).split(/\s+/),
);

function normWord(w: string) {
  let s = w
    .replace(/[ً-ْـ]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
  // strip common one-letter proclitics and the article
  s = s.replace(/^(و|ف|ب|ل|ك)?ال/, "").replace(/^(و|ف)(?=\S{3,})/, "");
  return s;
}

// Two-word names that are one concept: without this, «الذكاء الاصطناعي» or
// «البيت الأبيض» alone counted as two shared words and merged unrelated stories.
const PHRASES = [
  "الذكاء الاصطناعي",
  "البيت الأبيض",
  "الولايات المتحدة",
  "الأمم المتحدة",
  "مجلس الأمن",
  "الشرق الأوسط",
  "الاتحاد الأوروبي",
  "كأس العالم",
  "قطاع غزة",
  "الضفة الغربية",
  "كوريا الشمالية",
  "كوريا الجنوبية",
  "وزير الخارجية",
  "رئيس الوزراء",
  "الرئيس الأمريكي",
  "الرئيس الأميركي",
];

function keywords(title: string): Set<string> {
  let t = title;
  // also catches a joined prefix: «بالذكاء الاصطناعي», «والولايات المتحدة»
  for (const p of PHRASES) t = t.replace(new RegExp(`[وفبلك]?${p}`, "g"), p.replace(" ", "_"));
  const words = t
    .replace(/[^\u0600-\u06FFA-Za-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    if (STOP.has(w)) continue;
    const n = normWord(w);
    if (n.length < 3 || STOP.has(n)) continue;
    out.add(n);
  }
  return out;
}

export type NewsCluster = {
  /** Headlines about one story, one per outlet, newest first. */
  items: RssItem[];
  sources: number;
  latest: number;
};

export function clusterHeadlines(items: RssItem[], minSources = 2): NewsCluster[] {
  const kw = items.map((i) => keywords(i.title));
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].source === items[b].source) continue;
      let shared = 0;
      for (const w of kw[a]) if (kw[b].has(w)) shared++;
      const smaller = Math.min(kw[a].size, kw[b].size);
      // Two distinct significant words in common, covering a good part of the
      // shorter headline — tuned on real feeds to avoid "same country" merges.
      if (shared >= 2 && shared / Math.max(1, smaller) >= 0.34) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, RssItem[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  });
  const clusters: NewsCluster[] = [];
  for (const g of groups.values()) {
    const bySource = new Map<string, RssItem>();
    for (const it of g.sort((x, y) => y.ts - x.ts)) if (!bySource.has(it.source)) bySource.set(it.source, it);
    if (bySource.size < minSources) continue;
    const list = [...bySource.values()];
    clusters.push({ items: list, sources: list.length, latest: list[0].ts });
  }
  return clusters.sort((a, b) => b.sources - a.sources || b.latest - a.latest);
}

export async function fetchTopStories(limit = 6): Promise<NewsCluster[]> {
  return clusterHeadlines(await fetchAllNews()).slice(0, limit);
}
