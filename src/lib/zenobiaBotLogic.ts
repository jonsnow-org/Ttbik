import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
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

export const COMMANDS = ["start", "journey", "checkin", "top", "invite", "link", "stages", "lang", "about"] as const;

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
    btn: { journey: "🗺 My journey", checkin: "✅ Check-in", top: "🏆 Leaderboard", invite: "👥 Invite friends", link: "🔗 Wallet", stages: "👑 Stages", about: "ℹ️ About", lang: "🌐 العربية" },
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
    ref: (l: string) => `👥 Invite friends\n\nYour link:\n${l}\n\nEach friend who joins gives you +5 points.`,
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
      "🏛 أهلًا بك في قافلة زنوبيا.\n\nزنوبيا ملكة تدمر: تاريخ حقيقي ولعبة أسبوعية شفافة على TON.\n\n• سجّل حضورك يوميًا لتبني سلسلتك\n• ادعُ أصدقاءك برابطك\n• شاهد جوازك يكبر من طفلة إلى ملكة ثم محاربة\n\nالنقاط ترتيب وألقاب فقط، وليست وعدًا بأي مقابل. ليست نصيحة مالية.",
    btn: { journey: "🗺 رحلتي", checkin: "✅ حضور اليوم", top: "🏆 الصدارة", invite: "👥 ادعُ صديقًا", link: "🔗 المحفظة", stages: "👑 المراحل", about: "ℹ️ عن زنوبيا", lang: "🌐 English" },
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
    ref: (l: string) => `👥 ادعُ أصدقاءك\n\nرابطك:\n${l}\n\nكل صديق ينضم يمنحك +5 نقاط.`,
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
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS zenobia_user (
          bot_id TEXT NOT NULL, tg_user_id TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
          name TEXT, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), points INT NOT NULL DEFAULT 0,
          streak INT NOT NULL DEFAULT 0, last_checkin DATE, ref_by TEXT, wallet TEXT,
          wallet_verified BOOLEAN NOT NULL DEFAULT false, panel_msg_id BIGINT, PRIMARY KEY (bot_id, tg_user_id))`,
      )
      .then(() => prisma.$executeRawUnsafe(`ALTER TABLE zenobia_user ADD COLUMN IF NOT EXISTS panel_msg_id BIGINT`))
      .then(() => undefined)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

interface UserRow { panel_msg_id: string | number | null; lang: Lang; name: string | null; joined_at: Date; points: number; streak: number; last_checkin: Date | null; wallet: string | null }

async function getUser(botId: string, id: string): Promise<UserRow | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT panel_msg_id, lang, name, joined_at, points, streak, last_checkin, wallet FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2`, botId, id,
  )) as UserRow[];
  return rows[0] ?? null;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86400000);
const dayStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** The persistent menu at the bottom of the screen (stays across messages). */
function menuKeyboard(l: Lang): Keyboard {
  const b = T[l].btn;
  return new Keyboard()
    .text(b.journey).text(b.checkin).row()
    .text(b.top).text(b.invite).row()
    .text(b.link).text(b.stages).row()
    .text(b.about).text(b.lang)
    .resized().persistent();
}

const ACT_BY_LABEL: Record<string, string> = {};
for (const lg of ["en", "ar"] as Lang[]) {
  const b = T[lg].btn;
  Object.assign(ACT_BY_LABEL, { [b.journey]: "zn:journey", [b.checkin]: "zn:checkin", [b.top]: "zn:top", [b.invite]: "zn:invite", [b.link]: "zn:link", [b.stages]: "zn:stages", [b.about]: "zn:about", [b.lang]: "zn:lang" });
}

interface Panel { text: string; photo?: string; kb?: InlineKeyboard | Keyboard }
/**
 * One panel message per person: the previous panel is deleted and the new one sent, so the chat never piles up.
 * The person's own button/command message is removed too.
 */
async function sendPanel(bot: TelegramBot, chatId: number, botId: string, id: string, prev: string | number | null, p: Panel, trigger?: number): Promise<void> {
  if (prev) await bot.api.deleteMessage(chatId, Number(prev)).catch(() => null);
  if (trigger) await bot.api.deleteMessage(chatId, trigger).catch(() => null);
  let sent: { message_id: number };
  if (p.photo) {
    try {
      sent = await bot.api.sendPhoto(chatId, p.photo, { caption: p.text, reply_markup: p.kb });
    } catch {
      sent = await bot.api.sendMessage(chatId, p.text, { reply_markup: p.kb });
    }
  } else {
    sent = await bot.api.sendMessage(chatId, p.text, { reply_markup: p.kb });
  }
  await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET panel_msg_id=$3 WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, sent.message_id);
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
  const trigger: number | undefined = msg?.message_id;
  const prev = user.panel_msg_id;
  const panel = (p: Panel) => sendPanel(bot, chatId, botId, id, prev, p, trigger);
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

  const welcome = (lang: Lang) => ({ text: T[lang].welcome, kb: menuKeyboard(lang) });

  if (act === "zn:start") {
    // the first panel carries the persistent menu, which then stays at the bottom of the screen
    await sendPanel(bot, chatId, botId, id, prev, welcome(l), trigger);
    return;
  }

  if (act === "zn:lang") {
    const to: Lang = l === "en" ? "ar" : "en";
    await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET lang=$3 WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, to);
    await sendPanel(bot, chatId, botId, id, prev, welcome(to), trigger);
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
    const arg = !cq && text.startsWith("/") ? text.split(/\s+/)[1] : "";
    if (!arg) {
      await panel({ text: t.link });
      return;
    }
    try {
      const friendly = Address.parse(arg).toString({ bounceable: false });
      await prisma.$executeRawUnsafe(`UPDATE zenobia_user SET wallet=$3, wallet_verified=false WHERE bot_id=$1 AND tg_user_id=$2`, botId, id, friendly);
      await panel({ text: t.linkOk(friendly) });
    } catch {
      await panel({ text: t.linkBad });
    }
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
    await panel({ text: t.about });
    return;
  }

  if (act === "zn:stats" && id === ownerId) {
    const r = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM zenobia_user WHERE bot_id=$1`, botId)) as { n: number }[];
    await panel({ text: t.owner(Number(r[0]?.n ?? 0)) });
    return;
  }

  if (!cq) await panel(welcome(l));
}
