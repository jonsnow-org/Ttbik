/**
 * «متجري» (2026-11-10): every trader on the jobs/store bot (@Saragptbotbot) gets a shareable shop —
 * a public page /shop/<slug> and a deep link that opens it inside the bot — plus paid ⭐ featured
 * listings (top of browse and search) charged from the bot's existing balance. Pure rules here.
 */
export const SHOP_BUTTON = "🏪 متجري";
export const SHOP_START_PREFIX = "shop_";
export const ITEM_START_PREFIX = "item_";
export const FEATURE_PRICE_USD = 1;
export const FEATURE_DAYS = 7;
export const FEATURED_PER_PAGE = 3;
export const FEATURE_CALLBACK = "jfeat|";

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
export function makeShopSlug(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 7; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}
export const isShopSlug = (s: string) => /^[a-z2-9]{7}$/.test(String(s || ""));
export const isListingId = (s: string) => /^[0-9a-f-]{36}$/i.test(String(s || ""));

/** /start payloads: shop_<slug> | item_<listing uuid without dashes> (Telegram allows 64 chars, [A-Za-z0-9_-]). */
export function parseShopStart(payload: string): { kind: "shop"; slug: string } | { kind: "item"; id: string } | null {
  const p = String(payload || "").trim();
  if (p.startsWith(SHOP_START_PREFIX) && isShopSlug(p.slice(SHOP_START_PREFIX.length))) return { kind: "shop", slug: p.slice(SHOP_START_PREFIX.length) };
  if (p.startsWith(ITEM_START_PREFIX)) {
    const hex = p.slice(ITEM_START_PREFIX.length);
    if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
    return { kind: "item", id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase() };
  }
  return null;
}
export const itemStart = (listingId: string) => `${ITEM_START_PREFIX}${listingId.replace(/-/g, "").toLowerCase()}`;
export const shopStart = (slug: string) => `${SHOP_START_PREFIX}${slug}`;
export const botLink = (bot: string, start: string) => `https://t.me/${bot}?start=${start}`;

/** Featured first (at most FEATURED_PER_PAGE, newest feature first), then the rest in their original order, no duplicates. */
export function withFeaturedFirst<T extends { id: string }>(regular: T[], featured: T[]): { item: T; featured: boolean }[] {
  const top = featured.slice(0, FEATURED_PER_PAGE);
  const ids = new Set(top.map((x) => x.id));
  return [...top.map((item) => ({ item, featured: true })), ...regular.filter((x) => !ids.has(x.id)).map((item) => ({ item, featured: false }))];
}

/** Extending a running feature adds days on top of the current end, never resets it. */
export function nextFeatureUntil(current: Date | null, now = new Date()): Date {
  const base = current && current > now ? current : now;
  return new Date(base.getTime() + FEATURE_DAYS * 86400_000);
}

export function shopShareText(name: string, count: number): string {
  return `🏪 متجر ${name} على تيليجرام: ${count} منتج. اطلب مباشرة، والدفع يمكن أن يكون محجوزاً حتى الاستلام.`;
}
