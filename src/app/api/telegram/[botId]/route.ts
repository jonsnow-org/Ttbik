import { handlePlatformBotUpdate } from "@/lib/platformBotLogic";
import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/errorLog";
import { preCheckout } from "@/lib/atharStars";
import { noteFailover } from "@/lib/hostingOps";
import { ATHAR_SITE } from "@/lib/atharMirror";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { handleAdBotUpdate } from "@/lib/adBotLogic";
import { handleMarriageBotUpdate } from "@/lib/matchBotLogic";
import { handleJobsBotUpdate } from "@/lib/jobsBotLogic";
import { handleMedicalBotUpdate } from "@/lib/medicalBotLogic";
import { handleNovaBotUpdate } from "@/lib/novaBotLogic";
import { handleCoderSections, shamContextFor } from "@/lib/coderSections";
import { shamModeCtx, shamVariant } from "@/lib/shamStudio";
import { coderChatKey } from "@/lib/coderAuth";
import { handleConfessionBotUpdate } from "@/lib/confessionBotLogic";
import { handleNameCompatBotUpdate } from "@/lib/nameCompatBotLogic";
import { handleQuizBotUpdate } from "@/lib/quizBotLogic";
import { handleStreakBotUpdate } from "@/lib/streakBotLogic";
import { handlePrayerBotUpdate } from "@/lib/prayerBotLogic";
import { OWNER_PANEL_TEMPLATES, ownerId, ownerPanelTransformer } from "@/lib/ownerPanel";
import { handleCapsuleBotUpdate } from "@/lib/capsuleBotLogic";
import { handleFadaaBotUpdate } from "@/lib/fadaaBotLogic";
import { handleAtharBotUpdate } from "@/lib/atharBotLogic";
import { grokNotificationFrom } from "@/lib/grokWebhook";

import { createHmac, randomUUID } from "crypto";

