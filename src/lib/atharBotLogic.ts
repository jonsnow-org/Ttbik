import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordBotVisit } from "@/lib/botVisit";
import { BD, BD_OFF, bdText, parseBirthday, saveBirthday } from "@/lib/atharBirthday";
import { checkPayments, dayKey, daySummary, fetchBalance, fetchIncoming, loadWatch, setAlerts, tons, txLink, walletLink, weekSummary } from "@/lib/atharWatch";

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

type Text = { welcome: string; open: string; mystery: string; auctions: string; mine: string; board: string; today: string; language: string; pick: string; changed: string; help: string; join: string; joined: string; back: string; share: string; shareText: string; shareMsg: string };
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
    share: "👥 Share Athar", shareText: "A living token for every day of the calendar: find your birthday on TON 🕰", shareMsg: "Tap to share Athar with your friends:",
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
    share: "👥 شارك أثر", shareText: "رمز حيّ لكل يوم في التقويم: اعثر على يوم ميلادك على TON 🕰", shareMsg: "اضغط لمشاركة أثر مع أصدقائك:",
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
    share: "👥 Поделиться Athar", shareText: "Живой токен на каждый день календаря: найдите свой день рождения в TON 🕰", shareMsg: "Нажмите, чтобы поделиться Athar с друзьями:",
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
    share: "👥 Athar'ı paylaş", shareText: "Takvimin her günü için canlı bir token: doğum gününü TON'da bul 🕰", shareMsg: "Athar'ı arkadaşlarınla paylaşmak için dokun:",
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
    share: "👥 اشتراک‌گذاری اثر", shareText: "توکنی زنده برای هر روز تقویم: روز تولدتان را در TON پیدا کنید 🕰", shareMsg: "برای اشتراک‌گذاری اثر با دوستانتان بزنید:",
  },
};

