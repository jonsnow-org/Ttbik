/** «متجري» server side: own tables (created on first use), shop page data, featured listings. */
import crypto from "crypto";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/siteUrl";
import {
  FEATURE_CALLBACK, FEATURE_DAYS, FEATURE_PRICE_USD, botLink, itemStart, makeShopSlug, nextFeatureUntil, shopShareText, shopStart, isListingId, isShopSlug,
} from "@/lib/jobs/shopRules";

let ready: Promise<void> | null = null;
export function ensureShopTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS jobs_shops (seller_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS jobs_featured (listing_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, until TIMESTAMPTZ NOT NULL, paid NUMERIC NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export async function shopSlugFor(sellerId: string): Promise<string> {
  await ensureShopTables();
  const got = await prisma.$queryRaw<{ slug: string }[]>`SELECT slug FROM jobs_shops WHERE seller_id = ${sellerId}`;
  if (got[0]) return got[0].slug;
  for (let i = 0; i < 5; i++) {
    const slug = makeShopSlug(crypto.randomBytes(7));
    const n = await prisma.$executeRaw`INSERT INTO jobs_shops (seller_id, slug) VALUES (${sellerId}, ${slug}) ON CONFLICT DO NOTHING`;
    if (n === 1) return slug;
    const again = await prisma.$queryRaw<{ slug: string }[]>`SELECT slug FROM jobs_shops WHERE seller_id = ${sellerId}`;
    if (again[0]) return again[0].slug;
  }
  throw new Error("shop slug");
}

async function sellerBySlug(slug: string): Promise<string | null> {
  if (!isShopSlug(slug)) return null;
  await ensureShopTables();
  const r = await prisma.$queryRaw<{ seller_id: string }[]>`SELECT seller_id FROM jobs_shops WHERE slug = ${slug}`;
  return r[0]?.seller_id || null;
}

/** Listing ids featured right now, newest feature first. */
export async function featuredListingIds(): Promise<string[]> {
  await ensureShopTables();
  const r = await prisma.$queryRaw<{ listing_id: string }[]>`SELECT listing_id FROM jobs_featured WHERE until > now() ORDER BY updated_at DESC LIMIT 50`;
  return r.map((x) => x.listing_id);
}

export async function featuredUntil(listingId: string): Promise<Date | null> {
  await ensureShopTables();
  const r = await prisma.$queryRaw<{ until: Date }[]>`SELECT until FROM jobs_featured WHERE listing_id = ${listingId}`;
  return r[0]?.until && r[0].until > new Date() ? r[0].until : null;
}

let cachedUsername: { v: string; at: number } | null = null;
/** @username of the live JOBS_BOT, for links on the public shop page. */
export async function jobsBotUsername(): Promise<string> {
  if (cachedUsername && Date.now() - cachedUsername.at < 3600_000) return cachedUsername.v;
  const row = await prisma.bot.findFirst({ where: { template: "JOBS_BOT", isActive: true }, orderBy: { created_at: "asc" }, select: { token: true } }).catch(() => null);
  if (!row) return "";
  const r = await fetch(`https://api.telegram.org/bot${row.token}/getMe`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null);
  const v = String(r?.result?.username || "");
  if (v) cachedUsername = { v, at: Date.now() };
  return v;
}

/** "🏪 متجري" in the bot: the seller's links, a share button and the feature offer. */
export async function sendMyShop(bot: TelegramBot, chatId: number, userId: string) {
  const [profile, count] = await Promise.all([
    prisma.jobsProfile.findUnique({ where: { userId } }),
    prisma.storeListing.count({ where: { sellerId: userId, status: "ACTIVE" } }),
  ]);
  if (!count) {
    await bot.api.sendMessage(chatId, "🏪 متجرك فارغ. أضف منتجاً من «🛒 قسم المتجر ← 💰 أمر بيع»، ثم ارجع هنا لتأخذ رابط متجرك.");
    return;
  }
  const slug = await shopSlugFor(userId);
  const me = await bot.api.getMe().catch(() => null);
  const deep = me?.username ? botLink(me.username, shopStart(slug)) : "";
  const page = `${SITE_URL}/shop/${slug}`;
  const name = profile?.name || "متجري";
  const kb = new InlineKeyboard();
  if (deep) kb.url("📤 شارك متجرك", `https://t.me/share/url?url=${encodeURIComponent(deep)}&text=${encodeURIComponent(shopShareText(name, count))}`).row();
  kb.url("🌐 صفحة المتجر", page);
  await bot.api.sendMessage(chatId,
    `🏪 متجر ${name} · ${count} منتج نشط\n\n🔗 رابط المتجر داخل البوت (للجروبات والحالة):\n${deep}\n\n🌐 صفحة المتجر على الويب:\n${page}\n\n` +
    `⭐ ميّز أي منتج ليظهر أولاً في التصفح والبحث ${FEATURE_DAYS} أيام بـ $${FEATURE_PRICE_USD} من رصيدك: افتح المنتج من «📂 طلباتي ← 💰 طلباتي (بيع)» واضغط «⭐ تمييز».`,
    { reply_markup: kb });
}

/** Opens a shop inside the bot from shop_<slug>. */
export async function sendShopInBot(bot: TelegramBot, chatId: number, slug: string, viewerId: string): Promise<boolean> {
  const sellerId = await sellerBySlug(slug);
  if (!sellerId) { await bot.api.sendMessage(chatId, "هذا المتجر غير موجود."); return true; }
  const [profile, listings, featured] = await Promise.all([
    prisma.jobsProfile.findUnique({ where: { userId: sellerId } }),
    prisma.storeListing.findMany({ where: { sellerId, status: "ACTIVE" }, orderBy: { created_at: "desc" }, take: 20 }),
    featuredListingIds(),
  ]);
  if (!listings.length) { await bot.api.sendMessage(chatId, "لا توجد منتجات نشطة في هذا المتجر الآن."); return true; }
  const f = new Set(featured);
  const kb = new InlineKeyboard();
  const lines = listings.map((l, i) => {
    kb.text(`👁 ${i + 1}. ${l.title.slice(0, 28)}`, `jview|listing|${l.id}`).row();
    return `${i + 1}. ${f.has(l.id) ? "⭐ " : ""}${l.title} — $${l.price.toFixed(2)}`;
  });
  await bot.api.sendMessage(chatId, `🏪 متجر ${profile?.name || ""}${viewerId === sellerId ? " (متجرك)" : ""}\n\n${lines.join("\n")}`, { reply_markup: kb });
  return true;
}

export type FeatureOutcome = { ok: true; until: Date } | { ok: false; reason: "not_owner" | "inactive" | "balance"; balance?: number };

/** Charges FEATURE_PRICE_USD from the seller's balance and extends the listing's feature window. */
export async function featureListing(userId: string, listingId: string, charge: (userId: string, amount: number, type: string) => Promise<{ ok: boolean; balance: number }>): Promise<FeatureOutcome> {
  if (!isListingId(listingId)) return { ok: false, reason: "inactive" };
  const l = await prisma.storeListing.findUnique({ where: { id: listingId } });
  if (!l || l.sellerId !== userId) return { ok: false, reason: "not_owner" };
  if (l.status !== "ACTIVE") return { ok: false, reason: "inactive" };
  await ensureShopTables();
  const paid = await charge(userId, FEATURE_PRICE_USD, "STORE_FEATURE");
  if (!paid.ok) return { ok: false, reason: "balance", balance: paid.balance };
  const until = nextFeatureUntil(await featuredUntil(listingId));
  await prisma.$executeRaw`INSERT INTO jobs_featured (listing_id, seller_id, until, paid) VALUES (${listingId}, ${userId}, ${until}, ${FEATURE_PRICE_USD})
    ON CONFLICT (listing_id) DO UPDATE SET until = ${until}, paid = jobs_featured.paid + ${FEATURE_PRICE_USD}, updated_at = now()`;
  return { ok: true, until };
}

export const featureButton = (listingId: string) => ({ text: `⭐ تمييز ${FEATURE_DAYS} أيام ($${FEATURE_PRICE_USD})`, data: `${FEATURE_CALLBACK}${listingId}` });

/** Public page data. Seller contact details are never exposed; buying happens inside the bot. */
export async function shopPage(slug: string) {
  const sellerId = await sellerBySlug(slug);
  if (!sellerId) return null;
  const [profile, listings, featured, username] = await Promise.all([
    prisma.jobsProfile.findUnique({ where: { userId: sellerId } }),
    prisma.storeListing.findMany({ where: { sellerId, status: "ACTIVE" }, orderBy: { created_at: "desc" }, take: 60 }),
    featuredListingIds(),
    jobsBotUsername().catch(() => ""),
  ]);
  const f = new Set(featured);
  const p = profile as any;
  return {
    name: String(p?.name || "متجر"),
    place: [p?.city, p?.governorate, p?.country].filter(Boolean).join("، "),
    shopUrl: username ? botLink(username, shopStart(slug)) : "",
    items: listings
      .map((l) => ({ id: l.id, title: l.title, description: l.description || "", price: l.price, escrow: l.paymentMethod === "ESCROW", shipping: l.deliveryMethod === "SHIPPING", featured: f.has(l.id), orderUrl: username ? botLink(username, itemStart(l.id)) : "" }))
      .sort((a, b) => Number(b.featured) - Number(a.featured)),
  };
}

export async function shopStats() {
  await ensureShopTables();
  const r = await prisma.$queryRaw<{ shops: bigint; live: bigint; usd: unknown }[]>`SELECT (SELECT count(*) FROM jobs_shops) shops, (SELECT count(*) FROM jobs_featured WHERE until > now()) live, (SELECT COALESCE(sum(paid),0) FROM jobs_featured) usd`;
  return { shops: Number(r[0]?.shops || 0), featuredNow: Number(r[0]?.live || 0), featureRevenueUsd: Number(r[0]?.usd || 0) };
}

/** Public shop directory (/shop): shops with at least one active listing, busiest first. */
export async function listShops(limit = 60): Promise<{ slug: string; name: string; place: string; items: number }[]> {
  await ensureShopTables();
  const rows = await prisma.$queryRaw<{ slug: string; seller_id: string; items: bigint }[]>`
    SELECT s.slug, s.seller_id, count(l.id) AS items FROM jobs_shops s
    JOIN "StoreListing" l ON l."sellerId" = s.seller_id AND l.status = 'ACTIVE'
    GROUP BY s.slug, s.seller_id ORDER BY count(l.id) DESC, s.slug LIMIT ${limit}`;
  if (!rows.length) return [];
  const profiles = await prisma.jobsProfile.findMany({ where: { userId: { in: rows.map((r) => r.seller_id) } } });
  const by = new Map(profiles.map((p: any) => [p.userId, p]));
  return rows.map((r) => {
    const p: any = by.get(r.seller_id);
    return { slug: r.slug, name: String(p?.name || "متجر"), place: [p?.city, p?.country].filter(Boolean).join("، "), items: Number(r.items) };
  });
}
