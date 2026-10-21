// Web tools for the coder agent — zero cost, no API keys (owner's rule, 2026-10-21):
//   web_search    : the public HTML result pages of Brave Search and Bing (fallback DuckDuckGo HTML), parsed here; Wikipedia's free API as a last resort.
//   fetch_page    : fetches a page itself and extracts the readable part as Markdown (no third-party reader service).
//   deep_research : several queries in parallel → ranked, de-duplicated sources → many pages read → passages scored against the question,
//                   cross-source corroboration → a numbered source list the model cites as [n].
// Safety: http(s) only; no .onion/.i2p/.loki (no dark web); no localhost / private / link-local / metadata addresses (checked after DNS);
// size and time caps; redirects followed by hand so every hop is checked again.
import { lookup } from "dns/promises";
import { isIP } from "net";

export type SearchHit = { title: string; url: string; snippet: string; source: string };
type Fetch = typeof fetch;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 2_500_000;

// ---------------------------------------------------------------- html helpers
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- address safety
const BLOCKED_TLD = /\.(onion|i2p|loki|bit|exit)\.?$/i;
export function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return privateIp(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}
export type UrlCheck = { ok: true; url: URL } | { ok: false; why: string };
export async function checkUrl(raw: string, resolve: (h: string) => Promise<string[]> = defaultResolve): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: "not a valid URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, why: "only http(s) URLs" };
  if (u.username || u.password) return { ok: false, why: "URLs with credentials are not allowed" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_TLD.test(host)) return { ok: false, why: "dark-web / overlay network addresses are not allowed" };
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return { ok: false, why: "local / internal addresses are not allowed" };
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!ips.length) return { ok: false, why: "host not found" };
  if (ips.some(privateIp)) return { ok: false, why: "private / internal network addresses are not allowed" };
  return { ok: true, url: u };
}
async function defaultResolve(h: string): Promise<string[]> {
  return (await lookup(h, { all: true })).map((r) => r.address);
}

