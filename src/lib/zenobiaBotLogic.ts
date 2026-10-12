import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordBotVisit } from "@/lib/botVisit";
import { lifeStage, titleFor, type Stage } from "@/lib/zenobiaScore";
import { Address } from "@ton/core";
import { STAGE_IMG } from "@/lib/zenobiaPassport";
import { makeLinkToken } from "@/lib/zenobiaTonProof";

/**
 * ZENOBIA_BOT — pre-launch caravan bot for the Zenobia (ZNB) coin on TON.
 * English first for everyone, a language button, the choice remembered.
 * Pre-launch: registration, daily check-in streak, referrals, a points leaderboard, Zenobia's Journey stages.
 * Points are ranks and titles only. No promise of any reward, no financial advice.
 * Storage: one table created on first use (no manual SQL).
 */

const CHANNEL_URL = "https://t.me/Zenobiaton";
const BUY_URL = "https://t.me/blum/app?startapp=memepadjetton_ZNB_gMTPq-ref_GcJK8kBUGD"; // the coin's page on Blum (the owner's link)
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
export type Lang = "en" | "ar";

export const QUOTE_EN =
  "A fine thing is a fetter on the wrist of a free, noble person, and a wretched thing is a crown on the head of a cringing, abject coward.";
export const QUOTE_AR = "«نِعْمَ مَا قَيْدٌ فِي مِعْصَمِ حُرٍّ أَبِيٍّ، وَبِئْسَ مَا تَاجٌ عَلَى رَأْسِ خَانِعٍ ذَلِيلٍ»";

// The menu is a funnel: buy the coin, the passport, the board, the channel, invite, about, language.
// The older commands (journey, checkin, top, link, stages, season) still work when typed; they are just no longer in the menu.
export const COMMANDS = ["start", "buy", "passport", "board", "channel", "invite", "about", "lang"] as const;

const COMMAND_DESC: Record<(typeof COMMANDS)[number], string> = {
  start: "Start", buy: "Buy ZNB", passport: "Silk Road Passport", board: "Caravan Board", channel: "Zenobia channel", invite: "Invite friends", about: "About Zenobia", lang: "Language: English / العربية",
};
let commandsSet = false; // the command list is refreshed once per server start, so old bots pick up the simpler menu without being re-activated

