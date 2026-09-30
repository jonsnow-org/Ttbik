import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Delivers every CAPSULE_BOT capsule whose date has come (runs daily, see
// vercel.json). A FRIEND capsule nobody claimed goes back to its sender.
// A blocked/deleted recipient (Telegram 403) is marked delivered so it is
// not retried forever; any other failure is left for tomorrow's run.
export const maxDuration = 60;

function fmt(d: Date): string {
  return d.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!isAuthorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const due = await prisma.capsule.findMany({
    where: { deliveredAt: null, deliverAt: { lte: new Date() } },
    orderBy: { deliverAt: "asc" },
    take: 300,
  });
  const tokens = new Map<string, string | null>();
  let delivered = 0;
  let failed = 0;

  for (const c of due) {
    if (!tokens.has(c.botId)) {
      const b = await prisma.bot.findUnique({ where: { id: c.botId }, select: { token: true, isActive: true } });
      tokens.set(c.botId, b && b.isActive ? b.token : null);
    }
    const token = tokens.get(c.botId);
    if (!token) continue;

    const toFriend = c.kind === "FRIEND" && c.recipientId;
    const target = c.kind === "SELF" ? c.senderId : c.recipientId || c.senderId;
    const text = toFriend
      ? `🎁 وصلتك كبسولة من الماضي!\n\nكتبها لك صديقك بتاريخ ${fmt(c.created_at)}:\n\n«${c.text}»\n\n⏳ اكتب أنت أيضاً كبسولة لمستقبلك من القائمة.`
      : c.kind === "SELF"
        ? `⏳ وصلتك كبسولة من الماضي!\n\nكتبتها لنفسك بتاريخ ${fmt(c.created_at)}:\n\n«${c.text}»\n\nكيف حالك الآن مقارنةً بذلك اليوم؟ 💭`
        : `↩️ لم يفتح صديقك رابط كبسولتك في الوقت المناسب، فتعود إليك رسالتك التي كتبتها بتاريخ ${fmt(c.created_at)}:\n\n«${c.text}»`;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(target), text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok || data?.error_code === 403) {
        await prisma.capsule.update({ where: { id: c.id }, data: { deliveredAt: new Date() } });
        if (data?.ok) delivered++;
        else failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, due: due.length, delivered, failed });
}
