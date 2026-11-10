import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { gateUrl } from "@/lib/hostingOps";

export const AD_PLANS = [
  { days: 7, price: 15, label: "7 أيام" },
  { days: 15, price: 25, label: "15 يوماً" },
  { days: 30, price: 40, label: "30 يوماً" },
] as const;


export function planFor(days: number) {
  return AD_PLANS.find((p) => p.days === days) || null;
}

export function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // 8 chars from a CSPRNG (≈ 40 bits): the code is also the advertiser's handle for confirm/status, so it must not be guessable.
  const bytes = crypto.randomBytes(8);
  let tail = "";
  for (let i = 0; i < 8; i++) tail += alphabet[bytes[i] % alphabet.length];
  return `ADV-${new Date().getFullYear()}-${tail}`;
}

// ── The site bot (بوت الموقع) ─────────────────────────────────────────────────────────────────────────────────────────
// The site bot is a standalone bot served only by /api/ads/telegram (site ads, wallet/balance, the site Mini App). It is NOT a bot
// of the ads & earn builder: it never reads or writes the builder's Bot table and has no AD_BOT/owner-bot role.
// Its token comes from, in order: env SITE_BOT_TOKEN, then the site_bot config table (one row, key 'main').
export type SiteBot = { id: string; token: string };

let siteBotReady: Promise<void> | null = null;
function ensureSiteBotTable(): Promise<void> {
  if (!siteBotReady) siteBotReady = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS site_bot (key TEXT PRIMARY KEY, token TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    // a token lives here: never readable through the database's public API roles
    .then(() => prisma.$executeRawUnsafe(`ALTER TABLE site_bot ENABLE ROW LEVEL SECURITY`))
    .then(() => undefined).catch((e) => { siteBotReady = null; throw e; });
  return siteBotReady;
}

let siteBotCache: { at: number; v: SiteBot | null } | null = null;
export async function findSiteBot(): Promise<SiteBot | null> {
  const env = (process.env.SITE_BOT_TOKEN || "").trim();
  if (env) return { id: "site", token: env };
  if (siteBotCache && Date.now() - siteBotCache.at < 60_000) return siteBotCache.v;
  let v: SiteBot | null = null;
  try {
    await ensureSiteBotTable();
    const rows = await prisma.$queryRaw<{ token: string }[]>`SELECT token FROM site_bot WHERE key = 'main' LIMIT 1`;
    if (rows[0]?.token) v = { id: "site", token: rows[0].token };
  } catch {
    v = null;
  }
  siteBotCache = { at: Date.now(), v };
  return v;
}

let siteBotNameCache: { at: number; v: string } | null = null;
/** The site bot's @username (without @), from Telegram getMe; env SITE_BOT_USERNAME if Telegram can't be reached. */
export async function siteBotUsername(): Promise<string> {
  if (siteBotNameCache && Date.now() - siteBotNameCache.at < 3_600_000) return siteBotNameCache.v;
  const bot = await findSiteBot().catch(() => null);
  let v = "";
  if (bot) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      v = String(data?.result?.username || "");
    } catch {
      v = "";
    }
  }
  v = v || String(process.env.SITE_BOT_USERNAME || "").replace(/^@/, "");
  if (v) siteBotNameCache = { at: Date.now(), v };
  return v;
}

/** Points the site bot's webhook and Mini App menu button at the gate (idempotent). Changes nothing in the database. */
export async function bindSiteBot() {
  const bot = await findSiteBot();
  if (!bot) return { ok: false, error: "بوت الموقع غير مُعدّ (SITE_BOT_TOKEN أو جدول site_bot)", webhook: "" };
  const base = gateUrl().replace(/\/$/, ""); // gate first: never a bare vercel.app link
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  await fetch(`https://api.telegram.org/bot${bot.token}/setChatMenuButton`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text: "الموقع", web_app: { url: base } } }),
  }).catch(() => null);
  const hook = await fetch(`https://api.telegram.org/bot${bot.token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${base}/api/ads/telegram`,
      secret_token: secret,
      // `stopped_message_generation` must be here: without it Telegram never delivers the press of the live draft's Stop
      // button (sendMessageDraft can_stop), so the Stop in the chat would do nothing.
      allowed_updates: ["message", "callback_query", "stopped_message_generation", "pre_checkout_query"], // pre_checkout_query: ⭐ Stars checkout for site ads
    }),
  });
  const hookData = await hook.json().catch(() => null);
  return { ok: Boolean(hookData?.ok), id: bot.id, webhook: hookData?.description || "" };
}