const T = {
  en: {
    welcome:
      "🏛 Welcome to the Zenobia caravan.\n\nZenobia (ZNB): a community coin on TON inspired by the queen of Palmyra and the Silk Road.\n\n• Buy ZNB\n• Get a Silk Road Passport (limited, tradable NFT for holders)\n• See the Caravan Board\n\nNot financial advice. Crypto is risky.",
    btn: { buy: "🛒 Buy ZNB", passport: "🪪 Passport", board: "🏆 Caravan Board", channel: "📢 Channel", invite: "👥 Invite friends", about: "ℹ️ About", lang: "🌐 العربية" },
    legacyBtn: { journey: "🗺 My journey", checkin: "✅ Check-in", top: "🏆 Leaderboard", link: "🔗 Wallet", stages: "👑 Stages" },
    buyText: "🛒 Zenobia (ZNB) is traded on Blum. Tap below to open its page.\n\nNot financial advice. Crypto is risky; only use what you can afford to lose.",
    buyBtn: "🛒 Open ZNB on Blum",
    passInfo: "🪪 Silk Road Passport · From Palmyra\n\n• Limited to 2,500, it grows with its age: Child, Queen, Warrior\n• Locked for its first 30 days (the contract enforces it), then free to sell or buy\n• For ZNB holders; if its owner holds no ZNB it shows as Captive\n• Price rises with the number: 1, then 2, then 3 GRAM\n\nBuy it on the website with your wallet. Not a promise of any return.",
    passBtn: "🪪 Buy a passport",
    boardText: "🏆 Caravan Board: who has held ZNB the longest. Connect your wallet on the page to see your own rank and your passports. Rankings and titles only, with no reward.",
    boardBtn: "🏆 Open the Caravan Board",
    channelText: "📢 The Zenobia channel: the story of the queen of Palmyra, and news of the coin and the passport.",
    channelBtn: "📢 Open the channel",
    journey: (d: number, pts: number, rank: number, total: number, title: string, stage: string, nxt: string) =>
      `🗺 Your journey\n\nDay ${d} · stage: ${stage}${nxt}\nPoints: ${pts}\nRank: #${rank} of ${total} · ${title}`,
    next: (n: number, s: string) => `\nNext stage (${s}) in ${n} day${n === 1 ? "" : "s"}`,
    checkedIn: (streak: number, pts: number) => `✅ Checked in. Streak: ${streak} day${streak === 1 ? "" : "s"} · Points: ${pts}`,
    already: "You already checked in today. Come back tomorrow.",
    top: "🏆 Top caravan members",
    topEmpty: "No one on the board yet. Be the first.",
    link: "🔐 Connect your TON wallet to prove it is yours. Only verified wallets count toward season scores.\n\nWe never ask for your recovery phrase: the wallet signs one harmless message.",
    linkVerified: (a: string) => `✅ Verified wallet:\n${a}\n\nYou can connect a different one below.`,
    connect: "🔐 Connect wallet",
    passNeedWallet: "🪪 Your Caravan Passport is a soulbound NFT that grows with your journey. First connect and verify your wallet with the 🔗 Wallet button.",
    passSoon: "🪪 Passports are not open yet. Verify your wallet now and you will be among the first when they open.",
    passRequested: (n: number) => `🪪 Your passport #${n} is on its way to your verified wallet. It usually arrives within a few minutes.`,
    passReady: (n: number, link: string) => `✅ Your Caravan Passport #${n} is in your wallet.\n${link}`,
    passAsked: (n: number) => `✅ Passport #${n} requested. It will be minted to your verified wallet in a few minutes and you will get a message here.`,
    passSite: "🪪 Silk Road Passport · From Palmyra: a limited, tradable passport for ZNB holders. It is bought on the website with your wallet, locked for its first 30 days, then free to trade. Not a promise of any return.",
    passSiteBtn: "Open the passport page",
    passOpen: "✅ Passports are open.",
    passClosed: "✅ Passports are closed.",
    passUsage: "Usage: /passports on  or  /passports off",
    seasonNone: "No season has closed yet. Seasons are weekly; the first result is published after the first full week of trading.",
    seasonHead: (id: string, n: number, hash: string, seal: string) => `🗓 Season ${id}\nParticipants: ${n}\nResult fingerprint (SHA-256):\n${hash}\n\nSeal: ${seal}`,
    jettonOn: (a: string, d: number) => `✅ Jetton set: ${a} (decimals ${d}). Daily snapshots start.`,
    jettonUsage: "Usage: /jetton ADDRESS [decimals]",
    passportUsage: "Usage: /passport NUMBER  (links that passport to you; its picture follows your journey)",
    passportOn: (n: number) => `✅ Passport #${n} is now linked to you. Its picture and title follow your journey.`,
    about:
      "Zenobia (ZNB) is a community coin on TON inspired by the queen of Palmyra and the Silk Road. Holders can get a limited Silk Road Passport, and the Caravan Board shows who has held the longest. Rankings and titles only — not a promise of any reward. Crypto is risky; never put in more than you can lose.",
    stages: ["Child (days 0–6)", "Queen (days 7–20)", "Warrior (day 21+)", "Captive (sold everything)", "Legend (burned the passport)"],
    ref: (l: string) => `👥 Invite friends\n\nYour link:\n${l}\n\nShare it with friends who would like to know Zenobia.`,
    share: "📤 Share my link",
    shareText: "Join the Zenobia caravan on TON 🏛",
    owner: (n: number) => `👑 Owner stats\nMembers: ${n}`,
    join: "📢 Please join the Zenobia channel first, then tap the button below.",
    joined: "✅ I joined",
    chOn: (c: string, warn: string) => `✅ Mandatory subscription is on: @${c}.${warn}`,
    chOff: "✅ Mandatory subscription is off.",
    chWarn: "\n⚠️ Add the bot to the channel as an admin, or it cannot check members (until then it lets everyone in).",
    chUsage: "Usage: /channel @YourChannel  (or /channel off)",
  },
  ar: {
    welcome:
      "🏛 أهلًا بك في قافلة زنوبيا.\n\nزنوبيا (ZNB): عملة مجتمعية على TON مستوحاة من ملكة تدمر وطريق الحرير.\n\n• اشترِ ZNB\n• احصل على جواز طريق الحرير (NFT محدود وقابل للبيع للحاملين)\n• شاهد لوحة القافلة\n\nليست نصيحة مالية. العملات الرقمية محفوفة بالمخاطر.",
    btn: { buy: "🛒 شراء ZNB", passport: "🪪 الجواز", board: "🏆 لوحة القافلة", channel: "📢 القناة", invite: "👥 ادعُ صديقًا", about: "ℹ️ عن زنوبيا", lang: "🌐 English" },
    legacyBtn: { journey: "🗺 رحلتي", checkin: "✅ حضور اليوم", top: "🏆 الصدارة", link: "🔗 المحفظة", stages: "👑 المراحل" },
    buyText: "🛒 عملة زنوبيا (ZNB) تُتداول على Blum. اضغط الزر لفتح صفحتها.\n\nليست نصيحة مالية. العملات الرقمية محفوفة بالمخاطر، ولا تستخدم إلا ما تتحمل خسارته.",
    buyBtn: "🛒 افتح ZNB على Blum",
    passInfo: "🪪 جواز مرور طريق الحرير من تدمر\n\n• محدود بـ2,500، ويكبر بعمره: طفلة ثم ملكة ثم محاربة\n• يُقفل أول 30 يومًا (يفرضه العقد)، ثم يُباع ويُشترى بحرية\n• لحاملي ZNB؛ وإن لم يملك مالكه ZNB يظهر أسيرًا\n• السعر يرتفع مع الرقم: 1 ثم 2 ثم 3 GRAM\n\nيُشترى من الموقع بمحفظتك. ليس وعدًا بأي عائد.",
    passBtn: "🪪 اشترِ جوازًا",
    boardText: "🏆 لوحة القافلة: من احتفظ بـ ZNB أطول مدة. اربط محفظتك في الصفحة لترى ترتيبك وجوازاتك. ترتيب وألقاب فقط، بلا مكافأة.",
    boardBtn: "🏆 افتح لوحة القافلة",
    channelText: "📢 قناة زنوبيا: قصة ملكة تدمر وأخبار العملة والجواز.",
    channelBtn: "📢 افتح القناة",
    journey: (d: number, pts: number, rank: number, total: number, title: string, stage: string, nxt: string) =>
      `🗺 رحلتك\n\nاليوم ${d} · المرحلة: ${stage}${nxt}\nالنقاط: ${pts}\nالترتيب: ${rank} من ${total} · ${title}`,
    next: (n: number, s: string) => `\nالمرحلة التالية (${s}) بعد ${n} يوم`,
    checkedIn: (streak: number, pts: number) => `✅ تم الحضور. السلسلة: ${streak} يوم · النقاط: ${pts}`,
    already: "سجّلت حضورك اليوم. عد غدًا.",
    top: "🏆 أوائل القافلة",
    topEmpty: "لا أحد على اللوحة بعد. كن الأول.",
    link: "🔐 اربط محفظتك على TON لتثبت أنها لك. تُحتسب في درجات المواسم المحافظ الموثّقة فقط.\n\nلا نطلب منك عبارة الاسترداد أبدًا: المحفظة توقّع رسالة واحدة غير ضارة.",
    linkVerified: (a: string) => `✅ محفظة موثّقة:\n${a}\n\nيمكنك ربط محفظة أخرى بالزر أدناه.`,
    connect: "🔐 ربط المحفظة",
    passNeedWallet: "🪪 جواز القافلة رمز NFT غير قابل للتحويل يكبر مع رحلتك. اربط محفظتك وثبّتها أولًا بزر 🔗 المحفظة.",
    passSoon: "🪪 الجوازات لم تُفتح بعد. وثّق محفظتك الآن لتكون من الأوائل عند الافتتاح.",
    passRequested: (n: number) => `🪪 جوازك رقم ${n} في طريقه إلى محفظتك الموثّقة. يصل عادةً خلال دقائق.`,
    passReady: (n: number, link: string) => `✅ جواز القافلة رقم ${n} صار في محفظتك.\n${link}`,
    passAsked: (n: number) => `✅ طُلب الجواز رقم ${n}. سيُصَكّ إلى محفظتك الموثّقة خلال دقائق وتصلك رسالة هنا.`,
    passSite: "🪪 جواز مرور طريق الحرير من تدمر: جواز محدود العدد وقابل للبيع لحاملي ZNB. يُشترى من الموقع بمحفظتك، ويُقفل أول 30 يومًا ثم يُباع ويُشترى بحرية. ليس وعدًا بأي عائد.",
    passSiteBtn: "افتح صفحة الجواز",
    passOpen: "✅ فُتحت الجوازات.",
    passClosed: "✅ أُغلقت الجوازات.",
    passUsage: "الاستخدام: /passports on  أو  /passports off",
    seasonNone: "لم يُغلق موسم بعد. المواسم أسبوعية، وتُنشر أول نتيجة بعد أول أسبوع كامل.",
    seasonHead: (id: string, n: number, hash: string, seal: string) => `🗓 الموسم ${id}\nالمشاركون: ${n}\nبصمة النتيجة (SHA-256):\n${hash}\n\nالختم: ${seal}`,
    jettonOn: (a: string, d: number) => `✅ تم تحديد العملة: ${a} (الخانات ${d}). تبدأ اللقطات اليومية.`,
    jettonUsage: "الاستخدام: /jetton العنوان [الخانات]",
    passportUsage: "الاستخدام: /passport الرقم  (يربط هذا الجواز بك، وتتبع صورته رحلتك)",
    passportOn: (n: number) => `✅ الجواز رقم ${n} صار مربوطًا بك. تتبع صورته ولقبه رحلتك.`,
    about:
      "زنوبيا (ZNB) عملة مجتمعية على TON مستوحاة من ملكة تدمر. الموسم أسبوع، والدرجة تأتي من الاحتفاظ والمشاركة والتراكم، ولوحة الصدارة علنية. الدرجات ترتيب وألقاب فقط، وليست وعدًا بأي مقابل. العملات الرقمية محفوفة بالمخاطر، فلا تضع ما لا تتحمل خسارته.",
    stages: ["طفلة (الأيام 0–6)", "ملكة (الأيام 7–20)", "محاربة (من اليوم 21)", "أسيرة (بيع كل ما يملك)", "خلود (حرق الجواز)"],
    ref: (l: string) => `👥 ادعُ أصدقاءك\n\nرابطك:\n${l}\n\nشاركه مع أصدقائك الذين يهمهم التعرف على زنوبيا.`,
    share: "📤 شارك رابطي",
    shareText: "انضم إلى قافلة زنوبيا على TON 🏛",
    owner: (n: number) => `👑 إحصائيات المالك\nالأعضاء: ${n}`,
    join: "📢 انضم أولًا إلى قناة زنوبيا، ثم اضغط الزر أدناه.",
    joined: "✅ انضممت",
    chOn: (c: string, warn: string) => `✅ فُعّل الاشتراك الإجباري: @${c}.${warn}`,
    chOff: "✅ أُوقف الاشتراك الإجباري.",
    chWarn: "\n⚠️ أضف البوت إلى القناة كمشرف (Admin) وإلا لا يستطيع التحقق من المشتركين (وإلى ذلك الحين يدخل الجميع).",
    chUsage: "الاستخدام: /channel @قناتك  (أو /channel off)",
  },
} as const;

