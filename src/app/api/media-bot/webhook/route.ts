import { NextRequest, NextResponse } from "next/server";
import { mediaDb, MEDIA_OWNER_ID, isMediaPremium } from "@/lib/mediaSocial";
import {
  getRenderUrl,
  hookPath,
  hookSecret,
  miniAppKeyboard,
  safeEqual,
  tg,
  MINI_APP_URL,
} from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORWARD_TIMEOUT_MS = 55_000;
const URL_RE = /https?:\/\/\S+/i;

const PREMIUM_DAILY_LIMIT = 50;
const FREE_DAILY_LIMIT = 8;
const PREMIUM_STARS_PRICE = 500;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

const INFO_TEXT =
  "ℹ️ طريقة الاستخدام\n\n" +
  "1) أرسل رابط يوتيوب / تيك توك / إنستغرام / تويتر.\n" +
  "2) اختر الجودة أو الصوت أو الرسالة الصوتية.\n" +
  "3) على يوتيوب: زر «ملخص ذكي» يعرض 3 نقاط من الترجمة قبل التحميل.\n" +
  "4) الملف يُحفظ في الأرشيف ويمكن استنساخه فوراً من التطبيق المصغر.\n\n" +
  "📱 التطبيق المصغر: الزر المربع بجانب حقل الرسالة (يعمل دائماً على الموقع).\n" +
  "⚙️ الأوامر الكاملة للتحميل تعمل عبر محرك Render — إن تأخر الرد انتظر ~ دقيقة بعد أول رسالة.";

function userKeyboard() {
  return {
    keyboard: [
      [{ text: "📥 تحميل وسائط" }],
      [{ text: "👥 غرفتي" }, { text: "⚙️ إعداداتي" }],
      [{ text: "💎 الترقية المدفوعة" }, { text: "ℹ️ معلومات" }],
    ],
    resize_keyboard: true,
  };
}

function ownerKeyboard() {
  return {
    keyboard: [
      [{ text: "📊 إحصائيات" }, { text: "📢 قنوات الاشتراك" }],
      [{ text: "⚙️ إعدادات البوت" }, { text: "👥 إدارة المستخدمين" }],
      [{ text: "💎 الميزات المدفوعة" }, { text: "ℹ️ معلومات" }],
    ],
    resize_keyboard: true,
  };
}

function premiumStarsButton() {
  return { inline_keyboard: [[{ text: "⭐ ادفع بنجوم تيليجرام", callback_data: "premium_stars_buy" }]] };
}

type Outcome = "delivered" | "timeout" | "down";

