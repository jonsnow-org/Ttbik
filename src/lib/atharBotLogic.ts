import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordBotVisit } from "@/lib/botVisit";

/**
 * ATHAR_BOT: a token for every day of the calendar on the TON network.
 * The bot holds no logic: it opens the mini app (served from our own server) and everything else happens inside it and on the chain.
 * Everyone meets the bot in ENGLISH first; the 🌐 button switches between five languages and the choice is remembered.
 */
export const ATHAR_URL = (process.env.NEXT_PUBLIC_ATHAR_URL || "https://athar.89-168-89-15.sslip.io").replace(/\/$/, "");

export const LANGS = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "fa", name: "فارسی" },
] as const;
type Lang = (typeof LANGS)[number]["code"];
const isLang = (x: string): x is Lang => LANGS.some((l) => l.code === x);

type Text = { welcome: string; open: string; mystery: string; auctions: string; mine: string; board: string; language: string; pick: string; changed: string; help: string };
const T: Record<Lang, Text> = {
  en: {
    welcome:
      "🕰 Welcome to Athar\nOne token for every day of the calendar (1950–2049): your birthday, your wedding, or a day you love.\n\n" +
      "✨ A living token: its picture flashes, turns and shines, and matures the longer you hold it.\n" +
      "📜 It counts its owners, remembers what is engraved on it, and you can put your own picture on it.\n" +
      "🎁 You can gift it to someone you love.\n\n" +
      "⚙️ How to start\n1️⃣ Tap “Open Athar” and find your date.\n2️⃣ Connect your wallet (Tonkeeper or MyTonWallet) and confirm the payment in Gram.\n3️⃣ The token arrives in your wallet and shows on markets such as Getgems.\n\n" +
      "ℹ️ Tokens are for memory and collecting. No profit or price increase is promised.",
    open: "🕰 Open Athar", mystery: "🎁 Mystery boxes", auctions: "🔨 Auctions", mine: "🖼 My tokens", board: "🗓 Calendar board", language: "🌐 Language",
    pick: "Choose your language:", changed: "Language changed.", help: "Tap “Open Athar” to start.",
  },
  ar: {
    welcome:
      "🕰 أهلاً بك في «أثر»\nلكل يوم في التقويم (1950–2049) رمز واحد فقط: يوم ميلادك أو زواجك أو يوم تحبه.\n\n" +
      "✨ رمز حيّ: صورته تومض وتدور وتلمع، وينضج كلما طال بقاؤه عندك.\n" +
      "📜 يعدّ أصحابه ويحفظ ما يُنقش عليه، ويمكنك وضع صورتك عليه.\n" +
      "🎁 ويمكنك إهداؤه لمن تحب.\n\n" +
      "⚙️ كيف تبدأ؟\n1️⃣ اضغط «فتح أثر» وابحث عن تاريخك.\n2️⃣ اربط محفظتك (Tonkeeper أو MyTonWallet) وأكّد الدفع بعملة Gram.\n3️⃣ يصلك الرمز إلى محفظتك ويظهر في الأسواق مثل Getgems.\n\n" +
      "ℹ️ الرموز للذكرى والاقتناء، ولا وعد بأي ربح أو ارتفاع سعر.",
    open: "🕰 فتح أثر", mystery: "🎁 صندوق الغموض", auctions: "🔨 المزادات", mine: "🖼 رموزي", board: "🗓 لوحة التقويم", language: "🌐 اللغة",
    pick: "اختر لغتك:", changed: "تم تغيير اللغة.", help: "اضغط «فتح أثر» للبدء.",
  },
  ru: {
    welcome:
      "🕰 Добро пожаловать в Athar\nОдин токен на каждый день календаря (1950–2049): день рождения, свадьба или любимая дата.\n\n" +
      "✨ Живой токен: картинка вспыхивает, вращается и сияет, а со временем «взрослеет».\n" +
      "📜 Он считает владельцев, помнит выгравированное и позволяет добавить своё фото.\n" +
      "🎁 Его можно подарить близкому человеку.\n\n" +
      "⚙️ Как начать\n1️⃣ Нажмите «Открыть Athar» и найдите свою дату.\n2️⃣ Подключите кошелёк (Tonkeeper или MyTonWallet) и подтвердите оплату в Gram.\n3️⃣ Токен придёт в ваш кошелёк и появится на площадках вроде Getgems.\n\n" +
      "ℹ️ Токены — для памяти и коллекции. Прибыль и рост цены не обещаются.",
    open: "🕰 Открыть Athar", mystery: "🎁 Мистери-боксы", auctions: "🔨 Аукционы", mine: "🖼 Мои токены", board: "🗓 Календарная доска", language: "🌐 Язык",
    pick: "Выберите язык:", changed: "Язык изменён.", help: "Нажмите «Открыть Athar», чтобы начать.",
  },
  tr: {
    welcome:
      "🕰 Athar'a hoş geldin\nTakvimin her günü için tek bir token (1950–2049): doğum günün, düğünün ya da sevdiğin bir gün.\n\n" +
      "✨ Canlı token: resmi parlar, döner, ışıldar ve elinde tuttukça olgunlaşır.\n" +
      "📜 Sahiplerini sayar, üzerine kazılanı hatırlar; kendi resmini ekleyebilirsin.\n" +
      "🎁 Sevdiğin birine hediye edebilirsin.\n\n" +
      "⚙️ Nasıl başlanır\n1️⃣ “Athar'ı aç”a dokun ve tarihini bul.\n2️⃣ Cüzdanını bağla (Tonkeeper veya MyTonWallet) ve ödemeyi Gram ile onayla.\n3️⃣ Token cüzdanına gelir ve Getgems gibi pazarlarda görünür.\n\n" +
      "ℹ️ Tokenlar anı ve koleksiyon içindir. Kâr veya fiyat artışı vaat edilmez.",
    open: "🕰 Athar'ı aç", mystery: "🎁 Gizem kutuları", auctions: "🔨 Müzayedeler", mine: "🖼 Tokenlarım", board: "🗓 Takvim panosu", language: "🌐 Dil",
    pick: "Dilini seç:", changed: "Dil değiştirildi.", help: "Başlamak için “Athar'ı aç”a dokun.",
  },
  fa: {
    welcome:
      "🕰 به اثر خوش آمدید\nبرای هر روز تقویم (۱۹۵۰–۲۰۴۹) فقط یک توکن: روز تولد، ازدواج یا روزی که دوستش دارید.\n\n" +
      "✨ توکن زنده: تصویرش می‌درخشد، می‌چرخد و هرچه بیشتر نگهش دارید پخته‌تر می‌شود.\n" +
      "📜 مالکانش را می‌شمارد، آنچه حک شده را به یاد دارد و می‌توانید عکس خودتان را روی آن بگذارید.\n" +
      "🎁 می‌توانید آن را به عزیزی هدیه دهید.\n\n" +
      "⚙️ چطور شروع کنیم؟\n۱️⃣ «باز کردن اثر» را بزنید و تاریخ خود را پیدا کنید.\n۲️⃣ کیف‌پول خود را وصل کنید (Tonkeeper یا MyTonWallet) و پرداخت را با Gram تأیید کنید.\n۳️⃣ توکن به کیف‌پولتان می‌آید و در بازارهایی مثل Getgems دیده می‌شود.\n\n" +
      "ℹ️ توکن‌ها برای یادگاری و کلکسیون‌اند. هیچ سود یا افزایش قیمتی وعده داده نمی‌شود.",
    open: "🕰 باز کردن اثر", mystery: "🎁 جعبه‌های اسرار", auctions: "🔨 حراج‌ها", mine: "🖼 توکن‌های من", board: "🗓 تابلوی تقویم", language: "🌐 زبان",
    pick: "زبان خود را انتخاب کنید:", changed: "زبان تغییر کرد.", help: "برای شروع «باز کردن اثر» را بزنید.",
  },
};

