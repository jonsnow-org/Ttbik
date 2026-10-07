import { prisma } from "@/lib/prisma";

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
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
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
  if (token) return { id: "env", token, isActive: true, template: "SITE_BANNER_ADMIN" };
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
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
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
      allowed_updates: ["message", "callback_query"],
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
  const bot = await findAdmenBot();
  if (bot) {
    await prisma.bot.update({
      where: { id: bot.id },
      data: { totalRevenue: { increment: ad.totalPrice }, ownerBalance: { increment: ad.totalPrice } },
    });
  }
  return prisma.siteBannerAd.update({ where: { reservationCode: code }, data: { credited: true } });
}

export async function bannerBalance() {
  const paid = await prisma.siteBannerAd.findMany({ where: { paymentStatus: "PAID" } });
  const total = paid.reduce((sum, ad) => sum + ad.totalPrice, 0);
  const active = paid.filter((ad) => ad.adStatus === "ACTIVE").length;
  const bot = await findAdmenBot();
  return { total, count: paid.length, active, botBalance: bot ? (await prisma.bot.findUnique({ where: { id: bot.id } }))?.ownerBalance ?? total : total };
}