async function forward(raw: string, secret: string): Promise<Outcome> {
  const base = await getRenderUrl().catch(() => "");
  if (!base) return "down";
  try {
    const r = await fetch(`${base}${hookPath()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: raw,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    // 503 while Python is still starting — treat as timeout so we don't
    // replace the real bot UI with the mini-app-only fallback.
    if (r.status === 503) return "timeout";
    return r.ok ? "delivered" : "down";
  } catch (e) {
    return (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError"
      ? "timeout"
      : "down";
  }
}

async function enqueue(update: any): Promise<boolean> {
  const db = await mediaDb();
  if (!db || typeof update?.update_id !== "number") return false;
  const { error } = await db.from("media_bot_queue").upsert({ update_id: update.update_id, payload: update });
  return !error;
}

async function sendCloned(chatId: number, itemId: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const { data } = await db
    .from("media_feed")
    .select("id,file_id,media_type,title,clones")
    .eq("id", itemId)
    .maybeSingle();
  const item = data as any;
  if (!item?.file_id) return false;
  const type = String(item.media_type || "video");
  const title = String(item.title || "media").slice(0, 64);
  const res =
    type === "audio"
      ? await tg("sendAudio", { chat_id: chatId, audio: item.file_id, title })
      : type === "voice"
        ? await tg("sendVoice", { chat_id: chatId, voice: item.file_id })
        : await tg("sendVideo", { chat_id: chatId, video: item.file_id, supports_streaming: true });
  if (!res?.ok) return false;
  await db
    .from("media_feed")
    .update({ clones: Number(item.clones || 0) + 1 })
    .eq("id", item.id);
  return true;
}

async function premiumInfoText(userId: string): Promise<string> {
  const isPrem = await isMediaPremium(userId);
  if (isPrem) {
    return `💎 الترقية المدفوعة مُفعّلة على حسابك.\nحدك اليومي الحالي: ${PREMIUM_DAILY_LIMIT} تحميل.`;
  }
  return (
    "💎 الترقية المدفوعة\n\n" +
    `• حد يومي أعلى (${PREMIUM_DAILY_LIMIT} تحميل بدل ${FREE_DAILY_LIMIT})\n` +
    "• أولوية أعلى في المعالجة\n\n" +
    `⭐ ادفع مباشرة بنجوم تيليجرام (${PREMIUM_STARS_PRICE} نجمة) من الزر أدناه — تفعيل فوري.\n\n" +
    "— أو —\n" +
    `1) اطلب الخدمة من: ${SITE_URL}/service/media-bot-premium\n` +
    "2) بعد موافقة الإدارة أرسل: /premium ثم رمز طلبك"
  );
}

async function grantPremiumViaStars(userId: string): Promise<void> {
  const db = await mediaDb();
  if (!db) return;
  await db.from("media_premium_users").upsert({ tg_user_id: userId, source: "telegram_stars" });
}

async function handlePreCheckout(update: any): Promise<void> {
  const pcq = update.pre_checkout_query;
  if (!pcq?.id) return;
  await tg("answerPreCheckoutQuery", { pre_checkout_query_id: pcq.id, ok: true });
}

async function handleSuccessfulPayment(update: any): Promise<void> {
  const msg = update.message;
  if (!msg?.successful_payment || !msg.from) return;
  if (msg.successful_payment.invoice_payload !== "media_premium_stars") return;
  const userId = String(msg.from.id);
  await grantPremiumViaStars(userId);
  await tg("sendMessage", {
    chat_id: msg.chat.id,
    text: `✅ تم الدفع بنجاح! الترقية مفعّلة الآن.\nحدك اليومي: ${PREMIUM_DAILY_LIMIT} تحميل.`,
  });
}

async function handleCallback(update: any): Promise<void> {
  const cbq = update.callback_query;
  if (!cbq?.id) return;
  const data = cbq.data || "";
  const chatId = cbq.message?.chat?.id;
  const userId = String(cbq.from?.id || "");

  if (data === "close_msg" && chatId) {
    await tg("answerCallbackQuery", { callback_query_id: cbq.id });
    await tg("editMessageText", { chat_id: chatId, message_id: cbq.message.message_id, text: "تم." });
    return;
  }

  if (data === "premium_stars_buy" && chatId) {
    const isPrem = await isMediaPremium(userId);
    if (isPrem) {
      await tg("answerCallbackQuery", {
        callback_query_id: cbq.id,
        text: "الترقية مفعّلة بالفعل.",
        show_alert: true,
      });
      return;
    }
    await tg("answerCallbackQuery", { callback_query_id: cbq.id });
    await tg("sendInvoice", {
      chat_id: chatId,
      title: "💎 ترقية بوت الوسائط",
      description: `رفع حدك اليومي إلى ${PREMIUM_DAILY_LIMIT} تحميل وأولوية أعلى في المعالجة.`,
      payload: "media_premium_stars",
      currency: "XTR",
      prices: [{ label: "ترقية بريميوم", amount: PREMIUM_STARS_PRICE }],
    });
    return;
  }

  if (data === "check_sub" && chatId) {
    await tg("answerCallbackQuery", { callback_query_id: cbq.id });
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: cbq.message.message_id,
      text: "✅ تم التحقق. أرسل الرابط الآن.",
    });
    return;
  }

  // Other callbacks (quality, share, squad) need the Python bot — acknowledge only.
  await tg("answerCallbackQuery", {
    callback_query_id: cbq.id,
    text: "⏳ المحرك يستيقظ — أعد المحاولة بعد ثوانٍ",
    show_alert: false,
  });
}

