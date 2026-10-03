import { NextRequest, NextResponse } from "next/server";
import { mediaDb, MEDIA_OWNER_ID, isMediaPremium } from "@/lib/mediaSocial";
import {
  getRenderUrl,
  hookPath,
  hookSecret,
  miniAppKeyboard,
  safeEqual,
  tg,
} from "@/lib/mediaFrontDoor";
import { startGuide } from "@/lib/botStartGuide";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORWARD_TIMEOUT_MS = 55_000;
const URL_RE = /https?:\/\/\S+/i;

const PREMIUM_DAILY_LIMIT = 50;
const FREE_DAILY_LIMIT = 8;
const PREMIUM_STARS_PRICE = 500;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

const INFO_TEXT =
  "طريقة الاستخدام\n\n" +
  "1) ارسل رابط يوتيوب / تيك توك / انستغرام / تويتر.\n" +
  "2) اختر الجودة او الصوت او الرسالة الصوتية.\n" +
  "3) على يوتيوب: زر ملخص ذكي يعرض 3 نقاط من الترجمة قبل التحميل.\n" +
  "4) الملف يحفظ في الارشيف ويمكن استنساخه فورا من التطبيق المصغر.\n\n" +
  "التطبيق المصغر: الزر المربع بجانب حقل الرسالة (يعمل دائما على الموقع).\n" +
  "الاوامر الكاملة للتحميل تعمل عبر محرك Render - ان تاخر الرد انتظر دقيقة بعد اول رسالة.";

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
  return {
    inline_keyboard: [[{ text: "⭐ ادفع بنجوم تيليجرام", callback_data: "premium_stars_buy" }]],
  };
}

type Outcome = "delivered" | "timeout" | "down";