async function notifyGrok(botId: string, template: string, ownerId: string, body: any) {
  const url = process.env.GROK_BOT_WEBHOOK_URL;
  const secret = process.env.GROK_BOT_WEBHOOK_SECRET;
  const trigger = grokNotificationFrom(body, [
    ownerId,
    process.env.TELEGRAM_ADMIN_CHAT_ID || "",
    process.env.SUPER_ADMIN_TELEGRAM_ID || "",
  ]);
  if (!url || !secret || !trigger) return;
  const payload = JSON.stringify({ botId, template, chatId: trigger.chatId, text: trigger.text });
  const id = `msg_${randomUUID().replace(/-/g, "")}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: payload,
  }).catch(() => null);
}

import { handleZenobiaBotUpdate } from "@/lib/zenobiaBotLogic";
import { handleHubBotUpdate, isHubTemplate } from "@/lib/hubBotLogic";

export const maxDuration = 60;

// The SQL file (in prisma/) that creates each owner-only template's tables.
const MIGRATION_FOR_TEMPLATE: Record<string, string> = {
  MARRIAGE_BOT: "migration_7_marriage_bot.sql",
  JOBS_BOT: "migration_16_jobs_bot.sql",
  MEDICAL_BOT: "migration_18_medical_bot.sql",
  NOVA_BOT: "migration_19_nova_ai.sql",
  CONFESSION_BOT: "migration_34_confession_bot.sql",
  NAME_COMPAT_BOT: "migration_35_name_compat_bot.sql",
  QUIZ_BOT: "migration_37_quiz_bot.sql",
  STREAK_BOT: "migration_38_streak_bot.sql",
  PRAYER_BOT: "migration_39_prayer_bot.sql",
  CAPSULE_BOT: "migration_40_capsule_bot.sql",
  FADAA_BOT: "migration_fadaa.sql",
  ATHAR_BOT: "migration_full_current_schema.sql",
  ZENOBIA_BOT: "migration_full_current_schema.sql", // its table is created on first use
  ZNBT_PLATFORM_BOT: "migration_full_current_schema.sql", // uses the znbt_* tables created on first use
};

export async function POST(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  void noteFailover(req.headers);   // when the gate serves this request from the standby because Oracle is down, tell the owner (throttled)
  const params = await props.params;
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
    if (OWNER_PANEL_TEMPLATES.has(botRow.template) || (botRow.template === "AD_BOT" && !!ownerId() && botRow.ownerId === ownerId())) bot.api.config.use(ownerPanelTransformer(botRow.id));
    const body = await req.json().catch(() => null);
    rawBody = body;
    if (body) {
      void notifyGrok(botRow.id, botRow.template, botRow.ownerId, body);
      // Telegram Stars (XTR): the pre-checkout handshake is identical for
      // every bot — approve immediately, there's no stock to check, only a
      // balance top-up. Must be answered within 10s, so this skips the
      // per-template dispatch entirely. See src/lib/starsPayment.ts.
      if (body.pre_checkout_query) {
        if (botRow.template === "ATHAR_BOT") {
          // Athar sells a one-of-a-kind token: the order, the buyer, the price, the reservation and the chain are checked first (src/lib/atharStars.ts)
          const d = await preCheckout(body.pre_checkout_query, ATHAR_SITE);
          await (d.ok ? bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true) : bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, false, { error_message: d.message })).catch(() => null);
          return NextResponse.json({ status: "ok" });
        }
        if (botRow.template === "STREAK_BOT" && String(body.pre_checkout_query.invoice_payload || "").startsWith("KHATMA:")) {
          // 🕊 memorial khatma: only a pending order of this payer at its full price (src/lib/khatma/khatma.ts)
          const { khatmaPreCheckout } = await import("@/lib/khatma/khatma");
          const d = await khatmaPreCheckout(botRow, body.pre_checkout_query).catch(() => ({ ok: false, message: "تعذّر التحقق الآن، حاول بعد قليل." }));
          await (d.ok ? bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true) : bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, false, { error_message: d.message || "غير متاح" })).catch(() => null);
          return NextResponse.json({ status: "ok" });
        }
        if (botRow.template === "STREAK_BOT" && String(body.pre_checkout_query.invoice_payload || "").startsWith("KSP:")) {
          // 🏆 contest sponsor slot paid in Stars to the contest bot (the Stars buy the winners' Telegram prizes)
          const { sponsorPreCheckout } = await import("@/lib/khatma/khatma");
          const d = await sponsorPreCheckout(body.pre_checkout_query).catch(() => ({ ok: false, message: "تعذّر التحقق الآن، حاول بعد قليل." }));
          await (d.ok ? bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true) : bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, false, { error_message: d.message || "غير متاح" })).catch(() => null);
          return NextResponse.json({ status: "ok" });
        }
        if (botRow.template === "NOVA_BOT" && String(body.pre_checkout_query.invoice_payload || "").startsWith("cplan:")) {
          // the coder's plans paid in Stars: signed payload, same buyer, plan still on sale at that price (src/lib/coderStars.ts)
          const { preCheckoutCoder } = await import("@/lib/coderStars");
          const d = await preCheckoutCoder(body.pre_checkout_query).catch(() => ({ ok: false as const, message: "تعذّر التحقق الآن، حاول بعد قليل." }));
          await (d.ok ? bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true) : bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, false, { error_message: d.message })).catch(() => null);
          return NextResponse.json({ status: "ok" });
        }
        if (botRow.template === "MARRIAGE_BOT") {
          // 💍 Only this bot's own MATCH_* invoices, paid by the user they were made for (src/lib/match/guardRules.ts):
          // a forwarded/shared invoice paid by someone else used to be approved and then credited to nobody.
          const { matchPreCheckout } = await import("@/lib/match/guardRules");
          const d = matchPreCheckout(String(body.pre_checkout_query.invoice_payload || ""), String(body.pre_checkout_query.from?.id ?? ""));
          await (d.ok ? bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true) : bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, false, { error_message: d.message })).catch(() => null);
          return NextResponse.json({ status: "ok" });
        }
        await bot.api.answerPreCheckoutQuery(body.pre_checkout_query.id, true).catch(() => null);
        return NextResponse.json({ status: "ok" });
      }
      // The Stop button on a live draft (Bot API sendMessageDraft, can_stop). It arrives as its own update, before any
      // message, and must be recorded where the answering loop can see it. Nothing else about this update needs handling.
      if (body.stopped_message_generation) {
        const stopChat = Number(body.stopped_message_generation.chat?.id);
        if (Number.isFinite(stopChat)) {
          const { markStopped } = await import("@/lib/liveReply");
          markStopped(stopChat);
          const { stopRun } = await import("@/lib/coderSections");
          void stopRun(stopChat).catch(() => null);
        }
        return NextResponse.json({ status: "ok" });
      }
      // These bots only work in private chats. Messages from groups, supergroups
      // and channels (the bot is often added to them as an admin) used to run
      // the normal handlers, which then failed with errors such as "phone number
      // can be requested in private chats only" and spammed the owner. Ignore
      // them here, for every template at once.
      const chatType = body.message?.chat?.type ?? body.callback_query?.message?.chat?.type;
      if (chatType && chatType !== "private" && botRow.template === "STREAK_BOT") {
        // 📖 Group khatma (the one exception): STREAK_BOT answers in a group only to /khatma and taps on its own board.
        // 🏆 Group contests (src/lib/contests) answer /contest, /top and their own buttons; everything else goes to the khatma handler.
        const { handleContestGroupUpdate } = await import("@/lib/contests/contests");
        const { handleKhatmaGroupUpdate } = await import("@/lib/khatma/khatma");
        const contest = await handleContestGroupUpdate(bot, botRow, body).catch((e) => { void reportError("bot:contest-group", e, { botId: botRow?.id }); return true; });
        if (!contest) await handleKhatmaGroupUpdate(bot, botRow, body).catch((e) => { void reportError("bot:khatma-group", e, { botId: botRow?.id }); });
        return NextResponse.json({ status: "ok" });
      }
      if (chatType && chatType !== "private") {
        return NextResponse.json({ status: "ignored", reason: "non-private chat" });
      }


      if (botRow.template === "CHANNEL_PUBLISH_BOT") {
        const chatId = body.message?.chat?.id;
        if (chatId) {
          await bot.api.sendMessage(chatId, "بوت نشر قناة الموقع. لا لوحة مستخدم هنا، والمنشورات تخرج إلى القناة حسب الجدولة.");
        }
        return NextResponse.json({ status: "ok" });
      }
      if (botRow.template === "AD_BOT") {
        await handleAdBotUpdate(bot, botRow, body);
      } else if (botRow.template === "MARRIAGE_BOT") {
        await handleMarriageBotUpdate(bot, botRow, body);
      } else if (botRow.template === "JOBS_BOT") {
        await handleJobsBotUpdate(bot, botRow, body);
      } else if (botRow.template === "MEDICAL_BOT") {
        await handleMedicalBotUpdate(bot, botRow, body);
      } else if (botRow.template === "NOVA_BOT") {
        // Two sections: Nova (the coder engine, src/lib/coderSections.ts, the default) and Sham (old / v2). WHICH one answers is decided by the chat's own model inside
        // handleCoderSections (it returns false for a Sham chat, or when OPEN_CODER_STUDIO_URL is unset). The legacy-backend flag (novaPause.ts) plays no part here (B-09).
        const routeChatId = body.message?.chat?.id ?? body.callback_query?.message?.chat?.id;
        let selectedShamModel: "sham" | "sham_v2" | undefined;
        const coderHandled = await handleCoderSections(bot, botRow, body, undefined, (model) => { selectedShamModel = model; }).catch(async (e) => {
          void reportError("bot:coder", e, { botId: botRow?.id });
          // Do not fall through to a different model when state resolution / the selected-model handler failed.
          if (routeChatId) await bot.api.sendMessage(routeChatId, "⚠️ تعذّر التحقق من النموذج المختار بسبب خطأ مؤقت. لم أرسل رسالتك إلى نموذج بديل؛ أعد المحاولة بعد قليل.").catch(() => null);
          return true;
        });
        if (!coderHandled) {
          // Keep the route selected by the message handler; never reread a mutable model selection and retarget an in-flight message.
          const ctx = await shamContextFor(body, undefined, selectedShamModel).catch((e) => { void reportError("bot:sham-context", e, { botId: botRow?.id }); return null; });
          if (!ctx) {
            if (routeChatId) await bot.api.sendMessage(routeChatId, "⚠️ تعذّر قراءة اختيار النموذج. لم أرسل رسالتك إلى نموذج آخر؛ أعد المحاولة بعد قليل.").catch(() => null);
            return NextResponse.json({ status: "model_state_unavailable" });
          }
          if (routeChatId) console.info("[model-route] Telegram dispatch", { chatKey: coderChatKey(routeChatId), handler: "sham", variant: ctx.variant });
          const novaRow = botRow;                                  // narrowed here: the closures below would lose the null check
          await shamVariant.run(ctx.variant, () => shamModeCtx.run(ctx.mode, () => handleNovaBotUpdate(bot, novaRow, body)));
        } else if (routeChatId) {
          console.info("[model-route] Telegram dispatch", { chatKey: coderChatKey(routeChatId), handler: "coder" });
        }
      } else if (botRow.template === "CONFESSION_BOT") {
        await handleConfessionBotUpdate(bot, botRow, body);
      } else if (botRow.template === "NAME_COMPAT_BOT") {
        await handleNameCompatBotUpdate(bot, botRow, body);
      } else if (botRow.template === "QUIZ_BOT") {
        await handleQuizBotUpdate(bot, botRow, body);
      } else if (botRow.template === "STREAK_BOT") {
        await handleStreakBotUpdate(bot, botRow, body);
      } else if (botRow.template === "PRAYER_BOT") {
        await handlePrayerBotUpdate(bot, botRow, body);
      } else if (botRow.template === "CAPSULE_BOT") {
        await handleCapsuleBotUpdate(bot, botRow, body);
      } else if (botRow.template === "FADAA_BOT") {
        await handleFadaaBotUpdate(bot, botRow, body);
      } else if (botRow.template === "ATHAR_BOT") {
        await handleAtharBotUpdate(bot, botRow, body);
      } else if (botRow.template === "ZENOBIA_BOT") {
        await handleZenobiaBotUpdate(bot, botRow, body);
      } else if (botRow.template === "ZNBT_PLATFORM_BOT") {
        await handlePlatformBotUpdate(bot, botRow, body);
      } else if (isHubTemplate(botRow.template)) {
        await handleHubBotUpdate(bot, botRow, body); // creator hub (/create) templates, tables created on first use
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
    void reportError(`bot:${botRow?.template ?? "?"}`, error, { botId: params.botId });
    const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (superAdminId && botRow) {
      try {
        const notifyBot = new TelegramBot(botRow.token);
        // A template whose tables were never created in Supabase fails on
        // every update — tell the owner which SQL file to run instead of a
        // raw Prisma dump.
        const missingTable = (error as { code?: string })?.code === "P2021";
        const migration = MIGRATION_FOR_TEMPLATE[botRow.template];
        const message = missingTable
          ? `جداول هذا القالب غير موجودة في قاعدة البيانات بعد.\nشغّل الملف prisma/${migration || "migration_full_current_schema.sql"} مرة واحدة في Supabase ← SQL Editor ثم جرّب /start من جديد.`
          : error instanceof Error ? error.message : String(error);
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
