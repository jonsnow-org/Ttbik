import { prisma } from "@/lib/prisma";

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
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `ADV-${new Date().getFullYear()}-${tail}`;
}

export async function notifyAdmin(text: string, approveUrl: string, rejectUrl: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
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
          { text: "موافقة وتفعيل", url: approveUrl },
          { text: "رفض", url: rejectUrl },
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

export function actionUrl(kind: "approve" | "reject", code: string) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  const key = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.NOWPAYMENTS_IPN_SECRET || "";
  return `${base}/api/ads/${kind}?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`;
}
