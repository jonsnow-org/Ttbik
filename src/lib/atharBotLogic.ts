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

type Text = { welcome: string; open: string; mystery: string; auctions: string; mine: string; board: string; today: string; language: string; pick: string; changed: string; help: string; join: string; joined: string; back: string };
const T: Record<Lang, Text> = {
  en: {
    welcome:
      "🕰 Welcome to Athar\nOne token for every day of the calendar (1950–2049): your birthday, your wedding, or a day you love.\n\n" +
      "✨ A living token: its picture flashes, turns and shines, and matures the longer you hold it.\n" +
      "📜 It counts its owners, remembers what is engraved on it, and you can put your own picture on it.\n" +
      "🎁 You can gift it to someone you love.\n\n" +
      "⚙️ How to start\n1️⃣ Tap “Open Athar” and find your date.\n2️⃣ Connect your wallet (Tonkeeper or MyTonWallet) and confirm the payment in Gram.\n3️⃣ The token arrives in your wallet and shows on markets such as Getgems.\n\n" +
      "ℹ️ Tokens are for memory and collecting. No profit or price increase is promised.",
    open: "🕰 Open Athar", mystery: "🎁 Mystery boxes", auctions: "🔨 Auctions", mine: "🖼 My tokens", board: "🗓 Calendar board", today: "📅 Today's token", language: "🌐 Language",
    pick: "Choose your language:", changed: "Language changed.", help: "Tap “Open Athar” to start.",
    join: "📢 Please join our channel first, then tap “✅ I joined”:", joined: "✅ I joined", back: "⬅️ Back",
  },
  ar: {
    welcome:
      "🕰 أهلاً بك في «أثر»\nلكل يوم في التقويم (1950–2049) رمز واحد فقط: يوم ميلادك أو زواجك أو يوم تحبه.\n\n" +
      "✨ رمز حيّ: صورته تومض وتدور وتلمع، وينضج كلما طال بقاؤه عندك.\n" +
      "📜 يعدّ أصحابه ويحفظ ما يُنقش عليه، ويمكنك وضع صورتك عليه.\n" +
      "🎁 ويمكنك إهداؤه لمن تحب.\n\n" +
      "⚙️ كيف تبدأ؟\n1️⃣ اضغط «فتح أثر» وابحث عن تاريخك.\n2️⃣ اربط محفظتك (Tonkeeper أو MyTonWallet) وأكّد الدفع بعملة Gram.\n3️⃣ يصلك الرمز إلى محفظتك ويظهر في الأسواق مثل Getgems.\n\n" +
      "ℹ️ الرموز للذكرى والاقتناء، ولا وعد بأي ربح أو ارتفاع سعر.",
    open: "🕰 فتح أثر", mystery: "🎁 صندوق الغموض", auctions: "🔨 المزادات", mine: "🖼 رموزي", board: "🗓 لوحة التقويم", today: "📅 رمز اليوم", language: "🌐 اللغة",
    pick: "اختر لغتك:", changed: "تم تغيير اللغة.", help: "اضغط «فتح أثر» للبدء.",
    join: "📢 انضم إلى قناتنا أولاً ثم اضغط «✅ انضممت»:", joined: "✅ انضممت", back: "⬅️ رجوع",
  },
  ru: {
    welcome:
      "🕰 Добро пожаловать в Athar\nОдин токен на каждый день календаря (1950–2049): день рождения, свадьба или любимая дата.\n\n" +
      "✨ Живой токен: картинка вспыхивает, вращается и сияет, а со временем «взрослеет».\n" +
      "📜 Он считает владельцев, помнит выгравированное и позволяет добавить своё фото.\n" +
      "🎁 Его можно подарить близкому человеку.\n\n" +
      "⚙️ Как начать\n1️⃣ Нажмите «Открыть Athar» и найдите свою дату.\n2️⃣ Подключите кошелёк (Tonkeeper или MyTonWallet) и подтвердите оплату в Gram.\n3️⃣ Токен придёт в ваш кошелёк и появится на площадках вроде Getgems.\n\n" +
      "ℹ️ Токены — для памяти и коллекции. Прибыль и рост цены не обещаются.",
    open: "🕰 Открыть Athar", mystery: "🎁 Мистери-боксы", auctions: "🔨 Аукционы", mine: "🖼 Мои токены", board: "🗓 Календарная доска", today: "📅 Токен дня", language: "🌐 Язык",
    pick: "Выберите язык:", changed: "Язык изменён.", help: "Нажмите «Открыть Athar», чтобы начать.",
    join: "📢 Сначала подпишитесь на наш канал, затем нажмите «✅ Я подписался»:", joined: "✅ Я подписался", back: "⬅️ Назад",
  },
  tr: {
    welcome:
      "🕰 Athar'a hoş geldin\nTakvimin her günü için tek bir token (1950–2049): doğum günün, düğünün ya da sevdiğin bir gün.\n\n" +
      "✨ Canlı token: resmi parlar, döner, ışıldar ve elinde tuttukça olgunlaşır.\n" +
      "📜 Sahiplerini sayar, üzerine kazılanı hatırlar; kendi resmini ekleyebilirsin.\n" +
      "🎁 Sevdiğin birine hediye edebilirsin.\n\n" +
      "⚙️ Nasıl başlanır\n1️⃣ “Athar'ı aç”a dokun ve tarihini bul.\n2️⃣ Cüzdanını bağla (Tonkeeper veya MyTonWallet) ve ödemeyi Gram ile onayla.\n3️⃣ Token cüzdanına gelir ve Getgems gibi pazarlarda görünür.\n\n" +
      "ℹ️ Tokenlar anı ve koleksiyon içindir. Kâr veya fiyat artışı vaat edilmez.",
    open: "🕰 Athar'ı aç", mystery: "🎁 Gizem kutuları", auctions: "🔨 Müzayedeler", mine: "🖼 Tokenlarım", board: "🗓 Takvim panosu", today: "📅 Günün tokenı", language: "🌐 Dil",
    pick: "Dilini seç:", changed: "Dil değiştirildi.", help: "Başlamak için “Athar'ı aç”a dokun.",
    join: "📢 Önce kanalımıza katıl, sonra “✅ Katıldım”a dokun:", joined: "✅ Katıldım", back: "⬅️ Geri",
  },
  fa: {
    welcome:
      "🕰 به اثر خوش آمدید\nبرای هر روز تقویم (۱۹۵۰–۲۰۴۹) فقط یک توکن: روز تولد، ازدواج یا روزی که دوستش دارید.\n\n" +
      "✨ توکن زنده: تصویرش می‌درخشد، می‌چرخد و هرچه بیشتر نگهش دارید پخته‌تر می‌شود.\n" +
      "📜 مالکانش را می‌شمارد، آنچه حک شده را به یاد دارد و می‌توانید عکس خودتان را روی آن بگذارید.\n" +
      "🎁 می‌توانید آن را به عزیزی هدیه دهید.\n\n" +
      "⚙️ چطور شروع کنیم؟\n۱️⃣ «باز کردن اثر» را بزنید و تاریخ خود را پیدا کنید.\n۲️⃣ کیف‌پول خود را وصل کنید (Tonkeeper یا MyTonWallet) و پرداخت را با Gram تأیید کنید.\n۳️⃣ توکن به کیف‌پولتان می‌آید و در بازارهایی مثل Getgems دیده می‌شود.\n\n" +
      "ℹ️ توکن‌ها برای یادگاری و کلکسیون‌اند. هیچ سود یا افزایش قیمتی وعده داده نمی‌شود.",
    open: "🕰 باز کردن اثر", mystery: "🎁 جعبه‌های اسرار", auctions: "🔨 حراج‌ها", mine: "🖼 توکن‌های من", board: "🗓 تابلوی تقویم", today: "📅 توکن امروز", language: "🌐 زبان",
    pick: "زبان خود را انتخاب کنید:", changed: "زبان تغییر کرد.", help: "برای شروع «باز کردن اثر» را بزنید.",
    join: "📢 ابتدا در کانال ما عضو شوید، سپس «✅ عضو شدم» را بزنید:", joined: "✅ عضو شدم", back: "⬅️ بازگشت",
  },
};