const withLang = (path: string, lang: Lang) => `${ATHAR_URL}${path}${path.includes("?") ? "&" : "?"}lang=${lang}`;

// The owner is the Telegram id fixed when the bot was activated (or the platform owner's id): they get two extra buttons.
const OWNER_FALLBACK = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").split(",")[0].trim();
const isOwner = (botRow: BotRow, tgId: string) => !!tgId && (tgId === String(botRow.ownerId || "") || tgId === OWNER_FALLBACK);
// optional: the secret address of the management panel, shown as a button to the owner only (set ATHAR_ADMIN_URL in Vercel)
const ADMIN_URL = (process.env.ATHAR_ADMIN_URL || "").trim();

function menu(lang: Lang, owner = false): InlineKeyboard {
  const t = T[lang];
  const kb = menuBase(lang, t);
  if (owner) {
    kb.row().text("📊 Stats", "ao:stats");
    if (ADMIN_URL) kb.webApp("🛠 Admin", ADMIN_URL);
  }
  return kb;
}

function menuBase(lang: Lang, t: Text): InlineKeyboard {
  return new InlineKeyboard()
    .webApp(t.open, withLang("", lang))
    .row()
    .webApp(t.mystery, withLang("/mystery", lang))
    .webApp(t.auctions, withLang("/auctions", lang))
    .row()
    .webApp(t.mine, withLang("/mine", lang))
    .webApp(t.board, withLang("/board", lang))
    .row()
    .text(t.language, "al:menu");
}

function languageKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  LANGS.forEach((l, i) => { kb.text(l.name, `al:${l.code}`); if (i % 2 === 1) kb.row(); });
  return kb;
}

async function getLang(botId: string, tgUserId: string): Promise<Lang> {
  try {
    const row = await prisma.atharBotUser.findUnique({ where: { botId_tgUserId: { botId, tgUserId } } });
    if (row && isLang(row.lang)) return row.lang;
  } catch { /* table not there yet or database busy: English */ }
  return "en";
}
async function setLang(botId: string, tgUserId: string, lang: Lang): Promise<void> {
  try {
    await prisma.atharBotUser.upsert({ where: { botId_tgUserId: { botId, tgUserId } }, update: { lang }, create: { botId, tgUserId, lang } });
  } catch { /* the choice still applies to this message */ }
}

/** What the owner sees under «📊 Stats»: how many people started the bot and in which languages. */
async function statsText(botId: string): Promise<string> {
  try {
    const total = await prisma.botVisit.count({ where: { botId } });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const today = await prisma.botVisit.count({ where: { botId, firstSeenAt: { gte: since } } });
    const langs = await prisma.atharBotUser.groupBy({ by: ["lang"], where: { botId }, _count: { lang: true } });
    const parts = langs.map((l) => `${l.lang}: ${l._count.lang}`).join(" · ") || "—";
    return `📊 Athar bot\nStarted: ${total}\nNew in 24h: ${today}\nChosen languages: ${parts}\n(people who never pressed 🌐 are in English)`;
  } catch { return "📊 Stats are not available right now."; }
}

export async function handleAtharBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  // 🌐 language button and the language list
  const cb = body.callback_query;
  if (cb?.id) {
    const from = String(cb.from?.id || ""), chatId = cb.message?.chat?.id, data = String(cb.data || "");
    await bot.api.answerCallbackQuery(cb.id).catch(() => null);
    if (!chatId || !from) return;
    if (data === "al:menu") {
      const cur = await getLang(botRow.id, from);
      await bot.api.sendMessage(chatId, T[cur].pick, { reply_markup: languageKeyboard() });
    } else if (data.startsWith("al:") && isLang(data.slice(3))) {
      const lang = data.slice(3) as Lang;
      await setLang(botRow.id, from, lang);
      await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, isOwner(botRow, from)) });
    } else if (data === "ao:stats" && isOwner(botRow, from)) {
      await bot.api.sendMessage(chatId, await statsText(botRow.id));
    }
    return;
  }
  const msg = body.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();
  const fromId = String(msg.from?.id || "");
  if (fromId) {
    try { await recordBotVisit(botRow.id, fromId); } catch { /* visit counting is optional */ }
  }
  const lang = fromId ? await getLang(botRow.id, fromId) : "en";
  if (text.startsWith("/start") || text === "🕰 Athar") {
    await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, isOwner(botRow, fromId)) });
    await bot.api.sendMessage(chatId, "🕰", { reply_markup: new Keyboard().text("🕰 Athar").resized().persistent() }).catch(() => null);
    return;
  }
  if (text.startsWith("/language")) {
    await bot.api.sendMessage(chatId, T[lang].pick, { reply_markup: languageKeyboard() });
    return;
  }
  await bot.api.sendMessage(chatId, T[lang].help, { reply_markup: menu(lang, isOwner(botRow, fromId)) });
}