/** Fallback only when Render did not accept the update. */
async function handleMessage(update: any, outcome: Outcome): Promise<void> {
  const msg = update.message;
  if (!msg?.chat?.id || !msg.from) return;
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = String(msg.text || "").trim();
  const isOwner = userId === MEDIA_OWNER_ID;
  const waking = outcome === "timeout";

  if (msg.successful_payment) {
    await handleSuccessfulPayment(update);
    return;
  }

  if (text.startsWith("/start clone_")) {
    const itemId = text.slice("/start clone_".length).trim();
    const ok = await sendCloned(chatId, itemId);
    if (!ok) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "انتهت صلاحية هذا الملف أو غير موجود.",
        reply_markup: miniAppKeyboard(),
      });
    }
    return;
  }

  if (text.startsWith("/start msg_")) return;

  if (text === "/start" || text.startsWith("/start ")) {
    const wakeNote = waking ? "\n\n⏳ المحرك يستيقظ — أرسل الرابط بعد بضع ثوانٍ." : "";
    if (isOwner) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "👑 لوحة مالك البوت\n\nأرسل أي رابط للتحميل مباشرة." + wakeNote,
        reply_markup: ownerKeyboard(),
      });
    } else {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "مرحباً 👋\nأرسل رابط يوتيوب / تيك توك / إنستغرام..." + wakeNote,
        reply_markup: userKeyboard(),
      });
    }
    return;
  }

  if (text.startsWith("/premium")) {
    const isPrem = await isMediaPremium(userId);
    if (isPrem) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: `💎 الترقية مُفعّلة بالفعل.\nحدك اليومي: ${PREMIUM_DAILY_LIMIT} تحميل.`,
      });
    } else {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "استخدم: /premium ثم رمز طلبك\nأو ادفع بنجوم تيليجرام من زر الترقية.",
        reply_markup: premiumStarsButton(),
      });
    }
    return;
  }

  if (text.startsWith("/")) return;

  if (text === "ℹ️ معلومات" || text === "❓ مساعدة") {
    await tg("sendMessage", { chat_id: chatId, text: INFO_TEXT });
    return;
  }

  if (text === "📥 تحميل وسائط") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "⏳ المحرك يستيقظ... أرسل الرابط خلال دقيقة وسأعرض خيارات الجودة."
        : "أرسل الرابط مباشرة وسأعرض الخيارات.",
    });
    return;
  }

  if (text === "💎 الترقية المدفوعة" || text === "💎 الميزات المدفوعة") {
    if (text === "💎 الميزات المدفوعة" && isOwner) {
      const db = await mediaDb();
      let count = 0;
      if (db) {
        const { count: c } = await db.from("media_premium_users").select("*", { count: "exact", head: true });
        count = c || 0;
      }
      await tg("sendMessage", { chat_id: chatId, text: `💎 عدد المشتركين في الترقية المدفوعة: ${count}` });
      return;
    }
    const premText = await premiumInfoText(userId);
    const isPrem = await isMediaPremium(userId);
    await tg("sendMessage", {
      chat_id: chatId,
      text: premText,
      reply_markup: isPrem ? undefined : premiumStarsButton(),
    });
    return;
  }

  // Owner panel — real text, not mini-app-only (fixes screenshot issue)
  if (isOwner && text === "⚙️ إعدادات البوت") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "⚙️ إعدادات البوت\n\n" +
        (waking
          ? "⏳ المحرك يستيقظ الآن. أعد الضغط بعد 30–60 ثانية لإعدادات الأرشيف والاشتراك الكاملة.\n\n"
          : "المحرك غير متصل مؤقتاً. تأكد أن خدمة media-bot على Render تعمل، ثم أعد /start.\n\n") +
        "يمكنك إرسال رابط للتحميل مباشرة عند عودة المحرك.",
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && text === "👥 إدارة المستخدمين") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "👥 إدارة المستخدمين\n\n" +
        (waking
          ? "⏳ المحرك يستيقظ — أعد المحاولة بعد ثوانٍ للإحصائيات الحية."
          : "المحرك غير متصل. شغّل خدمة Render ثم أعد المحاولة."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && (text === "📢 قنوات الاشتراك" || text === "📢 قناة الاشتراك الإجباري")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "📢 قنوات الاشتراك\n\n" +
        (waking
          ? "⏳ المحرك يستيقظ — أعد الضغط بعد دقيقة لإضافة/حذف القنوات."
          : "المحرك غير متصل. بعد عودته استخدم هذا الزر لإدارة القنوات."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && text === "📊 إحصائيات") {
    const db = await mediaDb();
    let premCount = 0;
    let feedCount = 0;
    if (db) {
      const { count: pc } = await db.from("media_premium_users").select("*", { count: "exact", head: true });
      premCount = pc || 0;
      const { count: fc } = await db.from("media_feed").select("*", { count: "exact", head: true });
      feedCount = fc || 0;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        `📊 إحصائيات سريعة (من الموقع)\n\n📁 الموجز: ${feedCount}\n💎 المشتركون: ${premCount}\n\n` +
        (waking
          ? "⏳ المحرك يستيقظ — الإحصائيات الكاملة من البوت بعد ثوانٍ."
          : "للإحصائيات الكاملة من المحرك: تأكد أن Render يعمل ثم أعد الضغط."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (text === "⚙️ إعداداتي") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "⚙️ إعداداتك\n\n" +
        (waking
          ? "⏳ المحرك يستيقظ — أعد الضغط بعد ثوانٍ لتبديل الموجز/الغرفة."
          : "المحرك غير متصل مؤقتاً. يمكنك فتح التطبيق المصغر لتصفح المحتوى:") +
        (waking ? "" : ""),
      reply_markup: waking ? userKeyboard() : miniAppKeyboard(),
    });
    return;
  }

  if (text === "👥 غرفتي") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "👥 الغرف\n\n⏳ المحرك يستيقظ — أعد المحاولة بعد ثوانٍ لإنشاء/الانضمام."
        : "👥 الغرف\n\nالمحرك غير متصل. أعد المحاولة بعد عودته.",
      reply_markup: userKeyboard(),
    });
    return;
  }

  if (URL_RE.test(text)) {
    await enqueue(update);
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "⏳ المحرك يستيقظ...\nتم حفظ الرابط وسيُعرض عليك أزرار الجودة فور جهوزية المحرك (عادة أقل من دقيقة)."
        : "📥 تم حفظ الرابط.\nالمحرك غير متصل الآن — سيُعالج تلقائياً عند عودته. لا ترسل نفس الرابط مرات كثيرة.",
    });
    return;
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: "أرسل رابطاً أو استخدم الأزرار.",
    reply_markup: isOwner ? ownerKeyboard() : userKeyboard(),
  });
}

export async function POST(req: NextRequest) {
  const secret = hookSecret();
  if (!secret || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await req.text();
  let update: any;
  try {
    update = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (update.pre_checkout_query) {
    await handlePreCheckout(update);
    forward(raw, secret).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (update.message?.successful_payment) {
    await handleSuccessfulPayment(update);
    forward(raw, secret).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const outcome = await forward(raw, secret);
  // Real bot handled it — do not send mini-app-only replies.
  if (outcome === "delivered") return NextResponse.json({ ok: true });

  try {
    if (update.callback_query) {
      await handleCallback(update);
    } else if (update.message) {
      await handleMessage(update, outcome);
    }
  } catch (e) {
    console.error("[media-front-door] handler error", e);
  }

  return NextResponse.json({ ok: true });
}
