export type RssItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
};

const FEEDS: { source: string; url: string }[] = [
  { source: "الجزيرة", url: "https://www.aljazeera.net/aljazeera/arabic/rss" },
  { source: "بي بي سي عربي", url: "https://feeds.bbci.co.uk/arabic/rss.xml" },
  { source: "العربية", url: "https://www.alarabiya.net/.mrss/ar.xml" },
];

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function firstTag(block: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

function parseFeed(xml: string, source: string): RssItem[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const out: RssItem[] = [];
  for (const raw of items.slice(0, 8)) {
    const title = firstTag(raw, "title");
    const link =
      firstTag(raw, "link") ||
      raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() ||
      "";
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const publishedAt =
      firstTag(raw, "pubDate") || firstTag(raw, "published") || null;
    out.push({ title, link, source, publishedAt });
  }
  return out;
}

export async function fetchNewsTicker(limit = 12): Promise<RssItem[]> {
  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, {
        next: { revalidate: 600 },
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const xml = await res.text();
      return parseFeed(xml, f.source);
    }),
  );
  const merged: RssItem[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.link.replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.slice(0, limit);
}