const STAGE_NAME: Record<Lang, Record<Stage, string>> = {
  en: { child: "Child", queen: "Queen", warrior: "Warrior", captive: "Captive", legend: "Legend" },
  ar: { child: "طفلة", queen: "ملكة", warrior: "محاربة", captive: "أسيرة", legend: "خلود" },
};
const STAGE_CAPTION: Record<Lang, Record<Stage, string>> = {
  en: {
    child: "Child — the caravan begins.",
    queen: "Queen — a crown earned by holding on.",
    warrior: "Warrior — standing strong.",
    captive: `Captive.\n\n“${QUOTE_EN}”`,
    legend: `Legend.\n\n“${QUOTE_EN}”`,
  },
  ar: {
    child: "طفلة — تبدأ القافلة.",
    queen: "ملكة — تاج نالته بالصمود.",
    warrior: "محاربة — ثابتة وقوية.",
    captive: `أسيرة.\n\n${QUOTE_AR}`,
    legend: `خلود.\n\n${QUOTE_AR}`,
  },
};

// ---- mandatory-subscription channel (Bot.requiredChannel, the field the other bots use) ----
const normChannel = (x: string) => x.trim().replace(/^@/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^(t\.me|telegram\.me)\//i, "").replace(/\/+$/, "").split(/[?#]/)[0];
/** false only when Telegram says the person is not in the channel. If the bot cannot check (not an admin there), nobody is locked out. */
async function isMember(bot: TelegramBot, channel: string, tgId: string): Promise<boolean> {
  try {
    const m = await bot.api.getChatMember(`@${normChannel(channel)}`, Number(tgId));
    return ["creator", "administrator", "member", "restricted"].includes(m.status);
  } catch (e: any) {
    return !/user not found|participant/i.test(String(e?.description || e?.message || ""));
  }
}

// ---- storage (raw SQL; the table is created on first use) ----
let ready: Promise<void> | null = null;
export function ensureZenobiaTables(): Promise<void> {
  if (!ready) {
    ready = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS zenobia_user (
          bot_id TEXT NOT NULL, tg_user_id TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
          name TEXT, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), points INT NOT NULL DEFAULT 0,
          streak INT NOT NULL DEFAULT 0, last_checkin DATE, ref_by TEXT, wallet TEXT,
          wallet_verified BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY (bot_id, tg_user_id))`,
      )
      .then(() => prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS zenobia_passport (idx INT PRIMARY KEY, bot_id TEXT NOT NULL, tg_user_id TEXT NOT NULL, minted_at TIMESTAMPTZ NOT NULL DEFAULT now())`))
      .then(() => prisma.$executeRawUnsafe(`ALTER TABLE zenobia_passport ADD COLUMN IF NOT EXISTS wallet TEXT`))
      .then(() => prisma.$executeRawUnsafe(`ALTER TABLE zenobia_passport ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'minted'`))
      .then(() => prisma.$executeRawUnsafe(`ALTER TABLE zenobia_passport ADD COLUMN IF NOT EXISTS item TEXT`))
      .then(() => prisma.$executeRawUnsafe(`ALTER TABLE zenobia_passport ADD COLUMN IF NOT EXISTS pay_tx TEXT`))
      .then(() => prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS zenobia_passport_pay ON zenobia_passport (pay_tx) WHERE pay_tx IS NOT NULL`))
      .then(() => prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS zenobia_passport_person ON zenobia_passport (bot_id, tg_user_id)`))
      .then(() => prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS zenobia_config (bot_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (bot_id, k))`))
      .then(() => prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS zenobia_snap (day DATE NOT NULL, owner TEXT NOT NULL, balance NUMERIC NOT NULL, PRIMARY KEY (day, owner))`))
      .then(() => prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS zenobia_season (season TEXT PRIMARY KEY, hash TEXT NOT NULL, results JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`))
      .then(() => undefined)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

interface UserRow { wallet_verified: boolean; lang: Lang; name: string | null; joined_at: Date; points: number; streak: number; last_checkin: Date | null; wallet: string | null }

async function getUser(botId: string, id: string): Promise<UserRow | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT lang, name, joined_at, points, streak, last_checkin, wallet, wallet_verified FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2`, botId, id,
  )) as UserRow[];
  return rows[0] ?? null;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86400000);
const dayStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** The menu at the bottom of the screen (collapsible with Back; reopened with the keyboard icon). */
function menuKeyboard(l: Lang): Keyboard {
  const b = T[l].btn;
  return new Keyboard()
    .text(b.buy).text(b.passport).row()
    .text(b.board).text(b.channel).row()
    .text(b.invite).text(b.about).row()
    .text(b.lang)
    .resized(); // not persistent: the Back button (or the keyboard icon) collapses it, and the icon opens it again
}

const ACT_BY_LABEL: Record<string, string> = {};
for (const lg of ["en", "ar"] as Lang[]) {
  const b = T[lg].btn, o = T[lg].legacyBtn; // the older labels still work for people whose keyboard has not been refreshed
  Object.assign(ACT_BY_LABEL, { [b.buy]: "zn:buy", [b.passport]: "zn:pass", [b.board]: "zn:board", [b.channel]: "zn:channel", [b.invite]: "zn:invite", [b.about]: "zn:about", [b.lang]: "zn:lang",
    [o.journey]: "zn:journey", [o.checkin]: "zn:checkin", [o.top]: "zn:top", [o.link]: "zn:link", [o.stages]: "zn:stages" });
}

interface Panel { text: string; photo?: string; kb?: InlineKeyboard | Keyboard }
/**
 * A normal reply. The menu keyboard is sent only with the welcome (start, language change): replies do not resend it, so a person who
 * collapsed it with the Back button is not interrupted by it popping up again; the keyboard icon next to the input opens it.
 */
