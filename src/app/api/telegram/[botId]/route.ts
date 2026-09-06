import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { handleAdBotUpdate } from "@/lib/adBotLogic";
import { handleMarriageBotUpdate } from "@/lib/matchBotLogic";
import { handleJobsBotUpdate } from "@/lib/jobsBotLogic";
import { handleMedicalBotUpdate } from "@/lib/medicalBotLogic";
import { handleNovaBotUpdate } from "@/lib/novaBotLogic";

// Default Vercel Hobby function timeout is 10s — raised for headroom since
// MARRIAGE_BOT's random-chat search now does a brief (~3s) animated
// "searching" message sequence (see startRandomChat in matchBotLogic.ts)
// on top of its usual DB work. Raised further to 60 (Vercel Hobby's max)
// for NOVA_BOT specifically: its FastAPI backend runs on Render's free
// tier, which spins the service down after ~15 min idle and takes
// 30-50s to wake on the next request — the first message after any gap
// needs that much headroom, on top of the actual Groq/Gemini calls.
// Doesn't affect any other update — this is just a higher ceiling, not
// a forced wait.
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { botId: string } }) {
  let botRow: Awaited<ReturnType<typeof prisma.bot.findUnique>> = null;
  let rawBody: any = null;
  try {
    const secret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    botRow = await prisma.bot.findUnique({ where: { id: params.botId } });

    if (!botRow || !botRow.isActive) {
      return NextResponse.json({ error: "Bot inactive or missing" }, { status: 404 });
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
      } else {
        // STORE / HOSPITAL: the owner's blueprint only ever specified AD_BOT
        // logic in detail — these templates get a minimal working /start so
        // picking them doesn't error, without inventing flows that weren't
        // actually given.
        const msg = body.message;
        if (msg?.text?.startsWith("/start") && msg.chat?.id) {
          const label = botRow.template === "STORE" ? "🛒 بوت المتجر" : "🏥 بوت المشفى";
          await bot.api.sendMessage(msg.chat.id, `${label} قيد الإعداد من مالك المنصة. تواصل مع منشئ البوت للمزيد.`);
        }
      }
    }
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook Error:", error);
    // Without this, an unhandled exception here is INVISIBLE to the
    // owner — Telegram never surfaces a server's 500 to the end-user (they
    // just see total silence, including on /start), and Vercel's server
    // logs aren't something the owner checks by default. Best-effort DM to
    // SUPER_ADMIN with the real error + which bot/chat triggered it, so a
    // crash like this is diagnosable from Telegram itself instead of
    // guesswork (owner incident, 2026-09-06: a real user's bot went
    // completely silent, even to /start, with no way to tell why).
    const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (superAdminId && botRow) {
      try {
        const notifyBot = new TelegramBot(botRow.token);
        const message = error instanceof Error ? error.message : String(error);
        const fromChat = rawBody?.message?.chat?.id ?? rawBody?.callback_query?.message?.chat?.id ?? "?";
        await notifyBot.api
          .sendMessage(
            Number(superAdminId),
            `⚠️ خطأ غير متوقع في بوت ${botRow.template} (${botRow.id}):\n${message}\n\nمحادثة: ${fromChat}`
          )
          .catch(() => null);
      } catch {
        // Best-effort only — never let a failure here mask the original 500.
      }
    }
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
