import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { handleAdBotUpdate } from "@/lib/adBotLogic";
import { handleMarriageBotUpdate } from "@/lib/matchBotLogic";
import { handleJobsBotUpdate } from "@/lib/jobsBotLogic";
import { handleMedicalBotUpdate } from "@/lib/medicalBotLogic";
import { handleNovaBotUpdate } from "@/lib/novaBotLogic";
import { handleConfessionBotUpdate } from "@/lib/confessionBotLogic";
import { handleNameCompatBotUpdate } from "@/lib/nameCompatBotLogic";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { botId: string } }) {
  let botRow: Awaited<ReturnType<typeof prisma.bot.findUnique>> = null;
  let rawBody: any = null;
  try {
    const secret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    botRow = await prisma.bot.findUnique({ where: { id: params.botId } });

    // Inactive / missing bots: return 200 so Telegram stops retry storms (was 404 spam in logs)
    if (!botRow || !botRow.isActive) {
      return NextResponse.json({ status: "ignored", reason: "bot inactive or missing" });
    }
    if (secret !== botRow.webhookSecret) {
      return NextResponse.json({ error: "invalid secret" }, { status: 401 });
    }

    const bot = new TelegramBot(botRow.token);
    const body = await req.json().catch(() => null);
    rawBody = body;
    if (body) {
      if (botRow.template === "AD_BOT") {
        await handleAdBotUpdate(bot, botRow, body);
      } else if (botRow.template === "MARRIAGE_BOT") {
        await handleMarriageBotUpdate(bot, botRow, body);
      } else if (botRow.template === "JOBS_BOT") {
        await handleJobsBotUpdate(bot, botRow, body);
      } else if (botRow.template === "MEDICAL_BOT") {
        await handleMedicalBotUpdate(bot, botRow, body);
      } else if (botRow.template === "NOVA_BOT") {
        await handleNovaBotUpdate(bot, botRow, body);
      } else if (botRow.template === "CONFESSION_BOT") {
        await handleConfessionBotUpdate(bot, botRow, body);
      } else if (botRow.template === "NAME_COMPAT_BOT") {
        await handleNameCompatBotUpdate(bot, botRow, body);
      } else {
        const msg = body.message;
        if (msg?.text?.startsWith("/start") && msg.chat?.id) {
          const label = botRow.template === "STORE" ? "🛒 بوت المتجر" : "🏥 بوت المشفى";
          await bot.api.sendMessage(
            msg.chat.id,
            `${label} قيد الإعداد من مالك المنصة. تواصل مع منشئ البوت للمزيد.`
          );
        }
      }
    }
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook Error:", error);
    const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (superAdminId && botRow) {
      try {
        const notifyBot = new TelegramBot(botRow.token);
        const message = error instanceof Error ? error.message : String(error);
        const fromChat =
          rawBody?.message?.chat?.id ?? rawBody?.callback_query?.message?.chat?.id ?? "?";
        await notifyBot.api
          .sendMessage(
            Number(superAdminId),
            `⚠️ خطأ غير متوقع في بوت ${botRow.template} (${botRow.id}):\n${message}\n\nمحادثة: ${fromChat}`
          )
          .catch(() => null);
      } catch {
        /* best-effort */
      }
    }
    // 200, not 500: Telegram redelivers any update answered with an error status,
    // repeatedly, so a handler that failed halfway (credits added, message sent,
    // then a throw) would run its side effects again on every retry. The owner is
    // already notified above; the update is dropped once, on purpose.
    return NextResponse.json({ status: "error" });
  }
}