export type FetchOpts = { fetchImpl?: Fetch; resolve?: (h: string) => Promise<string[]>; timeoutMs?: number; accept?: string };
/** GET with every redirect hop re-checked, a byte cap and a deadline. */
export async function safeGet(raw: string, o: FetchOpts = {}): Promise<{ status: number; url: string; type: string; body: string }> {
  const f = o.fetchImpl || globalThis.fetch;
  const deadline = Date.now() + (o.timeoutMs || 15000);
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const c = await checkUrl(url, o.resolve);
    if (!c.ok) throw new Error(c.why);
    const r = await f(c.url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: o.accept || "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5", "Accept-Language": "en,ar;q=0.8" },
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location")!, c.url).toString();
      continue;
    }
    const type = (r.headers.get("content-type") || "").toLowerCase();
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) throw new Error(`too large (${len} bytes)`);
    const body = await readCapped(r, MAX_BYTES);
    return { status: r.status, url: c.url.toString(), type, body };
  }
  throw new Error("too many redirects");
}
async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body || typeof (r.body as any).getReader !== "function") return (await r.text()).slice(0, max);
  const reader = (r.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= max) {
      await reader.cancel().catch(() => null);
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

// ---------------------------------------------------------------- search providers (result pages parsed here)
export function parseBrave(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const parts = html.split(/data-type="web"/).slice(1);
  for (const p of parts) {
    const href = p.match(/<a[^>]+href="(https?:\/\/[^"]+)"/)?.[1];
    if (!href || /search\.brave\.com/.test(href)) continue;
    const title = p.match(/search-snippet-title[^>]*title="([^"]*)"/)?.[1] || stripTags(p.match(/search-snippet-title[^>]*>([\s\S]*?)<\/div>/)?.[1] || "");
    const snip = p.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    out.push({ title: decodeEntities(title).trim(), url: decodeEntities(href), snippet: stripTags(snip).replace(/^[A-Z][a-z]+ \d{1,2}, \d{4} -\s*/, ""), source: "brave" });
  }
  return out;
}
function bingTarget(href: string): string {
  const h = decodeEntities(href);
  const u = h.match(/[?&]u=a1([^&]+)/)?.[1];
  if (u) {
    try {
      const t = Buffer.from(u.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/^https?:\/\//.test(t)) return t;
    } catch {
      /* keep the original */
    }
  }
  return h;
}
export function parseBing(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  for (const blk of html.split(/<li class="b_algo"/).slice(1)) {
    const a = blk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const snip = blk.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] || blk.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || "";
    const url = bingTarget(a[1]);
    if (!/^https?:\/\//.test(url) || /bing\.com\//.test(url)) continue;
    out.push({ title: stripTags(a[2]), url, snippet: stripTags(snip).replace(/^\d{1,2} \w+ \d{4}\s*·\s*/, ""), source: "bing" });
  }
  return out;
}
export function parseDdg(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  for (const blk of html.split(/class="result results_links/).slice(1)) {
    const a = blk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decodeEntities(a[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/)?.[1];
    if (uddg) url = decodeURIComponent(uddg);
    if (url.startsWith("//")) url = "https:" + url;
    const snip = blk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] || "";
    if (/^https?:\/\//.test(url) && !/duckduckgo\.com\/y\.js/.test(url)) out.push({ title: stripTags(a[2]), url, snippet: stripTags(snip), source: "duckduckgo" });
  }
  return out;
}

export function parseSearx(json: string): SearchHit[] {
  try {
    const d = JSON.parse(json);
    return (Array.isArray(d?.results) ? d.results : [])
      .filter((x: any) => /^https?:\/\//.test(String(x?.url || "")))
      .map((x: any) => ({ title: stripTags(String(x.title || "")), url: String(x.url), snippet: stripTags(String(x.content || "")), source: "searxng" }));
  } catch {
    return [];
  }
}
export function parseDdgLite(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const rx = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
  for (let m; (m = rx.exec(html)); ) {
    let url = decodeEntities(m[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/)?.[1];
    if (uddg) url = decodeURIComponent(uddg);
    if (url.startsWith("//")) url = "https:" + url;
    if (/^https?:\/\//.test(url) && !/duckduckgo\.com\//.test(url)) out.push({ title: stripTags(m[2]), url, snippet: stripTags(m[3]), source: "duckduckgo" });
  }
  return out;
}

type Provider = { name: string; tier: "primary" | "backup"; url: (q: string, lang: string) => string; parse: (html: string) => SearchHit[]; accept?: string };
/** Free engines, no keys. Primaries are asked together; backups only when the primaries left too little (or are cooling down).
 *  Optional: CODER_SEARXNG_URLS = comma list of SearXNG instances with the JSON format enabled (e.g. self-hosted on free compute). */
export function providers(): Provider[] {
  const list: Provider[] = [
    { name: "brave", tier: "primary", url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, parse: parseBrave },
    { name: "bing", tier: "primary", url: (q, lang) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=${lang}&count=15`, parse: parseBing },
    { name: "duckduckgo", tier: "primary", url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDdg },
    { name: "duckduckgo-lite", tier: "backup", url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, parse: parseDdgLite },
  ];
  (process.env.CODER_SEARXNG_URLS || "")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter((x) => /^https:\/\//.test(x))
    .slice(0, 3)
    .forEach((base, i) => list.push({ name: `searxng${i + 1}`, tier: "backup", url: (q, lang) => `${base}/search?q=${encodeURIComponent(q)}&format=json&language=${lang}`, parse: parseSearx, accept: "application/json" }));
  return list;
}

// health: an engine that failed twice in a row (error, block page, captcha, off-topic answers) rests for a while (per server instance)
const health = new Map<string, { fails: number; until: number; ok: number }>();
const REST_MS = 10 * 60000;
function mark(name: string, good: boolean): void {
  const h = health.get(name) || { fails: 0, until: 0, ok: 0 };
  if (good) Object.assign(h, { fails: 0, until: 0, ok: Date.now() });
  else if (++h.fails >= 2) h.until = Date.now() + REST_MS * Math.min(4, h.fails - 1);
  health.set(name, h);
}
const resting = (name: string, now = Date.now()) => (health.get(name)?.until || 0) > now;
export function searchHealth(now = Date.now()): { name: string; tier: string; ok: boolean; restingUntil: number | null; lastOk: number | null }[] {
  const rows = providers().map((p) => ({ name: p.name, tier: p.tier, ok: !resting(p.name, now), restingUntil: resting(p.name, now) ? health.get(p.name)!.until : null, lastOk: health.get(p.name)?.ok || null }));
  rows.push({ name: "wikipedia", tier: "backup", ok: !resting("wikipedia", now), restingUntil: resting("wikipedia", now) ? health.get("wikipedia")!.until : null, lastOk: health.get("wikipedia")?.ok || null });
  return rows;
}
/** Tests. */
export function resetSearchHealth(): void {
  health.clear();
  nextSlot.clear();
}

async function wikipedia(q: string, lang: string, o: FetchOpts): Promise<SearchHit[]> {
  const l = /^[a-z]{2}$/.test(lang) ? lang : "en";
  const r = await safeGet(`https://${l}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=8`, { ...o, accept: "application/json" });
  const d = JSON.parse(r.body);
  return (d?.query?.search || []).map((x: any) => ({ title: String(x.title), url: `https://${l}.wikipedia.org/wiki/${encodeURIComponent(String(x.title).replace(/ /g, "_"))}`, snippet: stripTags(String(x.snippet || "")), source: "wikipedia" }));
}

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ref_src)/.test(k)) x.searchParams.delete(k);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u;
  }
}

const langOf = (q: string) => (/[\u0600-\u06FF]/.test(q) ? "ar" : "en");

// a tiny per-provider spacing so parallel research queries do not trip a provider's rate limit (Brave answers 429 quickly)
const GAP_MS: Record<string, number> = { brave: 1200, bing: 400, duckduckgo: 700 };
const nextSlot = new Map<string, number>();
async function spaced(name: string): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(name) || 0);
  nextSlot.set(name, at + (GAP_MS[name] || 500));
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
export function relevance(q: string, hits: SearchHit[]): number {
  const qt = terms(q).map((t) => t.replace(/[.()]/g, ""));
  if (!hits.length || !qt.length) return hits.length ? 1 : 0;
  const ok = hits.filter((h) => {
    const t = `${h.title} ${h.snippet} ${h.url}`.toLowerCase();
    return qt.filter((x) => x && t.includes(x)).length >= Math.min(2, qt.length);
  }).length;
  return ok / hits.length;
}

/**
 * One query: all providers at once, each provider's list kept only if it is actually about the query (some engines answer automated
 * clients with generic results), merged round-robin by rank, de-duplicated. Wikipedia's API fills in when little is left. Never throws.
 */
export async function webSearch(query: string, opts: FetchOpts & { limit?: number; lang?: string } = {}): Promise<{ hits: SearchHit[]; tried: string[] }> {
  const q = query.trim().slice(0, 300);
  const lang = opts.lang || langOf(q);
  const limit = Math.max(1, Math.min(20, opts.limit || 8));
  const tried: string[] = [];
  const ask = (list: Provider[]) =>
    Promise.all(
      list.map(async (p) => {
        try {
          await spaced(p.name);
          const r = await safeGet(p.url(q, lang), { ...opts, timeoutMs: opts.timeoutMs || 9000, ...(p.accept ? { accept: p.accept } : {}) });
          const got = r.status === 200 ? p.parse(r.body) : [];
          const rel = relevance(q, got);
          tried.push(`${p.name}:${r.status}/${got.length}${got.length ? `@${rel.toFixed(1)}` : ""}`);
          mark(p.name, got.length > 0 && rel >= 0.3);
          return rel >= 0.3 ? got : [];
        } catch (e) {
          tried.push(`${p.name}:error(${String((e as Error)?.message || e).slice(0, 60)})`);
          mark(p.name, false);
          return [];
        }
      }),
    );
  const all = providers();
  const now = Date.now();
  const up = all.filter((p) => !resting(p.name, now));
  const primaries = up.filter((p) => p.tier === "primary");
  const backups = up.filter((p) => p.tier === "backup");
  for (const p of all) if (resting(p.name, now)) tried.push(`${p.name}:resting`);
  // every engine resting = try them all anyway (better a slow answer than none)
  const first = primaries.length ? primaries : backups.length ? backups : all;
  const lists = await ask(first);
  if (lists.flat().length < 3 && first !== all) {
    const rest = (first === primaries ? backups : []).filter((p) => !first.includes(p));
    if (rest.length) lists.push(...(await ask(rest)));
  }
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const add = (h: SearchHit) => {
    const k = normUrl(h.url);
    if (!h.url || seen.has(k) || BLOCKED_TLD.test(safeHost(h.url))) return;
    seen.add(k);
    hits.push(h);
  };
  for (let i = 0; i < 20; i++) for (const l of lists) if (l[i]) add(l[i]);
  if (hits.length < 3) {
    try {
      const w = await wikipedia(q, lang, opts);
      w.forEach(add);
      mark("wikipedia", w.length > 0);
      tried.push("wikipedia");
    } catch {
      mark("wikipedia", false);
      tried.push("wikipedia:error");
    }
  }
  return { hits: hits.slice(0, limit), tried };
}
const safeHost = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- readable extraction -> Markdown
export function htmlToMarkdown(html: string, base = ""): { title: string; markdown: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head\b[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style|noscript|svg|iframe|template|canvas|form|button|select)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(link|meta|input|source)\b("[^"]*"|'[^']*'|[^'">])*>/gi, "")
    .replace(/<(sup|span)[^>]*class="[^"]*(mw-editsection|reference)[^"]*"[\s\S]*?<\/\1>/gi, "");
  const pick = h.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || h.match(/<div[^>]+(?:id|class)="[^"]*(?:content|article|post|markdown|docs?-body|entry)[^"]*"[\s\S]*$/i)?.[0] || h.match(/<body\b[\s\S]*<\/body>/i)?.[0] || h;
  h = pick.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
  const abs = (u: string) => {
    try {
      return base ? new URL(decodeEntities(u), base).toString() : decodeEntities(u);
    } catch {
      return decodeEntities(u);
    }
  };
  h = h
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c: string) => `\n\n\`\`\`\n${decodeEntities(c.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n+$/, "")}\n\`\`\`\n\n`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, c: string) => `\`${stripTags(c)}\``)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, c: string) => `\n\n${"#".repeat(Number(n))} ${stripTags(c)}\n\n`)
    .replace(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u: string, c: string) => {
      const t = stripTags(c);
      return t ? `[${t}](${abs(u)})` : "";
    })
    .replace(/<img\b[^>]*alt="([^"]+)"[^>]*>/gi, (_m, a: string) => `[image: ${decodeEntities(a)}]`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|ul|ol|table|blockquote|li)>/gi, "\n\n")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, c: string) => `**${stripTags(c)}**`);
  // keep fenced code as-is, clean the rest
  const segs = h.split(/(\n```[\s\S]*?\n```\n)/);
  const md = segs
    .map((sg, i) => (i % 2 ? sg : decodeEntities(sg.replace(/<[^>]+>/g, " ")).replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")))
    .join("")
    .trim();
  return { title, markdown: md };
}

export async function fetchPage(url: string, opts: FetchOpts & { maxChars?: number } = {}): Promise<{ ok: boolean; url: string; title: string; markdown: string; error?: string }> {
  const max = Math.max(1000, Math.min(60000, opts.maxChars || 20000));
  try {
    const r = await safeGet(url, opts);
    if (r.status >= 400) return { ok: false, url: r.url, title: "", markdown: "", error: `HTTP ${r.status}` };
    if (/pdf|octet-stream|image\/|video\/|audio\/|zip/.test(r.type)) return { ok: false, url: r.url, title: "", markdown: "", error: `unsupported content type ${r.type}` };
    if (/json|text\/plain|markdown|x-yaml|javascript|typescript|csv/.test(r.type) || !/<html|<body|<div|<p[\s>]/i.test(r.body.slice(0, 5000))) {
      return { ok: true, url: r.url, title: "", markdown: r.body.slice(0, max) };
    }
    const { title, markdown } = htmlToMarkdown(r.body, r.url);
    return { ok: true, url: r.url, title, markdown: markdown.slice(0, max) };
  } catch (e) {
    return { ok: false, url, title: "", markdown: "", error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------- deep research
const STOP = new Set("the a an of to in on for and or is are was be with by as at from that this it how what why when which who does do vs versus best use using can".split(" ").concat("في من على إلى عن ما هو هي كيف لماذا متى هل أو و مع".split(" ")));
export const terms = (s: string) => [...new Set(s.toLowerCase().split(/[^\p{L}\p{N}_.+#-]+/u).filter((w) => w.length > 1 && !STOP.has(w)))];

/** Query variants when the model gave none: the question, a docs-oriented one, a recent one, a comparison/problem one. */
export function planQueries(question: string, given: string[] = [], now = new Date()): string[] {
  const q = question.trim().replace(/\s+/g, " ").slice(0, 200);
  const key = terms(q).slice(0, 6).join(" ");
  const out = [...given.map((x) => String(x).trim()).filter(Boolean)];
  if (!out.length) {
    out.push(q);
    if (key && key !== q.toLowerCase()) out.push(key);
    out.push(`${key || q} documentation`);
    out.push(`${key || q} ${now.getUTCFullYear()}`);
    if (/ vs |versus|compare|مقارنة|أفضل|best/i.test(q)) out.push(`${key} comparison benchmark`);
    else out.push(`${key || q} problems issues`);
  }
  return [...new Set(out.map((x) => x.slice(0, 200)))].slice(0, 8);
}

export function passages(markdown: string, qTerms: string[], n = 3): { text: string; score: number }[] {
  const linkShare = (p: string) => (p.match(/\[[^\]]*\]\([^)]*\)/g) || []).join("").length / Math.max(1, p.length);
  const paras = markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 60 && p.length < 2500 && linkShare(p) < 0.6 && !/(rel=|data-[a-z-]+=|class=|style=)"/.test(p));
  const df = new Map<string, number>();
  for (const p of paras) for (const t of new Set(terms(p))) df.set(t, (df.get(t) || 0) + 1);
  const scored = paras.map((p) => {
    const pt = terms(p);
    let s = 0;
    for (const t of qTerms) if (pt.includes(t)) s += Math.log(1 + paras.length / (1 + (df.get(t) || 0)));
    if (/```/.test(p)) s *= 1.1;
    return { text: p.slice(0, 900), score: s / Math.sqrt(1 + pt.length / 60) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
}

const GOOD_DOMAINS = /(^|\.)(github\.com|docs\.|developer\.|mozilla\.org|wikipedia\.org|stackoverflow\.com|readthedocs\.io|python\.org|nodejs\.org|nextjs\.org|react\.dev|vercel\.com|microsoft\.com|google\.com|arxiv\.org|w3\.org|ietf\.org|npmjs\.com|pypi\.org)/i;
const WEAK_DOMAINS = /(pinterest|facebook|instagram|tiktok|quora|medium\.com\/tag|linkedin\.com\/posts)/i;

export type ResearchSource = { n: number; title: string; url: string; snippet: string; passages: string[]; ok: boolean; foundBy: number };
export async function deepResearch(
  question: string,
  opts: FetchOpts & { queries?: string[]; maxSources?: number; deadlineMs?: number } = {},
): Promise<{ question: string; queries: string[]; sources: ResearchSource[]; corroborated: { term: string; sources: number[] }[]; tried: string[] }> {
  const t0 = Date.now();
  const deadline = opts.deadlineMs || 28000;
  const left = () => deadline - (Date.now() - t0);
  const queries = planQueries(question, opts.queries);
  const qTerms = terms(question);
  const tried: string[] = [];
  const pool = new Map<string, { hit: SearchHit; count: number; rank: number }>();
  const results = await Promise.all(queries.map((q) => webSearch(q, { ...opts, limit: 10, timeoutMs: Math.min(9000, left()) }).catch(() => ({ hits: [], tried: ["error"] }))));
  results.forEach((r, qi) => {
    tried.push(`q${qi + 1}[${r.tried.join(",")}]`);
    r.hits.forEach((h, i) => {
      const k = normUrl(h.url);
      const cur = pool.get(k);
      if (cur) {
        cur.count++;
        cur.rank = Math.min(cur.rank, i);
      } else pool.set(k, { hit: h, count: 1, rank: i });
    });
  });
  const ranked = [...pool.values()]
    .map((x) => {
      const host = safeHost(x.hit.url);
      const rel = terms(`${x.hit.title} ${x.hit.snippet}`).filter((t) => qTerms.includes(t)).length;
      let path = "/";
      try {
        path = new URL(x.hit.url).pathname;
      } catch {
        /* keep "/" */
      }
      const thin = path === "/" || /\/(login|signin|signup|register|account|cart)\b/i.test(path);
      return { ...x, score: x.count * 1.5 + rel * 2.5 - x.rank * 0.3 + (GOOD_DOMAINS.test(host) ? 2 : 0) - (WEAK_DOMAINS.test(host) ? 4 : 0) - (thin ? 5 : 0) - (rel === 0 ? 4 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  // at most 2 sources per site: breadth over depth
  const perHost = new Map<string, number>();
  const chosen = ranked.filter((x) => {
    const h = safeHost(x.hit.url).replace(/^www\./, "");
    const c = perHost.get(h) || 0;
    if (c >= 2) return false;
    perHost.set(h, c + 1);
    return true;
  }).slice(0, Math.max(3, Math.min(16, opts.maxSources || 10)));
  const pages = await Promise.all(chosen.map((x) => (left() > 3000 ? fetchPage(x.hit.url, { ...opts, timeoutMs: Math.min(12000, left() - 1500), maxChars: 40000 }) : Promise.resolve({ ok: false, url: x.hit.url, title: "", markdown: "", error: "deadline" }))));
  const sources: ResearchSource[] = chosen.map((x, i) => {
    const p = pages[i];
    const ps = p.ok ? passages(p.markdown, qTerms, 3).map((y) => y.text) : [];
    return { n: i + 1, title: p.title || x.hit.title, url: x.hit.url, snippet: x.hit.snippet, passages: ps, ok: p.ok && ps.length > 0, foundBy: x.count };
  });
  // which question terms several sources agree on (a cheap corroboration signal for the model)
  const corroborated = qTerms
    .map((t) => ({ term: t, sources: sources.filter((s) => s.passages.some((p) => p.toLowerCase().includes(t))).map((s) => s.n) }))
    .filter((x) => x.sources.length >= 2)
    .slice(0, 12);
  return { question, queries, sources, corroborated, tried };
}

export function formatResearch(r: Awaited<ReturnType<typeof deepResearch>>, maxChars = 24000): string {
  const lines: string[] = [
    `Deep research for: ${r.question}`,
    `Queries: ${r.queries.map((q) => `"${q}"`).join(" · ")}`,
    `Sources read: ${r.sources.filter((s) => s.ok).length}/${r.sources.length}`,
    "",
    "Write the answer from these sources only. Cite every claim as [n]. Compare where sources disagree, say which is newer/more authoritative, and say what remains uncertain.",
    "",
  ];
  for (const s of r.sources) {
    lines.push(`[${s.n}] ${s.title} — ${s.url}${s.foundBy > 1 ? ` (found by ${s.foundBy} queries)` : ""}`);
    if (s.passages.length) for (const p of s.passages) lines.push(`  > ${p.replace(/\n+/g, " ")}`);
    else if (s.snippet) lines.push(`  (not readable; search snippet) ${s.snippet}`);
    lines.push("");
  }
  if (r.corroborated.length) lines.push(`Corroboration: ${r.corroborated.map((c) => `${c.term}: [${c.sources.join("][")}]`).join(" · ")}`);
  const out = lines.join("\n");
  return out.length > maxChars ? out.slice(0, maxChars) + "\n…(truncated)" : out;
}

export function formatSearch(q: string, r: { hits: SearchHit[]; tried: string[] }): string {
  if (!r.hits.length) return `No results for "${q}" (tried ${r.tried.join(", ")}). Try other words, or fetch_page a known URL.`;
  return [`Results for "${q}":`, ...r.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet.slice(0, 300)}`)].join("\n");
}
