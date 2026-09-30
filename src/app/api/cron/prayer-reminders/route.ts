import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dailyReminderText, findCity } from "@/lib/prayerBotLogic";

// Daily morning message for PRAYER_BOT (docs/claude-feature-backlog.md item 6):
// today's prayer times for the user's saved city + a dhikr. Only users who
// opted in ("🔔 تفعيل التذكير اليومي") and picked a city get it.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bots = await prisma.bot.findMany({ where: { template: "PRAYER_BOT", isActive: true }, select: { id: true, token: true } });
  let sent = 0;
  let candidates = 0;

  for (const b of bots) {
    const users = await prisma.prayerUser.findMany({
      where: { botId: b.id, dailyReminder: true, isBanned: false, cityId: { not: null } },
      select: { id: true, cityId: true },
    });
    for (const u of users) {
      const city = findCity(u.cityId);
      if (!city) continue;
      candidates++;
      try {
        const res = await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(u.id), text: dailyReminderText(city) }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok) sent++;
      } catch {
        // unreachable/blocked -- skip and keep going
      }
    }
  }

  return NextResponse.json({ ok: true, candidates, sent });
}