async function reply(bot: TelegramBot, chatId: number, l: Lang, p: Panel): Promise<void> {
  void l;
  if (p.photo) {
    try {
      await bot.api.sendPhoto(chatId, p.photo, { caption: p.text, reply_markup: p.kb });
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  await bot.api.sendMessage(chatId, p.text, { reply_markup: p.kb });
}

const STAGES: Stage[] = ["child", "queen", "warrior", "captive", "legend"];
function stagesKb(l: Lang, cur: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  STAGES.forEach((st, i) => kb.text(`${i === cur ? "• " : ""}${STAGE_NAME[l][st]}`, `zn:st:${i}`));
  return kb;
}

async function rankOf(botId: string, id: string): Promise<{ rank: number; total: number }> {
  const r = (await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*)+1 FROM zenobia_user WHERE bot_id=$1 AND points > (SELECT points FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2))::int AS rank,
            (SELECT COUNT(*) FROM zenobia_user WHERE bot_id=$1)::int AS total`, botId, id,
  )) as { rank: number; total: number }[];
  return { rank: Number(r[0]?.rank ?? 1), total: Math.max(1, Number(r[0]?.total ?? 1)) };
}

const stageUrl = (st: Stage) => `${SITE}/zenobia/${STAGE_IMG[st]}`;

export async function handleZenobiaBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  await ensureZenobiaTables();
  const cq = body.callback_query;
  const msg = body.message;
  const from = cq?.from ?? msg?.from;
  const chatId: number | undefined = cq?.message?.chat?.id ?? msg?.chat?.id;
  if (!from?.id || !chatId) return;
  const id = String(from.id);
  const botId = botRow.id;
  const ownerId = String(botRow.ownerId || "");
  const text = String(msg?.text || "").trim();

  // First contact: English for everyone (Telegram language is ignored on purpose).
  let user = await getUser(botId, id);
  if (!user) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 60) || null;
    const refRaw = text.startsWith("/start") ? text.split(/\s+/)[1] || "" : "";
    const ref = /^ref_(\d{5,15})$/.exec(refRaw)?.[1];
    const refOk = ref && ref !== id ? ref : null;
    await prisma.$executeRawUnsafe(
      `INSERT INTO zenobia_user (bot_id, tg_user_id, lang, name, ref_by) VALUES ($1,$2,'en',$3,$4) ON CONFLICT DO NOTHING`,
      botId, id, name, refOk,
    );
    if (refOk) {
      await prisma.$executeRawUnsafe(
        `UPDATE zenobia_user SET points = points + 5 WHERE bot_id=$1 AND tg_user_id=$2`, botId, refOk,
      );
    }
    await recordBotVisit(botId, id);
    user = await getUser(botId, id);
    if (!user) return;
  }
  const l: Lang = user.lang === "ar" ? "ar" : "en";
  const t = T[l];
  const panel = (p: Panel) => reply(bot, chatId, l, p);
  const botLink = async () => `https://t.me/${(await bot.api.getMe().catch(() => ({ username: "" }))).username}?start=ref_${id}`;

  // the owner sets (or stops) the mandatory channel
  if (id === ownerId && !cq && /^\/channel(@\w+)?(\s|$)/i.test(text)) {
    const arg = text.split(/\s+/)[1] || "";
    if (!arg) { await panel({ text: t.chUsage }); return; }
    if (/^(off|cancel|إلغاء)$/i.test(arg)) {
      await prisma.bot.update({ where: { id: botId }, data: { requiredChannel: null } });
      await panel({ text: t.chOff });
      return;
    }
    const ch = normChannel(arg);
    await prisma.bot.update({ where: { id: botId }, data: { requiredChannel: ch } });
    const canCheck = await bot.api.getChatMember(`@${ch}`, Number(id)).then(() => true).catch(() => false);
    await panel({ text: t.chOn(ch, canCheck ? "" : t.chWarn) });
    return;
  }
  // everyone else must have joined the channel first (when one is set)
  if (id !== ownerId && botRow.requiredChannel && !(await isMember(bot, botRow.requiredChannel, id))) {
    const ch = normChannel(botRow.requiredChannel);
    await panel({
      text: `${t.join}\nhttps://t.me/${ch}`,
      kb: new InlineKeyboard().url("📢 Zenobia", `https://t.me/${ch}`).row().text(t.joined, "zn:start"),
    });
    return;
  }

  const act = cq ? String(cq.data || "") : text.startsWith("/") ? "zn:" + text.slice(1).split(/[\s@]/)[0].toLowerCase() : ACT_BY_LABEL[text] || "";
  if (cq) await bot.api.answerCallbackQuery(cq.id).catch(() => null);

  const welcome = (lang: Lang): Panel => ({ text: T[lang].welcome, kb: menuKeyboard(lang) });
  // the links people need most: where to buy the coin, the channel, the board and the passport
  const linksKb = (lang: Lang) => new InlineKeyboard()
    .url(lang === "ar" ? "🛒 شراء ZNB (Blum)" : "🛒 Buy ZNB (Blum)", BUY_URL).row()
    .url(lang === "ar" ? "📢 قناة زنوبيا" : "📢 Zenobia channel", CHANNEL_URL).row()
    .url(lang === "ar" ? "🏆 لوحة القافلة" : "🏆 Caravan Board", `${SITE}/zenobia/hall.html`).row()
    .url(lang === "ar" ? "🪪 جواز طريق الحرير" : "🪪 Silk Road Passport", `${SITE}/zenobia/silk.html`);

  if (act === "zn:start") {
    if (!commandsSet) {
      commandsSet = true;
      try { await bot.api.setMyCommands(COMMANDS.map((command) => ({ command, description: COMMAND_DESC[command] }))); } catch { /* the list is optional */ }
    }
    // the first panel carries the persistent menu, which then stays at the bottom of the screen
    await reply(bot, chatId, l, welcome(l));
    return;
  }

  if (act === "zn:lang") {
    const to: Lang = l === "en" ? "ar" : "en";
    await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET lang=$3 WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, to);
    await reply(bot, chatId, to, welcome(to));
    return;
  }

  if (act === "zn:journey") {
    const d = daysBetween(new Date(user.joined_at), new Date());
    const stage = lifeStage(d);
    const { rank, total } = await rankOf(botId, id);
    const nextAt = stage === "child" ? 7 : stage === "queen" ? 21 : 0;
    const nxt = nextAt ? t.next(nextAt - d, STAGE_NAME[l][stage === "child" ? "queen" : "warrior"]) : "";
    await panel({
      text: `${t.journey(d, user.points, rank, total, titleFor(rank, total)[l], STAGE_NAME[l][stage], nxt)}\n\n${STAGE_CAPTION[l][stage]}`,
      photo: stageUrl(stage),
    });
    return;
  }

  if (act === "zn:checkin") {
    if (dayStr(user.last_checkin) === today()) {
      await panel({ text: t.already });
      return;
    }
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = dayStr(user.last_checkin) === yest ? user.streak + 1 : 1;
    const gain = 1 + Math.min(4, Math.floor(streak / 7)); // +1 a day, a little more for week-long streaks
    await prisma.$executeRawUnsafe(
      `UPDATE zenobia_user SET points = points + $3, streak=$4, last_checkin=CURRENT_DATE WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, gain, streak,
    );
    await panel({ text: t.checkedIn(streak, user.points + gain) });
    return;
  }

  if (act === "zn:top") {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT name, points FROM zenobia_user WHERE bot_id=$1 AND points > 0 ORDER BY points DESC, joined_at ASC LIMIT 10`, botId,
    )) as { name: string | null; points: number }[];
    const lines = rows.map((r, i) => `${i + 1}. ${(r.name || "Caravan").split(" ")[0].slice(0, 14)} — ${r.points}`);
    await panel({ text: `${t.top}\n\n${lines.length ? lines.join("\n") : t.topEmpty}` });
    return;
  }

  if (act === "zn:invite") {
    const link = await botLink();
    await panel({
      text: t.ref(link),
      kb: new InlineKeyboard().url(t.share, `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t.shareText)}`),
    });
    return;
  }

  if (act === "zn:link") {
    const url = `${SITE}/zenobia/link.html?bot=${encodeURIComponent(botId)}&t=${makeLinkToken(botRow.token, id)}&l=${l}`;
    const text = user.wallet && user.wallet_verified ? `${t.linkVerified(user.wallet)}` : t.link;
    await panel({ text, kb: new InlineKeyboard().url(t.connect, url) });
    return;
  }

  if (act === "zn:stages") {
    await panel({ text: `${STAGE_CAPTION[l].child}\n\n${t.stages.join("\n")}`, photo: stageUrl("child"), kb: stagesKb(l, 0) });
    return;
  }

  if (act.startsWith("zn:st:") && cq?.message?.message_id) {
    const i = Math.max(0, Math.min(4, Number(act.slice(6)) || 0));
    const st = STAGES[i];
    try {
      await bot.api.editMessageMedia(chatId, cq.message.message_id, { type: "photo", media: stageUrl(st), caption: `${STAGE_CAPTION[l][st]}\n\n${t.stages.join("\n")}` }, { reply_markup: stagesKb(l, i) });
    } catch {
      /* same stage tapped twice, or the message is gone */
    }
    return;
  }

  if (act === "zn:about") {
    await panel({ text: t.about, kb: linksKb(l) });
    return;
  }

  if (act === "zn:season") {
    const rows = (await prisma.$queryRawUnsafe(`SELECT season, hash, results FROM zenobia_season ORDER BY season DESC LIMIT 1`)) as { season: string; hash: string; results: { id: string; score: number }[] }[];
    if (!rows[0]) { await panel({ text: t.seasonNone }); return; }
    const top = await Promise.all(rows[0].results.slice(0, 10).map(async (r, i) => {
      const u = (await prisma.$queryRawUnsafe(`SELECT name FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2`, botId, r.id)) as { name: string | null }[];
      return `${i + 1}. ${(u[0]?.name || "Caravan").split(" ")[0].slice(0, 14)} — ${r.score.toFixed(4)}`;
    }));
    await panel({ text: `${t.seasonHead(rows[0].season, rows[0].results.length, rows[0].hash, `${SITE}/api/zenobia/seal/${rows[0].season}.svg`)}\n\n${top.join("\n")}` });
    return;
  }

  if (act === "zn:jetton" && id === ownerId && !cq) {
    const [, addr, dec] = text.split(/\s+/);
    let raw = "";
    try { raw = Address.parse(addr).toString(); } catch { await panel({ text: t.jettonUsage }); return; }
    const decimals = Math.max(0, Math.min(18, Number(dec) || 9));
    await prisma.$executeRawUnsafe(`INSERT INTO zenobia_config (bot_id,k,v) VALUES ($1,'jetton',$2) ON CONFLICT (bot_id,k) DO UPDATE SET v=EXCLUDED.v`, botId, raw);
    await prisma.$executeRawUnsafe(`INSERT INTO zenobia_config (bot_id,k,v) VALUES ($1,'decimals',$2) ON CONFLICT (bot_id,k) DO UPDATE SET v=EXCLUDED.v`, botId, String(decimals));
    await panel({ text: t.jettonOn(raw, decimals) });
    return;
  }

  if (act === "zn:pass") {
    // an older free passport (the owner's trial #0) still shows if this person has one
    const mineRows = (await prisma.$queryRawUnsafe(`SELECT idx, status, item FROM zenobia_passport WHERE bot_id=$1 AND tg_user_id=$2`, botId, id)) as { idx: number; status: string; item: string | null }[];
    let mine = mineRows[0];
    if (!mine && id === ownerId && user.wallet && user.wallet_verified) {
      await prisma.$executeRawUnsafe(`INSERT INTO zenobia_passport (idx, bot_id, tg_user_id, wallet, status) VALUES (0,$1,$2,$3,'minted') ON CONFLICT DO NOTHING`, botId, id, user.wallet);
      mine = { idx: 0, status: "minted", item: null };
    }
    const have = mine && mine.status === "minted" ? `${t.passReady(mine.idx, mine.item ? `https://tonviewer.com/${mine.item}` : "")}\n\n` : "";
    await panel({ text: have + t.passInfo, kb: new InlineKeyboard().url(t.passBtn, `${SITE}/zenobia/silk.html`) });
    return;
  }

  if (act === "zn:buy") {
    await panel({ text: t.buyText, kb: new InlineKeyboard().url(t.buyBtn, BUY_URL) });
    return;
  }
  if (act === "zn:board") {
    await panel({ text: t.boardText, kb: new InlineKeyboard().url(t.boardBtn, `${SITE}/zenobia/hall.html`) });
    return;
  }
  if (act === "zn:channel") {
    await panel({ text: t.channelText, kb: new InlineKeyboard().url(t.channelBtn, CHANNEL_URL) });
    return;
  }

  if (act === "zn:passports" && id === ownerId && !cq) {
    const arg = (text.split(/\s+/)[1] || "").toLowerCase();
    if (arg !== "on" && arg !== "off") { await panel({ text: t.passUsage }); return; }
    await prisma.$executeRawUnsafe(`INSERT INTO zenobia_config (bot_id,k,v) VALUES ($1,'passports',$2) ON CONFLICT (bot_id,k) DO UPDATE SET v=EXCLUDED.v`, botId, arg);
    await panel({ text: arg === "on" ? t.passOpen : t.passClosed });
    return;
  }

  if (act === "zn:passport" && id === ownerId && !cq) {
    const n = Number(text.split(/\s+/)[1]);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) { await panel({ text: t.passportUsage }); return; }
    await prisma.$executeRawUnsafe(
      `INSERT INTO zenobia_passport (idx, bot_id, tg_user_id) VALUES ($1,$2,$3) ON CONFLICT (idx) DO UPDATE SET bot_id=EXCLUDED.bot_id, tg_user_id=EXCLUDED.tg_user_id`, n, botId, id,
    );
    await panel({ text: t.passportOn(n) });
    return;
  }

  if (act === "zn:stats" && id === ownerId) {
    const r = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM zenobia_user WHERE bot_id=$1`, botId)) as { n: number }[];
    await panel({ text: t.owner(Number(r[0]?.n ?? 0)) });
    return;
  }

  if (!cq) await reply(bot, chatId, l, welcome(l));
}
