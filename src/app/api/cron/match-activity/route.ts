import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One short daily nudge for MARRIAGE_BOT members (never more than one message
// a day, only when there is something real to say): how many new profiles of
// the other gender joined in the last 24h, and how many people looked at their
// profile. Names of visitors stay a paid feature ("من زار ملفي").
export const maxDuration = 60;

const MAX_PER_RUN = 400;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since = new Date(Date.now() - 86400000);
  const active = new Date(Date.now() - 30 * 86400000);
  const bots = await prisma.bot.findMany({ where: { template: "MARRIAGE_BOT", isActive: true }, select: { id: true, token: true } });
  let sent = 0;

  for (const b of bots) {
    if (sent >= MAX_PER_RUN) break;
    const fresh = await prisma.matchProfile.groupBy({
      by: ["gender"],
      where: { status: "APPROVED", isHidden: false, created_at: { gte: since }, user: { botId: b.id } },
      _count: { _all: true },
    });
    const newByGender = new Map(fresh.map((f) => [f.gender, f._count._all]));

    const members = await prisma.matchProfile.findMany({
      where: { status: "APPROVED", isHidden: false, user: { botId: b.id, isBanned: false, lastActiveAt: { gte: active } } },
      select: { userId: true, gender: true },
      take: MAX_PER_RUN,
    });
    const visits = await prisma.matchProfileVisit.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: members.map((m) => m.userId) }, visitedAt: { gte: since } },
      _count: { _all: true },
    });
    const visitsOf = new Map(visits.map((v) => [v.ownerId, v._count._all]));

    for (const m of members) {
      if (sent >= MAX_PER_RUN) break;
      const newOpp = newByGender.get(m.gender === "MALE" ? "FEMALE" : "MALE") || 0;
      const seen = visitsOf.get(m.userId) || 0;
      if (!newOpp && !seen) continue;
      const lines = ["🔔 جديد في بوت التعارف:"];
      if (newOpp) lines.push(`✨ انضم ${newOpp} ${newOpp === 1 ? "ملف جديد" : "ملفات جديدة"} خلال 24 ساعة — اضغط «🔍 البحث عن شريك» لتراها.`);
      if (seen) lines.push(`👀 اطّلع ${seen} ${seen === 1 ? "شخص" : "أشخاص"} على ملفك. لمعرفة من هم: «⭐ الترقيات والمزايا ← 👀 من زار ملفي».`);
      try {
        const res = await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(m.userId), text: lines.join("\n") }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok) sent++;
      } catch {
        /* blocked/unreachable -- skip */
      }
    }
  }
  return NextResponse.json({ ok: true, sent });
}