async function siteBotToken() {
  const bot = await findSiteBot();
  return bot?.token || "";
}

export async function notifyAdmin(text: string, code: string) {
  const token = await siteBotToken();
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (!token || !chat) return { ok: false, error: "telegram-not-configured" };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "موافقة وتفعيل", callback_data: `approve:${code}` },
          { text: "رفض", callback_data: `reject:${code}` },
        ]],
      },
    }),
  });
  return { ok: res.ok };
}

export async function activateAd(code: string) {
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return null;
  if (ad.paymentStatus !== "PAID") return ad;
  const start = new Date();
  const end = new Date(start.getTime() + ad.durationDays * 86400000);
  return prisma.siteBannerAd.update({
    where: { reservationCode: code },
    data: { adStatus: "ACTIVE", startsAt: start, endsAt: end },
  });
}

export async function creditBanner(code: string) {
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad || ad.paymentStatus !== "PAID" || ad.credited) return ad;
  // Claim the credit atomically first, so two concurrent IPNs/approvals can never both add the revenue.
  const claim = await prisma.siteBannerAd.updateMany({ where: { reservationCode: code, credited: false }, data: { credited: true } });
  if (claim.count !== 1) return ad;
  // Site-ad revenue is the sum of the PAID siteBannerAd rows (bannerBalance); nothing is written to the builder's Bot table.
  return { ...ad, credited: true };
}

export async function bannerBalance() {
  const paid = await prisma.siteBannerAd.findMany({ where: { paymentStatus: "PAID" } });
  const total = paid.reduce((sum, ad) => sum + ad.totalPrice, 0);
  const active = paid.filter((ad) => ad.adStatus === "ACTIVE").length;
  return { total, count: paid.length, active, botBalance: total };
}

