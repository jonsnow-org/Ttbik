import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPayments, loadWatch, tons, txLink, daySummary, dayKey } from "@/lib/atharWatch";

// Owner alerts for Athar: every few minutes (GitHub Actions workflow athar-mints.yml) look for new
// payments into the management wallet and tell the owner in the bot. Read-only on-chain.
export const maxDuration = 30;

const OWNER_FALLBACK = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").split(",")[0].trim();

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || q === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await checkPayments();
  if (!res.ok) return NextResponse.json({ ok: false, reason: "chain-api-unavailable" });
  if (!res.fresh.length) return NextResponse.json({ ok: true, fresh: 0, baseline: !!res.baseline });

  const state = await loadWatch();
  if (!state.alerts) return NextResponse.json({ ok: true, fresh: res.fresh.length, alerts: "off" });

  const botRow = await prisma.bot.findFirst({ where: { template: "ATHAR_BOT", isActive: true }, select: { token: true, ownerId: true } }).catch(() => null);
  const chat = Number(botRow?.ownerId || OWNER_FALLBACK);
  if (!botRow?.token || !chat) return NextResponse.json({ ok: false, reason: "no-athar-bot" });

  const today = daySummary(state, dayKey(Date.now()));
  let sent = 0;
  for (const p of res.fresh.slice(-10)) {
    const text =
      `🎉 دفعة جديدة على أثر (غالباً صكّ رمز)\n` +
      `💰 +${tons(p.nano)} TON دخلت محفظة الإدارة\n` +
      `📈 اليوم: ${today.n} دفعة (${tons(today.nano)} TON)\n` +
      (res.balance != null ? `👛 رصيدك الآن: ${tons(res.balance)} TON\n` : "") +
      `↩️ من: ${p.from.slice(0, 6)}…${p.from.slice(-4)}\n` +
      `🔗 ${txLink(p.hash)}`;
    const r = await fetch(`https://api.telegram.org/bot${botRow.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    }).catch(() => null);
    if (r?.ok) sent++;
  }
  return NextResponse.json({ ok: true, fresh: res.fresh.length, sent });
}
