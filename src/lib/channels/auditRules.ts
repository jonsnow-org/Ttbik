/**
 * «بورصة القنوات» (2026-11-10) — pure parsing and scoring for the free channel audit.
 * Source: Telegram's public web preview https://t.me/s/<channel> (no login, public channels only).
 * No DB, no network: unit-tested in src/lib/__tests__/channelAudit.test.ts.
 *
 * Every number here is an ESTIMATE from the latest public posts (the preview shows about 20).
 */
export type ParsedPost = { id: number; views: number; at: string | null; text: string };
export type ParsedChannel = { username: string; title: string; subscribers: number | null; description: string; posts: ParsedPost[] };

export const COMMISSION_RATE = 0.15; // platform share of every deal through escrow
export const BADGE_PRICE_USD = 10; // ☑️ verified channel, per year
export const BADGE_DAYS = 365;
/** Fair price band per 1,000 views for a direct post in an Arabic channel (USD). Source: RichAds 2025 guide ($15–25 CPM). */
export const CPM_LOW = 15;
export const CPM_HIGH = 25;
export const MIN_DEAL_USD = 5;
export const MAX_DEAL_USD = 2000;

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const RESERVED = new Set(["joinchat", "addstickers", "addemoji", "share", "proxy", "socks", "iv", "login", "contact", "setlanguage"]);
/** Accepts @name, t.me/name, https://t.me/s/name … and returns the bare username, or null. */
export function normalizeChannel(input: string | null | undefined): string | null {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t|telegram)\.me\//i, "").replace(/^s\//i, "").replace(/^@/, "");
  s = s.split(/[/?#\s]/)[0] || "";
  return USERNAME_RE.test(s) && !RESERVED.has(s.toLowerCase()) ? s : null;
}

/** "10.1M" → 10100000, "6.61K" → 6610, "512" → 512. */
export function parseCount(raw: string | null | undefined): number | null {
  const m = String(raw || "").replace(/[,\s\u00a0]/g, "").trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const mul = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
  return Math.round(n * mul);
}

const decode = (s: string) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();

export function parseChannelPage(username: string, html: string): ParsedChannel | null {
  if (!/tgme_channel_info/.test(html)) return null; // not a public channel preview (private, user, group or missing)
  const title = decode(html.match(/tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "") || username;
  const description = decode(html.match(/tgme_channel_info_description"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "");
  let subscribers: number | null = null;
  for (const m of html.matchAll(/counter_value">([^<]*)<\/span>\s*<span class="counter_type">([^<]*)</g)) {
    if (/subscriber|member/i.test(m[2])) subscribers = parseCount(m[1]);
  }
  const posts: ParsedPost[] = [];
  const blocks = html.split(/class="tgme_widget_message_wrap/).slice(1);
  for (const b of blocks) {
    const id = Number(b.match(/data-post="[^"/]+\/(\d+)"/)?.[1]);
    if (!Number.isFinite(id) || !id) continue;
    const views = parseCount(b.match(/tgme_widget_message_views">([^<]*)</)?.[1]);
    if (views == null) continue; // service messages carry no views
    const at = b.match(/<time datetime="([^"]+)"/)?.[1] ?? null;
    const text = decode(b.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "");
    posts.push({ id, views, at, text });
  }
  posts.sort((a, b) => a.id - b.id);
  return { username, title, subscribers, description, posts };
}

export type Grade = "excellent" | "good" | "weak" | "suspicious" | "unknown";
export type AuditReport = {
  username: string;
  title: string;
  subscribers: number | null;
  postsSampled: number;
  avgViews: number;
  medianViews: number;
  reachPct: number | null; // median views / subscribers
  postsPerDay: number | null;
  lastPostAt: string | null;
  grade: Grade;
  priceLow: number;
  priceHigh: number;
  notes: string[];
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/**
 * Grades how much of the audience actually sees a post. Typical healthy public channels land around 10–40%
 * reach; under 3% with a large subscriber count usually means bought/inactive subscribers. Heuristic, said so on the page.
 */
export function gradeReach(reachPct: number | null, subscribers: number | null): Grade {
  if (reachPct == null || !subscribers) return "unknown";
  if (subscribers >= 2000 && reachPct < 3) return "suspicious";
  if (reachPct >= 25) return "excellent";
  if (reachPct >= 10) return "good";
  return "weak";
}

export function auditChannel(c: ParsedChannel, now = new Date()): AuditReport {
  // The newest post is still collecting views: leave it out when there is enough history.
  const usable = c.posts.length > 3 ? c.posts.slice(0, -1) : c.posts;
  const views = usable.map((p) => p.views);
  const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
  const medianViews = median(views);
  const reachPct = c.subscribers ? Math.round((medianViews / c.subscribers) * 1000) / 10 : null;
  const dates = c.posts.map((p) => (p.at ? Date.parse(p.at) : NaN)).filter((t) => Number.isFinite(t));
  let postsPerDay: number | null = null;
  if (dates.length >= 2) {
    const spanDays = Math.max(1, (Math.max(...dates) - Math.min(...dates)) / 86400_000);
    postsPerDay = Math.round((dates.length / spanDays) * 10) / 10;
  }
  const lastPostAt = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  const grade = gradeReach(reachPct, c.subscribers);
  const notes: string[] = [];
  if (!c.posts.length) notes.push("لا توجد منشورات عامة يمكن قياسها.");
  if (lastPostAt && now.getTime() - Date.parse(lastPostAt) > 14 * 86400_000) notes.push("آخر منشور أقدم من أسبوعين: القناة شبه متوقفة.");
  if (grade === "suspicious") notes.push("نسبة المشاهدة منخفضة جداً مقارنة بعدد المشتركين، وغالباً فيها مشتركون غير نشطين أو مشترَون.");
  if (postsPerDay != null && postsPerDay > 15) notes.push("نشر كثيف جداً: الإعلان قد يضيع بين المنشورات.");
  const priceLow = medianViews ? round((medianViews / 1000) * CPM_LOW, 1) : 0;
  const priceHigh = medianViews ? round((medianViews / 1000) * CPM_HIGH, 1) : 0;
  return { username: c.username, title: c.title, subscribers: c.subscribers, postsSampled: views.length, avgViews, medianViews, reachPct, postsPerDay, lastPostAt, grade, priceLow, priceHigh, notes };
}

export const GRADE_LABEL: Record<Grade, string> = {
  excellent: "ممتازة", good: "جيدة", weak: "ضعيفة", suspicious: "مشبوهة", unknown: "غير معروفة",
};

// --- deals -------------------------------------------------------------------------
export type DealSplit = { price: number; commission: number; payout: number };
export function splitDeal(price: number): DealSplit {
  const p = Math.round(price * 100) / 100;
  const commission = Math.round(p * COMMISSION_RATE * 100) / 100;
  return { price: p, commission, payout: Math.round((p - commission) * 100) / 100 };
}
export function validDealPrice(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= MIN_DEAL_USD && n <= MAX_DEAL_USD;
}

/** Deal lifecycle. Money is held by the platform from PAID until RELEASED (85% to the channel) or REFUNDED. */
export const DEAL_FLOW: Record<string, string[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["POSTED", "VERIFIED", "REFUNDED"],
  POSTED: ["VERIFIED", "REFUNDED"],
  VERIFIED: ["RELEASED", "REFUNDED"],
  RELEASED: [],
  REFUNDED: [],
  CANCELLED: [],
};
export function canMove(from: string, to: string): boolean {
  return (DEAL_FLOW[from] || []).includes(to);
}

/** A post link must point at the deal's own channel: https://t.me/<channel>/<id>. */
export function parsePostLink(link: string, channel: string): number | null {
  const m = String(link || "").trim().match(/^https?:\/\/(?:t|telegram)\.me\/(?:s\/)?([A-Za-z0-9_]+)\/(\d+)(?:[/?#].*)?$/i);
  if (!m || m[1].toLowerCase() !== channel.toLowerCase()) return null;
  return Number(m[2]);
}

/** The post proves the deal when it contains the advertiser's link or the deal code. */
export function postMatchesDeal(postText: string, targetUrl: string, code: string): boolean {
  const t = postText.toLowerCase();
  const host = targetUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  return (host.length > 3 && t.includes(host)) || t.includes(code.toLowerCase());
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeDealCode(prefix: "CHD" | "CHB", bytes: Uint8Array): string {
  let tail = "";
  for (let i = 0; i < 8; i++) tail += ALPHA[bytes[i] % ALPHA.length];
  return `${prefix}-${tail}`;
}
