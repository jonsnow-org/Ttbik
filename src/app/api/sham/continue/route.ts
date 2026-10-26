// The next leg of a long Sham task (src/lib/novaBotLogic.ts continueShamRun): called by the previous leg through the shared background runner,
// signed with the bot's own webhook secret (the same signing as /api/coder/continue). Answers 202 at once; the work runs in later().
import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { later } from "@/lib/coderRuntime";
import { verifyContinue } from "@/lib/coderSections";
import { continueShamRun } from "@/lib/novaBotLogic";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { botId?: string; chatId?: string; chain?: string; sig?: string } | null;
  if (!body?.botId || !body.chatId || !body.chain || !body.sig) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const botRow = await prisma.bot.findUnique({ where: { id: body.botId } }).catch(() => null);
  if (!botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  if (!verifyContinue(botRow.webhookSecret || "", botRow.id, body.chatId, body.chain, body.sig)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const chatId = Number(body.chatId);
  if (!Number.isFinite(chatId)) return NextResponse.json({ error: "bad chat" }, { status: 400 });
  const bot = new TelegramBot(botRow.token);
  later(() => continueShamRun(bot, chatId, botRow.id));
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