const ATHAR_BOT_FALLBACK = (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();
const withLang = (path: string, lang: Lang) => `${ATHAR_URL}${path}${path.includes("?") ? "&" : "?"}lang=${lang}`;

// The owner is the Telegram id fixed when the bot was activated (or the platform owner's id): they get two extra buttons.
const OWNER_FALLBACK = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").split(",")[0].trim();
const isOwner = (botRow: BotRow, tgId: string) => !!tgId && (tgId === String(botRow.ownerId || "") || tgId === OWNER_FALLBACK);
// optional: the secret address of the management panel, shown as a button to the owner only (set ATHAR_ADMIN_URL in Vercel)
const ADMIN_URL = (process.env.ATHAR_ADMIN_URL || "").trim();

// The bot's menu is a button panel under the message box (a reply keyboard, always there), not buttons inside the conversation.
// The sections open the mini app directly; 🌐 changes the language; the owner has two more buttons.
const OWNER_STATS = "📊 Stats", OWNER_CHANNEL = "📢 قناة الاشتراك الإجباري";
const OWNER_BALANCE = "💰 الرصيد", OWNER_PAYMENTS = "📈 آخر الدفعات", OWNER_ALERTS = "🔔 التنبيهات", OWNER_CHECK = "🔄 افحص الآن";
const OWNER_USERVIEW = "👁 شكل المستخدم", OWNER_BACK = "🛠 لوحة الأدمن";

/** The owner's own panel: nothing like the public one (balance, payments, alerts, stats, channel, preview). */
function adminMenu(): Keyboard {
  const kb = new Keyboard()
    .text(OWNER_BALANCE).text(OWNER_PAYMENTS).row()
    .text(OWNER_STATS).text(OWNER_ALERTS).row()
    .text(OWNER_CHECK).text(OWNER_CHANNEL).row();
  if (ADMIN_URL) kb.webApp("🛠 Admin", ADMIN_URL).row();
  return kb.text(OWNER_USERVIEW).resized(); // not persistent: the phone's Back button collapses it, the keyboard icon opens it again
}

function menu(lang: Lang, owner = false, preview = false): Keyboard {
  if (owner && !preview) return adminMenu();
  const t = T[lang];
  // One button per different thing: the mini app (its sections - mystery boxes, auctions, calendar board - are inside it and keep their /commands),
  // today's token, my tokens, share the bot, the birthday reminder and the language.
  const kb = new Keyboard().webApp(t.open, withLang("", lang)).row()
    .webApp(t.today, withLang("/today", lang)).webApp(t.mine, withLang("/mine", lang)).row()
    .text(t.share).text(BD[lang].button).row()
    .text(t.language);
  if (owner) kb.row().text(OWNER_BACK);
  return kb.resized(); // not persistent: the phone's Back button collapses it, the keyboard icon opens it again
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
export const COMMANDS = [{ command: "start", description: "Start" }, ...SECTIONS.map((x) => ({ command: x.cmd, description: x.en })), { command: "share", description: "Share Athar" }, { command: "birthday", description: "Birthday reminder" }, { command: "language", description: "Language" }];

// What Telegram shows on the bot's page before the first message, in search results and next to a shared link (short: up to 120 characters, long: up to 512).
const ABOUT: Record<Lang, { short: string; long: string }> = {
  en: { short: "A living token for every day of the calendar. Find your birthday on TON.", long: "Athar: one token for every day of the calendar (1950–2049). Your birthday, your wedding, a day you love. A living token whose picture moves and matures the longer you hold it. Normal, Silver and Gold for everyone, rarer classes by auction. Tap Start." },
  ar: { short: "رمز حيّ لكل يوم في التقويم. اعثر على يوم ميلادك على TON.", long: "أثر: رمز واحد لكل يوم في التقويم (1950–2049): يوم ميلادك أو زواجك أو يوم تحبه. رمز حيّ صورته تتحرك وتنضج كلما طال بقاؤه عندك. عادي وفضي وذهبي للجميع، وفئات نادرة بالمزاد. اضغط ابدأ." },
  ru: { short: "Живой токен на каждый день календаря. Найдите свой день рождения в TON.", long: "Athar: один токен на каждый день календаря (1950–2049): день рождения, свадьба, любимая дата. Живой токен: картинка движется и взрослеет, пока вы его храните. Обычный, Серебряный и Золотой для всех, редкие классы на аукционе. Нажмите Start." },
  tr: { short: "Takvimin her günü için canlı bir token. Doğum gününü TON'da bul.", long: "Athar: takvimin her günü (1950–2049) için tek bir token: doğum günün, düğünün ya da sevdiğin bir gün. Resmi hareket eden, elinde tuttukça olgunlaşan canlı token. Herkese Normal, Gümüş ve Altın, nadir sınıflar müzayedeyle. Başlat'a dokun." },
  fa: { short: "توکنی زنده برای هر روز تقویم. روز تولدتان را در TON پیدا کنید.", long: "اثر: یک توکن برای هر روز تقویم (۱۹۵۰–۲۰۴۹): تولد، عروسی یا روزی که دوست دارید. توکنی زنده که تصویرش حرکت می‌کند و با نگه‌داشتن بالغ می‌شود. عادی، نقره‌ای و طلایی برای همه و ردهٔ کمیاب با حراج. Start را بزنید." },
};
let commandsSet = false, aboutSet = false;
/** The commands list (once per server start, in English for everyone) and this person's menu button, in their language. */
async function ensureMenu(bot: TelegramBot, chatId: number, lang: Lang, owner = false): Promise<void> {
  try {
    if (!commandsSet) { await bot.api.setMyCommands(COMMANDS); commandsSet = true; }
  } catch { /* the list is optional */ }
  try {
    if (!aboutSet) {
      aboutSet = true;
      await bot.api.setMyShortDescription(ABOUT.en.short); await bot.api.setMyDescription(ABOUT.en.long);   // English for everyone without a language of their own
      for (const l of LANGS) { if (l.code === "en") continue; await bot.api.setMyShortDescription(ABOUT[l.code].short, { language_code: l.code }); await bot.api.setMyDescription(ABOUT[l.code].long, { language_code: l.code }); }
    }
  } catch { /* the bot page text is optional */ }
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

/** What the owner sees under «📊 Stats»: people who started the bot (never counting the owner), growth, languages. Each part fails on its own. */
async function statsText(botRow: BotRow): Promise<string> {
  const botId = botRow.id;
  const owner = String(botRow.ownerId || OWNER_FALLBACK);
  const lines = ["📊 إحصائيات بوت أثر"];
  try {
    const where = (since?: Date) => ({ botId, tgUserId: { notIn: [owner, OWNER_FALLBACK] }, ...(since ? { firstSeenAt: { gte: since } } : {}) });
    const ago = (h: number) => new Date(Date.now() - h * 3600 * 1000);
    const [total, d1, d7, d30] = await Promise.all([
      prisma.botVisit.count({ where: where() }),
      prisma.botVisit.count({ where: where(ago(24)) }),
      prisma.botVisit.count({ where: where(ago(24 * 7)) }),
      prisma.botVisit.count({ where: where(ago(24 * 30)) }),
    ]);
    lines.push(`👥 كل من بدأ البوت: ${total}`, `🆕 آخر 24 ساعة: ${d1}`, `📅 آخر 7 أيام: ${d7}`, `🗓 آخر 30 يوماً: ${d30}`);
  } catch {
    lines.push("👥 تعذّر قراءة عدد المستخدمين الآن.");
  }
  try {
    const langs = await prisma.atharBotUser.groupBy({ by: ["lang"], where: { botId }, _count: { lang: true } });
    if (langs.length) lines.push(`🌐 اللغات المختارة: ${langs.map((l) => `${l.lang} ${l._count.lang}`).join(" · ")}`, "(من لم يضغط 🌐 يُحسب إنجليزياً)");
  } catch {
    /* the language table is optional */
  }
  try {
    const w = await loadWatch();
    const today = daySummary(w, dayKey(Date.now()));
    const week = weekSummary(w);
    if (w.baselineAt) lines.push(`💰 دفعات اليوم: ${today.n} (${tons(today.nano)} TON)`, `💰 آخر 7 أيام: ${week.n} (${tons(week.nano)} TON)`);
    else lines.push("💰 مراقبة الدفعات لم تبدأ بعد: اضغط «🔄 افحص الآن».");
  } catch {
    /* payment totals are optional */
  }
  lines.push("ملاحظة: الأعداد تخص من راسل البوت فعلاً. من فتح التطبيق المصغّر دون مراسلة البوت لا يُحسب هنا.");
  return lines.join("\n");
}

async function balanceText(): Promise<string> {
  const [bal, w] = await Promise.all([fetchBalance(), loadWatch().catch(() => null)]);
  const lines = ["💰 محفظة الإدارة (أثر)"];
  lines.push(bal == null ? "👛 الرصيد: تعذّر الجلب الآن (خدمة السلسلة لا تردّ). أعد المحاولة بعد قليل." : `👛 الرصيد الآن: ${tons(bal)} TON`);
  if (w?.baselineAt) {
    const t = daySummary(w, dayKey(Date.now()));
    const wk = weekSummary(w);
    lines.push(`📈 اليوم: ${t.n} دفعة واردة (${tons(t.nano)} TON)`, `📅 آخر 7 أيام: ${wk.n} دفعة (${tons(wk.nano)} TON)`);
  }
  lines.push(`🔔 التنبيهات: ${w?.alerts === false ? "متوقفة" : "تعمل"}`, `🔗 ${walletLink()}`);
  return lines.join("\n");
}

async function paymentsText(): Promise<string> {
  const list = await fetchIncoming(10);
  if (!list) return "📈 تعذّر جلب الدفعات الآن. أعد المحاولة بعد قليل.";
  if (!list.length) return "📈 لا توجد دفعات واردة حديثة.";
  const rows = list.slice(0, 8).map((x) => `• ${new Date(x.at + 3 * 3600_000).toISOString().replace("T", " ").slice(5, 16)}  +${tons(x.nano)} TON  ${txLink(x.hash)}`);
  return ["📈 آخر الدفعات الواردة (توقيت إسطنبول)", ...rows].join("\n");
}

async function adminHome(botRow: BotRow): Promise<string> {
  const [bal, stats] = await Promise.all([fetchBalance().catch(() => null), statsText(botRow)]);
  return [`🛠 لوحة أدمن أثر (تظهر لك وحدك)`, bal == null ? "👛 الرصيد: غير متاح الآن" : `👛 الرصيد: ${tons(bal)} TON`, "", stats, "", "الأزرار بالأسفل: الرصيد، آخر الدفعات، التنبيهات، فحص فوري، القناة، وعرض البوت كما يراه الناس."].join("\n");
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
      await bot.api.sendMessage(chatId, await statsText(botRow));
    }
    return;
  }
  const msg = body.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();
  const fromId = String(msg.from?.id || "");
  const owner = isOwner(botRow, fromId);
  if (fromId && !owner) {
    try { await recordBotVisit(botRow.id, fromId); } catch { /* visit counting is optional */ }
  }
  const lang = fromId ? await getLang(botRow.id, fromId) : "en";

  // the owner sets (or stops) the mandatory channel: the answer to our question
  if (owner && msg.reply_to_message?.text === CHANNEL_ASK) {
    const channel = /^(إلغاء|cancel)$/i.test(text) ? null : normChannel(text);
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: channel } });
    if (!channel) { await bot.api.sendMessage(chatId, "✅ تم إيقاف الاشتراك الإجباري."); return; }
    const found = await bot.api.getChat(`@${channel}`).catch(() => null);
    let warning = "";
    if (!found) warning = "\n⚠️ لم أجد هذه القناة، تأكد من المعرّف.";
    else if (!(await bot.api.getChatMember(`@${channel}`, Number(fromId)).catch(() => null))) warning = "\n⚠️ أضف البوت إلى القناة كمشرف (Admin) وإلا لن يستطيع التحقق من المشتركين.";
    await bot.api.sendMessage(chatId, `✅ فُعّل الاشتراك الإجباري في @${channel}.${warning}`);
    return;
  }
  if (owner && text === OWNER_CHANNEL) {
    await bot.api.sendMessage(chatId, CHANNEL_ASK, { reply_markup: { force_reply: true, input_field_placeholder: "@MyChannel" } });
    return;
  }
  // people who are not the owner must have joined the channel (when one is set)
  if (!owner && botRow.requiredChannel && !(await isMember(bot, botRow.requiredChannel, fromId))) {
    await bot.api.sendMessage(chatId, `${T[lang].join}\nhttps://t.me/${normChannel(botRow.requiredChannel)}`, { reply_markup: new Keyboard().text(T[lang].joined).resized() });
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
    await bot.api.sendMessage(chatId, await statsText(botRow));
    return;
  }
  if (owner && text === OWNER_BALANCE) {
    await bot.api.sendMessage(chatId, await balanceText(), { link_preview_options: { is_disabled: true } });
    return;
  }
  if (owner && text === OWNER_PAYMENTS) {
    await bot.api.sendMessage(chatId, await paymentsText(), { link_preview_options: { is_disabled: true } });
    return;
  }
  if (owner && text === OWNER_ALERTS) {
    const w = await loadWatch();
    const next = w.alerts === false;
    await setAlerts(next).catch(() => null);
    await bot.api.sendMessage(chatId, next ? "🔔 تنبيهات الدفعات: تعمل. ستصلك رسالة عند كل دفعة جديدة (الفحص كل 5 دقائق تقريباً)." : "🔕 تنبيهات الدفعات: متوقفة. الرصيد والإحصائيات تبقى متاحة بالأزرار.");
    return;
  }
  if (owner && text === OWNER_CHECK) {
    const res = await checkPayments();
    const msg = !res.ok
      ? "🔄 تعذّر الفحص الآن: خدمة السلسلة لا تردّ."
      : res.baseline
        ? `✅ بدأت مراقبة الدفعات. الرصيد: ${res.balance == null ? "—" : tons(res.balance) + " TON"}.`
        : res.fresh.length
          ? `🎉 ${res.fresh.length} دفعة جديدة منذ آخر فحص، آخرها +${tons(res.fresh[res.fresh.length - 1].nano)} TON.\n👛 الرصيد: ${res.balance == null ? "—" : tons(res.balance) + " TON"}`
          : `✅ لا دفعات جديدة منذ آخر فحص.\n👛 الرصيد: ${res.balance == null ? "—" : tons(res.balance) + " TON"}`;
    await bot.api.sendMessage(chatId, msg);
    return;
  }
  if (owner && text === OWNER_USERVIEW) {
    await bot.api.sendMessage(chatId, T[lang].welcome, { reply_markup: menu(lang, true, true) });
    return;
  }
  if (owner && (text === OWNER_BACK || /^\/admin(?:@\w+)?$/i.test(text))) {
    await bot.api.sendMessage(chatId, await adminHome(botRow), { reply_markup: menu(lang, true), link_preview_options: { is_disabled: true } });
    return;
  }

  // birthday reminder: the button (or /birthday) asks for the date, the answer (or /birthday 14/3/2003) saves it, «off» removes it
  {
    const m = /^\/birthday(?:@\w+)?\s*(.*)$/is.exec(text);
    const asked = !!msg.reply_to_message?.text && LANGS.some((l) => msg.reply_to_message.text === BD[l.code].ask);
    if (LANGS.some((l) => BD[l.code].button === text) || (m && !m[1].trim())) {
      await bot.api.sendMessage(chatId, BD[lang].ask, { reply_markup: { force_reply: true, input_field_placeholder: "14/3/2003" } });
      return;
    }
    if (m || asked) {
      const arg = (m ? m[1] : text).trim();
      if (BD_OFF.test(arg)) {
        const done = await saveBirthday(prisma as any, botRow.id, fromId, lang, null);
        await bot.api.sendMessage(chatId, done ? bdText(lang, "off") : bdText(lang, "fail"));
        return;
      }
      const b = parseBirthday(arg);
      if (!b) { await bot.api.sendMessage(chatId, bdText(lang, "bad"), { reply_markup: { force_reply: true, input_field_placeholder: "14/3/2003" } }); return; }
      const done = await saveBirthday(prisma as any, botRow.id, fromId, lang, b);
      await bot.api.sendMessage(chatId, done ? bdText(lang, b.year === null ? "savedNoYear" : "saved", b) : bdText(lang, "fail"));
      return;
    }
  }

  if (LANGS.some((l) => T[l.code].share === text) || /^\/share(?:@\w+)?$/i.test(text)) {
    const botLink = ATHAR_BOT_FALLBACK;
    const uname = (await bot.api.getMe().catch(() => null))?.username;
    const link = uname ? `https://t.me/${uname}` : botLink;
    await bot.api.sendMessage(chatId, T[lang].shareMsg, { reply_markup: new InlineKeyboard().url(T[lang].share, `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(T[lang].shareText)}`) });
    return;
  }

  const cmd = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : text === "🕰 Athar" ? "open" : "";
  if (cmd === "start") {
    await bot.api.sendMessage(chatId, owner ? await adminHome(botRow) : T[lang].welcome, { reply_markup: menu(lang, owner), ...(owner ? { link_preview_options: { is_disabled: true } } : {}) });
    await ensureMenu(bot, chatId, lang, owner);
    return;
  }
  if (cmd === "language") {
    await bot.api.sendMessage(chatId, T[lang].pick, { reply_markup: languageKeyboard(lang) });
    return;
  }
  if (cmd === "stats" && owner) {
    await bot.api.sendMessage(chatId, await statsText(botRow));
    return;
  }
  const section = SECTIONS.find((x) => x.cmd === cmd);
  if (section) {
    await bot.api.sendMessage(chatId, T[lang][section.key], { reply_markup: new InlineKeyboard().webApp(T[lang][section.key], withLang(section.path, lang)) });
    return;
  }
  await bot.api.sendMessage(chatId, T[lang].help);
}