async function forward(raw: string, secret: string): Promise<Outcome> {
  const base = await getRenderUrl().catch(() => "");
  if (!base) return "down";
  try {
    const r = await fetch(base + hookPath(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: raw,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (r.status === 503) return "timeout";
    return r.ok ? "delivered" : "down";
  } catch (e) {
    const name = (e as Error)?.name || "";
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : "down";
  }
}

async function enqueue(update: any): Promise<boolean> {
  const db = await mediaDb();
  if (!db || typeof update?.update_id !== "number") return false;
  const { error } = await db.from("media_bot_queue").upsert({
    update_id: update.update_id,
    payload: update,
  });
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
  let res;
  if (type === "audio") {
    res = await tg("sendAudio", { chat_id: chatId, audio: item.file_id, title });
  } else if (type === "voice") {
    res = await tg("sendVoice", { chat_id: chatId, voice: item.file_id });
  } else {
    res = await tg("sendVideo", { chat_id: chatId, video: item.file_id, supports_streaming: true });
  }
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
    return (
      "الترقية المدفوعة مفعلة على حسابك.\n" +
      "حدك اليومي الحالي: " +
      PREMIUM_DAILY_LIMIT +
      " تحميل."
    );
  }
  return (
    "الترقية المدفوعة\n\n" +
    "• حد يومي اعلى (" +
    PREMIUM_DAILY_LIMIT +
    " تحميل بدل " +
    FREE_DAILY_LIMIT +
    ")\n" +
    "• اولوية اعلى في المعالجة\n\n" +
    "ادفع مباشرة بنجوم تيليجرام (" +
    PREMIUM_STARS_PRICE +
    " نجمة) من الزر ادناه - تفعيل فوري.\n\n" +
    "او:\n" +
    "1) اطلب الخدمة من: " +
    SITE_URL +
    "/service/media-bot-premium\n" +
    "2) بعد موافقة الادارة ارسل: /premium ثم رمز طلبك"
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
    text:
      "تم الدفع بنجاح! الترقية مفعلة الآن.\nحدك اليومي: " + PREMIUM_DAILY_LIMIT + " تحميل.",
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
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: cbq.message.message_id,
      text: "تم.",
    });
    return;
  }

  if (data === "premium_stars_buy" && chatId) {
    const isPrem = await isMediaPremium(userId);
    if (isPrem) {
      await tg("answerCallbackQuery", {
        callback_query_id: cbq.id,
        text: "الترقية مفعلة بالفعل.",
        show_alert: true,
      });
      return;
    }
    await tg("answerCallbackQuery", { callback_query_id: cbq.id });
    await tg("sendInvoice", {
      chat_id: chatId,
      title: "ترقية بوت الوسائط",
      description:
        "رفع حدك اليومي الى " + PREMIUM_DAILY_LIMIT + " تحميل واولوية اعلى في المعالجة.",
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
      text: "تم التحقق. ارسل الرابط الآن.",
    });
    return;
  }

  await tg("answerCallbackQuery", {
    callback_query_id: cbq.id,
    text: "المحرك يستيقظ - اعد المحاولة بعد ثوان",
    show_alert: false,
  });
}

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
        text: "انتهت صلاحية هذا الملف او غير موجود.",
        reply_markup: miniAppKeyboard(),
      });
    }
    return;
  }

  if (text.startsWith("/start msg_")) return;

  if (text === "/start" || text.startsWith("/start ")) {
    const wakeNote = waking ? "\n\nالمحرك يستيقظ - ارسل الرابط بعد بضع ثوان." : "";
    if (isOwner) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "👑 لوحة مالك البوت\n\n" + startGuide("MEDIA") + wakeNote,
        reply_markup: ownerKeyboard(),
      });
    } else {
      await tg("sendMessage", {
        chat_id: chatId,
        text: startGuide("MEDIA") + wakeNote,
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
        text: "الترقية مفعلة بالفعل.\nحدك اليومي: " + PREMIUM_DAILY_LIMIT + " تحميل.",
      });
    } else {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "استخدم: /premium ثم رمز طلبك\nاو ادفع بنجوم تيليجرام من زر الترقية.",
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
        ? "المحرك يستيقظ... ارسل الرابط خلال دقيقة وساعرض خيارات الجودة."
        : "ارسل الرابط مباشرة وسأعرض الخيارات.",
    });
    return;
  }

  if (text === "💎 الترقية المدفوعة" || text === "💎 الميزات المدفوعة") {
    if (text === "💎 الميزات المدفوعة" && isOwner) {
      const db = await mediaDb();
      let count = 0;
      if (db) {
        const { count: c } = await db
          .from("media_premium_users")
          .select("*", { count: "exact", head: true });
        count = c || 0;
      }
      await tg("sendMessage", {
        chat_id: chatId,
        text: "عدد المشتركين في الترقية المدفوعة: " + count,
      });
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

  if (isOwner && text === "⚙️ إعدادات البوت") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "اعدادات البوت\n\n" +
        (waking
          ? "المحرك يستيقظ الآن. اعد الضغط بعد 30-60 ثانية لاعدادات الارشيف والاشتراك الكاملة.\n\n"
          : "المحرك غير متصل مؤقتا. تاكد ان خدمة media-bot على Render تعمل، ثم اعد /start.\n\n") +
        "يمكنك ارسال رابط للتحميل مباشرة عند عودة المحرك.",
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && text === "👥 إدارة المستخدمين") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "ادارة المستخدمين\n\n" +
        (waking
          ? "المحرك يستيقظ - اعد المحاولة بعد ثوان للاحصائيات الحية."
          : "المحرك غير متصل. شغل خدمة Render ثم اعد المحاولة."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && (text === "📢 قنوات الاشتراك" || text === "📢 قناة الاشتراك الإجباري")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "قنوات الاشتراك\n\n" +
        (waking
          ? "المحرك يستيقظ - اعد الضغط بعد دقيقة لاضافة/حذف القنوات."
          : "المحرك غير متصل. بعد عودته استخدم هذا الزر لادارة القنوات."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (isOwner && text === "📊 إحصائيات") {
    const db = await mediaDb();
    let premCount = 0;
    let feedCount = 0;
    if (db) {
      const { count: pc } = await db
        .from("media_premium_users")
        .select("*", { count: "exact", head: true });
      premCount = pc || 0;
      const { count: fc } = await db.from("media_feed").select("*", { count: "exact", head: true });
      feedCount = fc || 0;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "احصائيات سريعة (من الموقع)\n\nالموجز: " +
        feedCount +
        "\nالمشتركون: " +
        premCount +
        "\n\n" +
        (waking
          ? "المحرك يستيقظ - الاحصائيات الكاملة من البوت بعد ثوان."
          : "للاحصائيات الكاملة من المحرك: تاكد ان Render يعمل ثم اعد الضغط."),
      reply_markup: ownerKeyboard(),
    });
    return;
  }

  if (text === "⚙️ إعداداتي") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "اعداداتك\n\nالمحرك يستيقظ - اعد الضغط بعد ثوان لتبديل الموجز/الغرفة."
        : "اعداداتك\n\nالمحرك غير متصل مؤقتا. يمكنك فتح التطبيق المصغر لتصفح المحتوى.",
      reply_markup: waking ? userKeyboard() : miniAppKeyboard(),
    });
    return;
  }

  if (text === "👥 غرفتي") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "الغرف\n\nالمحرك يستيقظ - اعد المحاولة بعد ثوان لانشاء/الانضمام."
        : "الغرف\n\nالمحرك غير متصل. اعد المحاولة بعد عودته.",
      reply_markup: userKeyboard(),
    });
    return;
  }

  if (URL_RE.test(text)) {
    await enqueue(update);
    await tg("sendMessage", {
      chat_id: chatId,
      text: waking
        ? "المحرك يستيقظ...\nتم حفظ الرابط وسيعرض عليك ازرار الجودة فور جهوزية المحرك (عادة اقل من دقيقة)."
        : "تم حفظ الرابط.\nالمحرك غير متصل الآن - سيعالج تلقائيا عند عودته. لا ترسل نفس الرابط مرات كثيرة.",
    });
    return;
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: "ارسل رابطا او استخدم الازرار.",
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
