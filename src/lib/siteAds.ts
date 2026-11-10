import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { gateUrl } from "@/lib/hostingOps";

export const AD_PLANS = [
  { days: 7, price: 15, label: "7 أيام" },
  { days: 15, price: 25, label: "15 يوماً" },
  { days: 30, price: 40, label: "30 يوماً" },
] as const;

const ADMEN = "admen10bot";

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

export async function findAdmenBot() {
  const bots = await prisma.bot.findMany({ select: { id: true, token: true, isActive: true, template: true } });
  for (const bot of bots) {
    if (bot.template === "SITE_BANNER_ADMIN") return bot;
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (String(data?.result?.username || "").toLowerCase() === ADMEN) return bot;
    } catch {
      continue;
    }
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (String(data?.result?.username || "").toLowerCase() === ADMEN) {
        return { id: "env", token, isActive: true, template: "SITE_BANNER_ADMIN" };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function bindAdmenBot() {
  const bot = await findAdmenBot();
  if (!bot) return { ok: false, error: "البوت @Admen10bot غير موجود في جدول البوتات" };
  if (bot.id !== "env") {
    await prisma.bot.update({
      where: { id: bot.id },
      data: { isActive: false, template: "SITE_BANNER_ADMIN" },
    }).catch(() => null);
  }
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
  return { ok: Boolean(hookData?.ok), id: bot.id, detached: true, webhook: hookData?.description || "" };
}

async function admenToken() {
  const bot = await findAdmenBot();
  return bot?.token || process.env.TELEGRAM_BOT_TOKEN || "";
}

export async function notifyAdmin(text: string, code: string) {
  const token = await admenToken();
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
  const bot = await findAdmenBot();
  if (bot) {
    await prisma.bot.update({
      where: { id: bot.id },
      data: { totalRevenue: { increment: ad.totalPrice }, ownerBalance: { increment: ad.totalPrice } },
    });
  }
  return { ...ad, credited: true };
}

export async function bannerBalance() {
  const paid = await prisma.siteBannerAd.findMany({ where: { paymentStatus: "PAID" } });
  const total = paid.reduce((sum, ad) => sum + ad.totalPrice, 0);
  const active = paid.filter((ad) => ad.adStatus === "ACTIVE").length;
  const bot = await findAdmenBot();
  return { total, count: paid.length, active, botBalance: bot ? (await prisma.bot.findUnique({ where: { id: bot.id } }))?.ownerBalance ?? total : total };
}

// ⭐ Telegram Stars checkout for site ads (2026-11-10). The Admen bot issues the invoice and receives the payment
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
  const bot = await findAdmenBot();
  if (!bot) return { ok: false, error: "بوت الإعلانات غير متاح." };
  await bindAdmenBot().catch(() => null); // makes sure the webhook also receives pre_checkout_query
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
