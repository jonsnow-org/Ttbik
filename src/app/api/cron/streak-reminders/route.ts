import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Daily "don't break your streak" nudge for STREAK_BOT (docs/claude-feature-backlog.md
// item 5) — runs once a day (see vercel.json), well after midnight UTC so
// `lastCheckInDate !== today` reliably means "hasn't checked in today yet"
// for the whole run. Only messages a user who has at least one category
// with an active streak (currentStreak > 0) still uncompleted for today —
// a brand-new user with no streak yet gets no reminder, same reasoning as
// every other broadcast on this platform (don't spam people who never
// engaged).
export const maxDuration = 60;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const CATEGORY_TITLES: Record<string, string> = {
  fasting: "🌙 الصيام",
  prayer: "🕌 الصلاة",
  reading: "📖 القراءة",
  exercise: "🏃 الرياضة",
};

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = todayKey();
  const bots = await prisma.bot.findMany({ where: { template: "STREAK_BOT", isActive: true }, select: { id: true, token: true } });

  let sent = 0;
  let candidates = 0;

  for (const b of bots) {
    const visits = await prisma.botVisit.findMany({ where: { botId: b.id }, select: { tgUserId: true } });
    for (const v of visits) {
      const user = await prisma.streakUser.findUnique({ where: { id: v.tgUserId }, include: { streaks: true } });
      if (!user || user.isBanned || (user.mutedUntil && user.mutedUntil > new Date())) continue;

      const atRisk = user.streaks.filter((s) => s.currentStreak > 0 && s.lastCheckInDate !== today);
      if (atRisk.length === 0) continue;
      candidates++;

      const lines = atRisk.map((s) => `${CATEGORY_TITLES[s.category] || s.category}: 🔥 ${s.currentStreak} يوم`).join("\n");
      const text = `⏰ لا تفوّت سلسلتك اليوم!\n\n${lines}\n\nسجّل الآن قبل انتهاء اليوم للحفاظ عليها.`;

      try {
        const res = await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(v.tgUserId), text }),
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
