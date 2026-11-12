import { publicSiteUrl } from "@/lib/siteUrl";
import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { startGuide } from "@/lib/botStartGuide";

/**
 * FADAA_BOT — «فضاء»: جلسات مؤقتة لغرض واضح ثم تُغلق.
 * التشغيل على Vercel webhook فقط (بدون Render).
 * التطبيق المصغر: /fadaa — جلسات مشتركة مخزنة على Supabase مع توثيق Telegram.
 */

const SITE = publicSiteUrl();

function miniAppUrl(botId: string, sessionId?: string): string {
  const url = new URL(`${SITE}/fadaa`);
  url.searchParams.set("bot", botId);
  if (sessionId) url.searchParams.set("session", sessionId);
  return url.toString();
}

function userMenu(botId: string): InlineKeyboard {
  return new InlineKeyboard().webApp("🌌 فتح فضاء", miniAppUrl(botId));
}

function ownerMenu(botId: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🌌 فتح فضاء", miniAppUrl(botId))
    .row()
    .text("ℹ️ دليل المالك", "fadaa_owner_help");
}

export async function handleFadaaBotUpdate(
  bot: TelegramBot,
  botRow: BotRow,
  body: any,
): Promise<void> {
  const msg = body.message;
  const cq = body.callback_query;
  const ownerId = String(botRow.ownerId || "");

  if (cq) {
    const chatId = cq.message?.chat?.id;
    const data = String(cq.data || "");
    const fromId = String(cq.from?.id || "");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    if (!chatId) return;
    if (data === "fadaa_stats" && fromId === ownerId) {
      await bot.api.sendMessage(
        chatId,
        "افتح التطبيق المصغر لعرض جلسات بوتك وإدارتها.",
      );
      return;
    }
    if (data === "fadaa_owner_help" && fromId === ownerId) {
      await bot.api.sendMessage(
        chatId,
        "دليل المالك — فضاء\n\n• افتح التطبيق المصغر من الزر أدناه.\n• الجلسات والإسهامات تُحفظ في قاعدة البيانات وتظهر للمشاركين.\n• يمكنك إغلاق الجلسة التي أنشأتها من داخل غرفتها.\n• لا تشارك بيانات حساب Telegram مع أي شخص.",
      );
      return;
    }
    if (data === "fadaa_broadcast" && fromId === ownerId) {
      await bot.api.sendMessage(chatId, "للبث الجماعي استخدم قناة/مجموعة مرتبطة لاحقاً. حالياً ركّز على فتح التطبيق المصغر.");
      return;
    }
    return;
  }

  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();
  const fromId = String(msg.from?.id || "");
  const isOwner = fromId && fromId === ownerId;

  if (text.startsWith("/start")) {
    await bot.api.setChatMenuButton({
      menu_button: { type: "web_app", text: "🌌 فضاء", web_app: { url: miniAppUrl(botRow.id) } },
    }).catch(() => null);
  }

  const invite = text.match(/^\/start(?:@\w+)?\s+join_([0-9a-f-]{36})$/i);
  if (invite) {
    const sessionId = invite[1];
    await bot.api.sendMessage(
      chatId,
      "وصلتك دعوة للمشاركة في جلسة على فضاء. افتح الجلسة واختر دورك لتشارك في النقاش:",
      { reply_markup: new InlineKeyboard().webApp("🌌 الانضمام إلى الجلسة", miniAppUrl(botRow.id, sessionId)) },
    );
    return;
  }

  if (fromId) {
    try {
      await recordBotVisit(botRow.id, fromId);
    } catch {
      /* optional */
    }
  }

  if (text.startsWith("/start") || text === "🌌 فضاء" || text === "فتح فضاء") {
    const greet = (isOwner ? "👑 مالك البوت\n\n" : "") + startGuide("FADAA");
    await bot.api.sendMessage(chatId, greet, {
      reply_markup: isOwner ? ownerMenu(botRow.id) : userMenu(botRow.id),
    });
    // Persistent reply keyboard shortcut
    await bot.api.sendMessage(chatId, "القائمة السريعة:", {
      reply_markup: new Keyboard().text("🌌 فضاء").text("ℹ️ مساعدة").resized().persistent(),
    }).catch(() => null);
    return;
  }

  if (text === "ℹ️ مساعدة" || text.startsWith("/help")) {
    await bot.api.sendMessage(
      chatId,
      "فضاء — مساعدة سريعة\n\n• افتح جلسة (معرفة / تجربة / قرار)\n• اختر دوراً قبل الكتابة\n• أسهم ثم تُغلق الجلسة تلقائياً\n• الخلاصات تظهر بعد الإغلاق\n\nكل التفاصيل داخل التطبيق المصغر.",
      { reply_markup: userMenu(botRow.id) },
    );
    return;
  }

  await bot.api.sendMessage(chatId, "استخدم /start أو زر «🌌 فضاء» لفتح التطبيق المصغر.", {
    reply_markup: userMenu(botRow.id),
  });
}