const withLang = (path: string, lang: Lang) => `${ATHAR_URL}${path}${path.includes("?") ? "&" : "?"}lang=${lang}`;

// The owner is the Telegram id fixed when the bot was activated (or the platform owner's id): they get two extra buttons.
const OWNER_FALLBACK = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").split(",")[0].trim();
const isOwner = (botRow: BotRow, tgId: string) => !!tgId && (tgId === String(botRow.ownerId || "") || tgId === OWNER_FALLBACK);
// optional: the secret address of the management panel, shown as a button to the owner only (set ATHAR_ADMIN_URL in Vercel)
const ADMIN_URL = (process.env.ATHAR_ADMIN_URL || "").trim();

// The bot's menu is a button panel under the message box (a reply keyboard, always there), not buttons inside the conversation.
// The sections open the mini app directly; 🌐 changes the language; the owner has two more buttons.
const OWNER_STATS = "📊 Stats", OWNER_CHANNEL = "📢 قناة الاشتراك الإجباري";
function menu(lang: Lang, owner = false): Keyboard {
  const t = T[lang];
  const kb = new Keyboard().webApp(t.open, withLang("", lang)).row()
    .webApp(t.mystery, withLang("/mystery", lang)).webApp(t.auctions, withLang("/auctions", lang)).row()
    .webApp(t.mine, withLang("/mine", lang)).webApp(t.board, withLang("/board", lang)).row()
    .webApp(t.today, withLang("/today", lang)).text(t.language);
  if (owner) {
    kb.row().text(OWNER_STATS).text(OWNER_CHANNEL);
    if (ADMIN_URL) kb.webApp("🛠 Admin", ADMIN_URL);
  }
  return kb.resized().persistent();
}

