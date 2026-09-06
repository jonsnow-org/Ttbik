import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Sends a message to every Nova user who has a telegramId (i.e. reached
// Nova through the Telegram channel) — same idea as the broadcast feature
// every other bot template has, but Nova's own version since NOVA_BOT
// isn't part of the shared bot-platform dispatcher's admin_ command set.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "الرسالة فارغة" }, { status: 400 });

  const bot = await prisma.bot.findFirst({ where: { template: "NOVA_BOT" }, orderBy: { created_at: "asc" } });
  if (!bot) return NextResponse.json({ error: "لا يوجد بوت Nova منشور بعد" }, { status: 400 });

  const users = await prisma.novaUser.findMany({
    where: { telegramId: { not: null } },
    select: { telegramId: true },
  });

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    if (!u.telegramId) continue;
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.telegramId, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, failed, total: users.length });
}
