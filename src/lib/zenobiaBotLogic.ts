import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { Address } from "@ton/core";
import { prisma } from "@/lib/prisma";
import { recordBotVisit } from "@/lib/botVisit";
import { lifeStage, titleFor, type Stage } from "@/lib/zenobiaScore";

/**
 * ZENOBIA_BOT — pre-launch caravan bot for the Zenobia (ZNB) coin on TON.
 * English first for everyone, a language button, the choice remembered.
 * Pre-launch: registration, daily check-in streak, referrals, a points leaderboard, Zenobia's Journey stages.
 * Points are ranks and titles only. No promise of any reward, no financial advice.
 * Storage: one table created on first use (no manual SQL).
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
export type Lang = "en" | "ar";

export const QUOTE_EN =
  "A fine thing is a fetter on the wrist of a free, noble person, and a wretched thing is a crown on the head of a cringing, abject coward.";
export const QUOTE_AR = "«نِعْمَ مَا قَيْدٌ فِي مِعْصَمِ حُرٍّ أَبِيٍّ، وَبِئْسَ مَا تَاجٌ عَلَى رَأْسِ خَانِعٍ ذَلِيلٍ»";

export const COMMANDS = ["start", "journey", "checkin", "top", "link", "stages", "lang", "about"] as const;

const STAGE_IMG: Record<Stage, string> = {
  child: "stage-1-child.jpg",
  queen: "stage-2-queen.jpg",
  warrior: "stage-3-warrior.jpg",
  captive: "stage-4-captive.jpg",
  legend: "stage-5-legend.jpg",
};

const T = {
  en: {
    welcome:
      "🏛 Welcome to the Zenobia caravan.\n\nZenobia, queen of Palmyra: real history plus a transparent weekly game on TON.\n\n• Check in daily to build your streak\n• Invite friends with your link\n• Watch your passport grow from a child into a queen and a warrior\n\nPoints are ranks and titles only — not a promise of any reward. Not financial advice.",
    btn: { journey: "🗺 My journey", checkin: "✅ Daily check-in", top: "🏆 Leaderboard", link: "🔗 Link wallet", stages: "👑 All stages", about: "ℹ️ About", lang: "🌐 العربية" },
    journey: (d: number, pts: number, rank: number, total: number, title: string, stage: string, nxt: string) =>
      `🗺 Your journey\n\nDay ${d} · stage: ${stage}${nxt}\nPoints: ${pts}\nRank: #${rank} of ${total} · ${title}`,
    next: (n: number, s: string) => `\nNext stage (${s}) in ${n} day${n === 1 ? "" : "s"}`,
    checkedIn: (streak: number, pts: number) => `✅ Checked in. Streak: ${streak} day${streak === 1 ? "" : "s"} · Points: ${pts}`,
    already: "You already checked in today. Come back tomorrow.",
    top: "🏆 Top caravan members",
    topEmpty: "No one on the board yet. Be the first.",
    link: "🔗 Send your TON wallet like this:\n/link YOUR_ADDRESS\n\nIt is saved as unverified. Ownership is proven later with a TonConnect signature, and only verified wallets will count toward season scores.",
    linkOk: (a: string) => `🔗 Saved (unverified): ${a}`,
    linkBad: "That is not a valid TON address. Example: /link UQ...",
    about:
      "Zenobia (ZNB) is a community coin on TON inspired by the queen of Palmyra. Seasons last a week; a score comes from holding, taking part and accumulating, and the leaderboard is public. Scores are ranks and titles only — not a promise of any reward. Crypto is risky; never put in more than you can lose.",
    stages: ["Child (days 0–6)", "Queen (days 7–20)", "Warrior (day 21+)", "Captive (sold everything)", "Legend (burned the passport)"],
    ref: (l: string) => `Invite friends: ${l}\nEach friend who joins gives you +5 points.`,
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
      "🏛 أهلًا بك في قافلة زنوبيا.\n\nزنوبيا ملكة تدمر: تاريخ حقيقي ولعبة أسبوعية شفافة على TON.\n\n• سجّل حضورك يوميًا لتبني سلسلتك\n• ادعُ أصدقاءك برابطك\n• شاهد جوازك يكبر من طفلة إلى ملكة ثم محاربة\n\nالنقاط ترتيب وألقاب فقط، وليست وعدًا بأي مقابل. ليست نصيحة مالية.",
    btn: { journey: "🗺 رحلتي", checkin: "✅ حضور اليوم", top: "🏆 الصدارة", link: "🔗 ربط المحفظة", stages: "👑 كل المراحل", about: "ℹ️ عن زنوبيا", lang: "🌐 English" },
    journey: (d: number, pts: number, rank: number, total: number, title: string, stage: string, nxt: string) =>
      `🗺 رحلتك\n\nاليوم ${d} · المرحلة: ${stage}${nxt}\nالنقاط: ${pts}\nالترتيب: ${rank} من ${total} · ${title}`,
    next: (n: number, s: string) => `\nالمرحلة التالية (${s}) بعد ${n} يوم`,
    checkedIn: (streak: number, pts: number) => `✅ تم الحضور. السلسلة: ${streak} يوم · النقاط: ${pts}`,
    already: "سجّلت حضورك اليوم. عد غدًا.",
    top: "🏆 أوائل القافلة",
    topEmpty: "لا أحد على اللوحة بعد. كن الأول.",
    link: "🔗 أرسل محفظتك على تون هكذا:\n/link عنوانك\n\nتُحفظ غير موثّقة. تُثبت ملكيتها لاحقًا بتوقيع TonConnect، وتُحتسب في درجات المواسم المحافظ الموثّقة فقط.",
    linkOk: (a: string) => `🔗 تم الحفظ (غير موثّقة): ${a}`,
    linkBad: "هذا ليس عنوان TON صالحًا. مثال: /link UQ...",
    about:
      "زنوبيا (ZNB) عملة مجتمعية على TON مستوحاة من ملكة تدمر. الموسم أسبوع، والدرجة تأتي من الاحتفاظ والمشاركة والتراكم، ولوحة الصدارة علنية. الدرجات ترتيب وألقاب فقط، وليست وعدًا بأي مقابل. العملات الرقمية محفوفة بالمخاطر، فلا تضع ما لا تتحمل خسارته.",
    stages: ["طفلة (الأيام 0–6)", "ملكة (الأيام 7–20)", "محاربة (من اليوم 21)", "أسيرة (بيع كل ما يملك)", "خلود (حرق الجواز)"],
    ref: (l: string) => `ادعُ أصدقاءك: ${l}\nكل صديق ينضم يمنحك +5 نقاط.`,
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
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS zenobia_user (
          bot_id TEXT NOT NULL, tg_user_id TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
          name TEXT, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), points INT NOT NULL DEFAULT 0,
          streak INT NOT NULL DEFAULT 0, last_checkin DATE, ref_by TEXT, wallet TEXT,
          wallet_verified BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY (bot_id, tg_user_id))`,
      )
      .then(() => undefined)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

interface UserRow { lang: Lang; name: string | null; joined_at: Date; points: number; streak: number; last_checkin: Date | null; wallet: string | null }

async function getUser(botId: string, id: string): Promise<UserRow | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT lang, name, joined_at, points, streak, last_checkin, wallet FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2`, botId, id,
  )) as UserRow[];
  return rows[0] ?? null;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86400000);
const dayStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function mainMenu(l: Lang): InlineKeyboard {
  const b = T[l].btn;
  return new InlineKeyboard()
    .text(b.journey, "zn:journey").text(b.checkin, "zn:checkin").row()
    .text(b.top, "zn:top").text(b.link, "zn:link").row()
    .text(b.stages, "zn:stages").text(b.about, "zn:about").row()
    .text(b.lang, `zn:lang:${l === "en" ? "ar" : "en"}`);
}

async function rankOf(botId: string, id: string): Promise<{ rank: number; total: number }> {
  const r = (await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*)+1 FROM zenobia_user WHERE bot_id=$1 AND points > (SELECT points FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2))::int AS rank,
            (SELECT COUNT(*) FROM zenobia_user WHERE bot_id=$1)::int AS total`, botId, id,
  )) as { rank: number; total: number }[];
  return { rank: Number(r[0]?.rank ?? 1), total: Math.max(1, Number(r[0]?.total ?? 1)) };
}

async function sendStage(bot: TelegramBot, chatId: number, stage: Stage, l: Lang, extra = "") {
  const caption = (extra ? extra + "\n\n" : "") + STAGE_CAPTION[l][stage];
  try {
    await bot.api.sendPhoto(chatId, `${SITE}/zenobia/${STAGE_IMG[stage]}`, { caption });
  } catch {
    await bot.api.sendMessage(chatId, caption);
  }
}

export async function handleZenobiaBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  await ensureTable();
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

  // the owner sets (or stops) the mandatory channel
  if (id === ownerId && !cq && /^\/channel(@\w+)?(\s|$)/i.test(text)) {
    const arg = text.split(/\s+/)[1] || "";
    if (!arg) { await bot.api.sendMessage(chatId, t.chUsage); return; }
    if (/^(off|cancel|إلغاء)$/i.test(arg)) {
      await prisma.bot.update({ where: { id: botId }, data: { requiredChannel: null } });
      await bot.api.sendMessage(chatId, t.chOff);
      return;
    }
    const ch = normChannel(arg);
    await prisma.bot.update({ where: { id: botId }, data: { requiredChannel: ch } });
    const canCheck = await bot.api.getChatMember(`@${ch}`, Number(id)).then(() => true).catch(() => false);
    await bot.api.sendMessage(chatId, t.chOn(ch, canCheck ? "" : t.chWarn));
    return;
  }
  // everyone else must have joined the channel first (when one is set)
  if (id !== ownerId && botRow.requiredChannel && !(await isMember(bot, botRow.requiredChannel, id))) {
    await bot.api.sendMessage(chatId, `${t.join}\nhttps://t.me/${normChannel(botRow.requiredChannel)}`, {
      reply_markup: new InlineKeyboard().url("📢 Zenobia", `https://t.me/${normChannel(botRow.requiredChannel)}`).row().text(t.joined, "zn:start"),
    });
    return;
  }

  const act = cq ? String(cq.data || "") : text.startsWith("/") ? "zn:" + text.slice(1).split(/[\s@]/)[0].toLowerCase() : "";
  if (cq) await bot.api.answerCallbackQuery(cq.id).catch(() => null);

  if (act === "zn:start" || (!cq && text.startsWith("/start"))) {
    await bot.api.sendMessage(chatId, t.welcome, { reply_markup: mainMenu(l) });
    await bot.api.sendMessage(chatId, t.ref(`https://t.me/${(await bot.api.getMe().catch(() => ({ username: "" }))).username}?start=ref_${id}`));
    return;
  }

  if (act.startsWith("zn:lang")) {
    const to: Lang = cq ? (act.endsWith(":ar") ? "ar" : "en") : l === "en" ? "ar" : "en";
    await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET lang=$3 WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, to);
    await bot.api.sendMessage(chatId, T[to].welcome, { reply_markup: mainMenu(to) });
    return;
  }

  if (act === "zn:journey") {
    const d = daysBetween(new Date(user.joined_at), new Date());
    const stage = lifeStage(d);
    const { rank, total } = await rankOf(botId, id);
    const nextAt = stage === "child" ? 7 : stage === "queen" ? 21 : 0;
    const nxt = nextAt ? t.next(nextAt - d, STAGE_NAME[l][stage === "child" ? "queen" : "warrior"]) : "";
    await bot.api.sendMessage(chatId, t.journey(d, user.points, rank, total, titleFor(rank, total)[l], STAGE_NAME[l][stage], nxt));
    await sendStage(bot, chatId, stage, l);
    return;
  }

  if (act === "zn:checkin") {
    if (dayStr(user.last_checkin) === today()) {
      await bot.api.sendMessage(chatId, t.already, { reply_markup: mainMenu(l) });
      return;
    }
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = dayStr(user.last_checkin) === yest ? user.streak + 1 : 1;
    const gain = 1 + Math.min(4, Math.floor(streak / 7)); // +1 a day, a little more for week-long streaks
    await prisma.$executeRawUnsafe(
      `UPDATE zenobia_user SET points = points + $3, streak=$4, last_checkin=CURRENT_DATE WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, gain, streak,
    );
    await bot.api.sendMessage(chatId, t.checkedIn(streak, user.points + gain), { reply_markup: mainMenu(l) });
    return;
  }

  if (act === "zn:top") {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT name, points FROM zenobia_user WHERE bot_id=$1 AND points > 0 ORDER BY points DESC, joined_at ASC LIMIT 10`, botId,
    )) as { name: string | null; points: number }[];
    const lines = rows.map((r, i) => `${i + 1}. ${(r.name || "Caravan").split(" ")[0].slice(0, 14)} — ${r.points}`);
    await bot.api.sendMessage(chatId, `${t.top}\n\n${lines.length ? lines.join("\n") : t.topEmpty}`, { reply_markup: mainMenu(l) });
    return;
  }

  if (act === "zn:link") {
    const arg = !cq ? text.split(/\s+/)[1] : "";
    if (!arg) {
      await bot.api.sendMessage(chatId, t.link, { reply_markup: mainMenu(l) });
      return;
    }
    try {
      const friendly = Address.parse(arg).toString({ bounceable: false });
      await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET wallet=$3, wallet_verified=false WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, friendly);
      await bot.api.sendMessage(chatId, t.linkOk(friendly), { reply_markup: mainMenu(l) });
    } catch {
      await bot.api.sendMessage(chatId, t.linkBad);
    }
    return;
  }

  if (act === "zn:stages") {
    for (const s of ["child", "queen", "warrior", "captive", "legend"] as Stage[]) await sendStage(bot, chatId, s, l);
    await bot.api.sendMessage(chatId, t.stages.join("\n"), { reply_markup: mainMenu(l) });
    return;
  }

  if (act === "zn:about") {
    await bot.api.sendMessage(chatId, t.about, { reply_markup: mainMenu(l) });
    return;
  }

  if (act === "zn:stats" && id === ownerId) {
    const r = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM zenobia_user WHERE bot_id=$1`, botId)) as { n: number }[];
    await bot.api.sendMessage(chatId, t.owner(Number(r[0]?.n ?? 0)));
    return;
  }

  if (!cq) await bot.api.sendMessage(chatId, t.welcome, { reply_markup: mainMenu(l) });
}