// mandatory-subscription channel (Bot.requiredChannel, the same field the other bots use): the owner sets it from the panel and people must join it first
const CHANNEL_ASK = "📢 أرسل معرّف القناة أو رابطها (مثل @MyChannel أو https://t.me/MyChannel) ردّاً على هذه الرسالة.\nأرسل «إلغاء» لإيقاف الاشتراك الإجباري.";
const normChannel = (x: string) => x.trim().replace(/^@/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^(t\.me|telegram\.me)\//i, "").replace(/^@/, "").replace(/\/+$/, "").split(/[?#]/)[0];
async function isMember(bot: TelegramBot, channel: string, tgId: string): Promise<boolean> {
  try { const m = await bot.api.getChatMember(`@${normChannel(channel)}`, Number(tgId)); return ["creator", "administrator", "member"].includes(m.status); } catch { return false; }
}

/** What each menu command opens inside the mini app. */
const SECTIONS: { cmd: string; path: string; key: "open" | "mystery" | "auctions" | "mine" | "board"; en: string }[] = [
  { cmd: "open", path: "", key: "open", en: "Open Athar" },
  { cmd: "mystery", path: "/mystery", key: "mystery", en: "Mystery boxes" },
  { cmd: "auctions", path: "/auctions", key: "auctions", en: "Auctions" },
  { cmd: "mine", path: "/mine", key: "mine", en: "My tokens" },
  { cmd: "board", path: "/board", key: "board", en: "Calendar board" },
];
export const COMMANDS = [{ command: "start", description: "Start" }, ...SECTIONS.map((x) => ({ command: x.cmd, description: x.en })), { command: "language", description: "Language" }];

let commandsSet = false;
/** The commands list (once per server start, in English for everyone) and this person's menu button, in their language. */
async function ensureMenu(bot: TelegramBot, chatId: number, lang: Lang, owner = false): Promise<void> {
  try {
    if (!commandsSet) { await bot.api.setMyCommands(COMMANDS); commandsSet = true; }
  } catch { /* the list is optional */ }
  try {
    await bot.api.setChatMenuButton({ chat_id: chatId, menu_button: owner && ADMIN_URL ? { type: "web_app", text: "🛠 Admin", web_app: { url: ADMIN_URL } } : { type: "web_app", text: "Athar", web_app: { url: withLang("", lang) } } });   // the owner's blue button opens the panel, everyone else's opens the app
  } catch { /* optional on some clients */ }
}

function languageKeyboard(lang: Lang): Keyboard {
  const kb = new Keyboard();
  LANGS.forEach((l, i) => { kb.text(l.name); if (i % 2 === 1) kb.row(); });
  kb.row().text(T[lang].back);
  return kb.resized().oneTime();
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
  // buttons of older messages (inline) still work
  const cb = body.callback_query;
  if (cb?.id) {
    const from = String(cb.from?.id || ""), chatId = cb.message?.chat?.id, data = String(cb.data || "");
    await bot.api.answerCallbackQuery(cb.id).catch(() => null);
    if (!chatId || !from) return;
    if (data === "al:menu") {
      const cur = await getLang(botRow.id, from);
      await bot.api.sendMessage(chatId, T[cur].pick, { reply_markup: languageKeyboard(cur) });
    } else if (data.startsWith("al:") && isLang(data.slice(3))) {
      const lang = data.slice(3) as Lang;
      await setLang(botRow.id, from, lang);
      await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, isOwner(botRow, from)) });
      await ensureMenu(bot, chatId, lang, isOwner(botRow, from));
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
  const owner = isOwner(botRow, fromId);

  // the owner sets (or stops) the mandatory channel: the answer to our question
  if (owner && msg.reply_to_message?.text === CHANNEL_ASK) {
    const channel = /^(إلغاء|cancel)$/i.test(text) ? null : normChannel(text);
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: channel } });
    if (!channel) { await bot.api.sendMessage(chatId, "✅ تم إيقاف الاشتراك الإجباري.", { reply_markup: menu(lang, true) }); return; }
    const found = await bot.api.getChat(`@${channel}`).catch(() => null);
    let warning = "";
    if (!found) warning = "\n⚠️ لم أجد هذه القناة، تأكد من المعرّف.";
    else if (!(await bot.api.getChatMember(`@${channel}`, Number(fromId)).catch(() => null))) warning = "\n⚠️ أضف البوت إلى القناة كمشرف (Admin) وإلا لن يستطيع التحقق من المشتركين.";
    await bot.api.sendMessage(chatId, `✅ فُعّل الاشتراك الإجباري في @${channel}.${warning}`, { reply_markup: menu(lang, true) });
    return;
  }
  if (owner && text === OWNER_CHANNEL) {
    await bot.api.sendMessage(chatId, CHANNEL_ASK, { reply_markup: { force_reply: true, input_field_placeholder: "@MyChannel" } });
    return;
  }
  // people who are not the owner must have joined the channel (when one is set)
  if (!owner && botRow.requiredChannel && !(await isMember(bot, botRow.requiredChannel, fromId))) {
    await bot.api.sendMessage(chatId, `${T[lang].join}\nhttps://t.me/${normChannel(botRow.requiredChannel)}`, { reply_markup: new Keyboard().text(T[lang].joined).resized().persistent() });
    return;
  }

  // the language panel: a name from the list changes the language, ⬅️ goes back
  const chosen = LANGS.find((l) => l.name === text);
  if (chosen) {
    await setLang(botRow.id, fromId, chosen.code);
    await bot.api.sendMessage(chatId, T[chosen.code].welcome, { reply_markup: menu(chosen.code, owner) });
    await ensureMenu(bot, chatId, chosen.code, owner);
    return;
  }
  if (LANGS.some((l) => T[l.code].language === text)) {
    await bot.api.sendMessage(chatId, T[lang].pick, { reply_markup: languageKeyboard(lang) });
    return;
  }
  if (text === T[lang].back || text === T[lang].joined) {
    await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, owner) });
    return;
  }
  if (owner && text === OWNER_STATS) {
    await bot.api.sendMessage(chatId, await statsText(botRow.id), { reply_markup: menu(lang, true) });
    return;
  }

  const cmd = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : text === "🕰 Athar" ? "open" : "";
  if (cmd === "start") {
    await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, owner) });
    await ensureMenu(bot, chatId, lang, owner);
    return;
  }
  if (cmd === "language") {
    await bot.api.sendMessage(chatId, T[lang].pick, { reply_markup: languageKeyboard(lang) });
    return;
  }
  if (cmd === "stats" && owner) {
    await bot.api.sendMessage(chatId, await statsText(botRow.id));
    return;
  }
  const section = SECTIONS.find((x) => x.cmd === cmd);
  if (section) {
    await bot.api.sendMessage(chatId, T[lang][section.key], { reply_markup: new InlineKeyboard().webApp(T[lang][section.key], withLang(section.path, lang)) });
    return;
  }
  await bot.api.sendMessage(chatId, T[lang].help, { reply_markup: menu(lang, owner) });
}
