// "Born on this day": public facts (names, one-line descriptions) from Wikipedia's open "On this day" feed. No pictures are used.
const cache = new Map<string, { at: number; v: Born }>();
export type Born = { exact: { name: string; about: string; year: number }[]; other: { name: string; about: string; year: number }[]; source: string };
const WIKI = ["ar", "en", "ru", "tr", "fa"];

export async function bornOn(y: number, m: number, d: number, lang: string): Promise<Born> {
  const l = WIKI.includes(lang) ? lang : "en";
  const key = `${l}:${y}-${m}-${d}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.v;
  const mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0");
  const url = `https://api.wikimedia.org/feed/v1/wikipedia/${l}/onthisday/births/${mm}/${dd}`;
  const empty: Born = { exact: [], other: [], source: `https://${l}.wikipedia.org` };
  try {
    const r = await fetch(url, { headers: { "User-Agent": "AtharApp/1.0 (https://athar.89-168-89-15.sslip.io)" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return empty;
    const j = await r.json();
    const rows = (j.births || []).map((x: any) => ({ name: String(x.pages?.[0]?.titles?.normalized || x.text || "").slice(0, 80), about: String(x.pages?.[0]?.description || "").slice(0, 100), year: Number(x.year) })).filter((x: any) => x.name && Number.isFinite(x.year));
    const v: Born = { exact: rows.filter((x: any) => x.year === y).slice(0, 6), other: rows.filter((x: any) => x.year !== y).sort((a: any, b: any) => 0).slice(0, 4), source: `https://${l}.wikipedia.org/wiki/${encodeURIComponent(String(d))}_${m}` };
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch { return empty; }
}
