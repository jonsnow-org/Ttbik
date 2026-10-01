import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";

/**
 * FADAA_BOT — «فضاء»: جلسات مؤقتة لغرض واضح ثم تُغلق.
 * التشغيل على Vercel webhook فقط (بدون Render).
 * التطبيق المصغر: /fadaa — التخزين عبر Supabase (مجاني) مع احتياطي محلي في المتصفح.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

function miniAppUrl(botId: string): string {
  return `${SITE}/fadaa?bot=${encodeURIComponent(botId)}`;
}

function userMenu(botId: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🌌 فتح فضاء", miniAppUrl(botId))
    .row()
    .url("ℹ️ عن فضاء", `${SITE}/fadaa?about=1`);
}

function ownerMenu(botId: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🌌 فتح فضاء", miniAppUrl(botId))
    .row()
    .text("📊 إحصائيات", "fadaa_stats")
    .text("📢 بث", "fadaa_broadcast")
    .row()
    .text("ℹ️ مساعدة المالك", "fadaa_owner_help");
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
        "📊 إحصائيات فضاء\n\nالجلسات والمساهمات تُدار داخل التطبيق المصغر.\nافتح «🌌 فتح فضاء» لعرض الأرشيف ولوحة المشرف (PIN داخل التطبيق).",
      );
      return;
    }
    if (data === "fadaa_owner_help" && fromId === ownerId) {
      await bot.api.sendMessage(
        chatId,
        "مساعدة المالك — فضاء\n\n• التطبيق المصغر يعمل على Vercel (لا يعتمد على Render).\n• التخزين السحابي عبر Supabase عند توفّر الجداول.\n• بدون جداول: يبقى التخزين محلياً على جهاز المستخدم.\n• PIN المشرف الافتراضي داخل التطبيق: 7042 (غيّره من لوحة الأدمن في فضاء).",
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

  if (fromId) {
    try {
      await recordBotVisit(botRow.id, fromId);
    } catch {
      /* optional */
    }
  }

  if (text.startsWith("/start") || text === "🌌 فضاء" || text === "فتح فضاء") {
    const greet = isOwner
      ? "أهلاً بك يا مالك بوت فضاء 🌌\n\nجلسات مؤقتة لغرض واضح… ثم تُغلق.\nاستخدم الزر لفتح التطبيق المصغر (معرفة · تجربة · قرار)."
      : "أهلاً بك في فضاء 🌌\n\nجلسة مؤقتة لغرض واضح، بإسهامات محددة، ثم تُغلق في وقتها.\nاضغط الزر لفتح التطبيق المصغر.";
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