// ⭐ Telegram Stars checkout for site ads (2026-11-10). The site bot issues the invoice and receives the payment
// (pre_checkout_query + successful_payment on /api/ads/telegram). 100 Stars = $1, the same rate as every bot here.
export const SITE_AD_STARS_PREFIX = "SITEAD:";
export function adStars(priceUsd: number): number {
  return Math.max(1, Math.ceil(priceUsd * 100));
}
/** Stars need a verified webhook: without TELEGRAM_WEBHOOK_SECRET anyone could POST a fake successful_payment. */
export function siteAdStarsEnabled(): boolean {
  return Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
}
export async function siteAdStarsInvoice(ad: { reservationCode: string; totalPrice: number; durationDays: number; altText: string }): Promise<{ ok: true; link: string; stars: number } | { ok: false; error: string }> {
  if (!siteAdStarsEnabled()) return { ok: false, error: "الدفع بالنجوم غير مفعّل بعد." };
  const bot = await findSiteBot();
  if (!bot) return { ok: false, error: "بوت الموقع غير متاح." };
  await bindSiteBot().catch(() => null); // makes sure the webhook also receives pre_checkout_query
  const stars = adStars(ad.totalPrice);
  const res = await fetch(`https://api.telegram.org/bot${bot.token}/createInvoiceLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `إعلان ${ad.reservationCode}`.slice(0, 32),
      description: `${ad.altText} — ${ad.durationDays} يوم على شام AI. يُراجع ثم يُفعَّل.`.slice(0, 255),
      payload: `${SITE_AD_STARS_PREFIX}${ad.reservationCode}`,
      currency: "XTR",
      prices: [{ label: `${ad.durationDays} يوم`, amount: stars }],
    }),
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!data?.ok || !data.result) return { ok: false, error: "تعذّر إنشاء فاتورة النجوم." };
  return { ok: true, link: String(data.result), stars };
}

/**
 * The single "money arrived" transition for a site ad, shared by the NOWPayments IPN and the Stars payment.
 * Only the first PENDING → PAID move puts the ad in the review queue and notifies the admin; re-deliveries change nothing.
 */
export async function markSiteAdPaid(code: string, via: string): Promise<{ ok: boolean; first: boolean; ad: Awaited<ReturnType<typeof prisma.siteBannerAd.findUnique>> }> {
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return { ok: false, first: false, ad: null };
  const moved = await prisma.siteBannerAd.updateMany({
    where: { reservationCode: code, paymentStatus: { not: "PAID" } },
    data: { paymentStatus: "PAID", adStatus: "PENDING_APPROVAL" },
  });
  await creditBanner(code).catch(() => null);
  if (moved.count === 1) {
    await notifyAdmin(`دُفع إعلان ${code} (${via})\n${ad.totalPrice}$ لمدة ${ad.durationDays} يوم\n${ad.kind}/${ad.placement}\n${ad.targetUrl}`, code).catch(() => null);
  }
  return { ok: true, first: moved.count === 1, ad };
}

// 💵 Automatic USDT (TRC20) for site ads (2026-11-10): before this the buyer sent the flat price and the owner had to check his wallet by
// hand and tap approve, so a paid ad could sit unpaid in the system. Now each order gets an exact amount (src/lib/payments/usdtOrders.ts)
// paid straight to the owner's wallet; the on-chain match marks it PAID and puts it in the normal review queue (content review stays).
export const SITE_AD_USDT_PREFIX = "sitead:";
export async function siteAdUsdtQuote(ad: { reservationCode: string; totalPrice: number }) {
  const { usdtQuote } = await import("@/lib/payments/usdtOrders");
  return usdtQuote(`${SITE_AD_USDT_PREFIX}${ad.reservationCode}`, ad.totalPrice);
}
export async function checkSiteAdUsdt(code: string): Promise<{ paid: boolean }> {
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return { paid: false };
  if (ad.paymentStatus === "PAID") return { paid: true };
  const { usdtCheck } = await import("@/lib/payments/usdtOrders");
  let hash = "";
  const r = await usdtCheck(`${SITE_AD_USDT_PREFIX}${code}`, async (tx, p) => {
    const moved = await tx.siteBannerAd.updateMany({ where: { reservationCode: code, paymentStatus: { not: "PAID" } }, data: { paymentStatus: "PAID" } });
    if (moved.count !== 1) throw new Error("not pending");
    hash = p.hash;
  });
  if (r.paid) {
    // already PAID in the claim transaction; this records revenue, moves it to review and tells the owner (once)
    await prisma.siteBannerAd.update({ where: { reservationCode: code }, data: { adStatus: "PENDING_APPROVAL" } }).catch(() => null);
    await creditBanner(code).catch(() => null);
    await notifyAdmin(`💵 دُفع إعلان ${code} تلقائياً بـ USDT TRC20 (${hash.slice(0, 16)})\n${ad.totalPrice}$ لمدة ${ad.durationDays} يوم\n${ad.kind}/${ad.placement}\n${ad.targetUrl}`, code).catch(() => null);
  }
  return { paid: r.paid };
}
export async function sweepSiteAdUsdt(): Promise<number> {
  const { openPayers } = await import("@/lib/payments/usdtOrders");
  let n = 0;
  for (const ref of await openPayers(SITE_AD_USDT_PREFIX)) if ((await checkSiteAdUsdt(ref.slice(SITE_AD_USDT_PREFIX.length)).catch(() => ({ paid: false }))).paid) n++;
  return n;
}
