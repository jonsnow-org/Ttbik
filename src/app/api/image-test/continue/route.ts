import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { prismaDb } from "@/lib/coderAuth";
import { later } from "@/lib/coderRuntime";
import { verifyContinue } from "@/lib/coderSections";
import { continueImageGenerationTest } from "@/lib/imageGenerationTests";

// Signed continuation leg for long CPU image generation. Each invocation is
// bounded to 235s of polling and may request another signed leg when needed.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    botId?: string;
    chatId?: string;
    runId?: string;
    sig?: string;
  } | null;
  if (!body?.botId || !body.chatId || !body.runId || !body.sig) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const chatId = Number(body.chatId);
  if (!Number.isSafeInteger(chatId) || !String(body.runId).startsWith("image-")) {
    return NextResponse.json({ error: "bad task reference" }, { status: 400 });
  }
  const botRow = await prisma.bot.findUnique({ where: { id: body.botId } }).catch(() => null);
  if (!botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  if (!verifyContinue(botRow.webhookSecret || "", botRow.id, body.chatId, body.runId, body.sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const bot = new TelegramBot(botRow.token);
  later(() => continueImageGenerationTest(
    bot,
    chatId,
    botRow.id,
    botRow.webhookSecret || "",
    body.runId!,
    prismaDb,
  ));
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
