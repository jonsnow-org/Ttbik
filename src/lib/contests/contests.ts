/**
 * Group contests on the existing @Slaselbot (STREAK_BOT, already wired for groups by the khatma).
 * The bot answers in a group only to /contest, /top, /start contest and taps on its own buttons.
 * Own tables, created on first use.
 */
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeSponsor } from "@/lib/khatma/khatma";
import { QUESTIONS } from "@/lib/contests/questions";
import {
  CONTEST_CMD, FIRST_BONUS, POINTS_CORRECT, ROUND_SIZE, TOP_CMD, parseAnswer, parseNext, pickQuestions, questionKeyboard, questionText, resultsText, revealText, weekStart,
} from "@/lib/contests/rules";

let ready: Promise<void> | null = null;
export function ensureContestTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS contest_rounds (id BIGSERIAL PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, chat_title TEXT, chat_username TEXT, questions INT[] NOT NULL, step INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', started_by TEXT, message_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)`,
        `CREATE INDEX IF NOT EXISTS contest_rounds_chat_idx ON contest_rounds (bot_id, chat_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS contest_answers (round_id BIGINT NOT NULL, step INT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, choice INT NOT NULL, correct BOOLEAN NOT NULL, points INT NOT NULL DEFAULT 0, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (round_id, step, user_id))`,
      ];
      for (const q of ddl) await prisma.$executeRawUnsafe(q);
      // Group round/answer rows are read and written by the existing server-side bot only.
      const security = [
        `ALTER TABLE contest_rounds ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE contest_answers ENABLE ROW LEVEL SECURITY`,
        `REVOKE ALL ON TABLE contest_rounds, contest_answers FROM anon, authenticated`,
      ];
      for (const q of security) await prisma.$executeRawUnsafe(q);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

type Round = { id: bigint; bot_id: string; chat_id: string; chat_title: string | null; questions: number[]; step: number; status: string; started_by: string | null; message_id: bigint | null; created_at: Date };
const ROUND_TTL_MS = 30 * 60_000;
const name = (from: any) => String([from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || "لاعب").replace(/[<>]/g, "").slice(0, 24);

async function liveRound(botId: string, chatId: string): Promise<Round | null> {
  const r = await prisma.$queryRaw<Round[]>`SELECT * FROM contest_rounds WHERE bot_id = ${botId} AND chat_id = ${chatId} AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`;
  const x = r[0];
  if (!x) return null;
  if (Date.now() - x.created_at.getTime() > ROUND_TTL_MS) {
    await prisma.$executeRaw`UPDATE contest_rounds SET status = 'EXPIRED', finished_at = now() WHERE id = ${x.id}`;
    return null;
  }
  return x;
}

async function isGroupAdmin(bot: TelegramBot, chatId: number | string, userId: number) {
  const m = await bot.api.getChatMember(chatId, userId).catch(() => null);
  return !!m && ["creator", "administrator"].includes(m.status);
}

async function postQuestion(bot: TelegramBot, r: Round, chatId: number | string) {
  const qi = r.questions[r.step];
  const m = await bot.api.sendMessage(chatId, questionText(r.step, qi, 0), { reply_markup: { inline_keyboard: questionKeyboard(String(r.id), r.step, qi) } });
  await prisma.$executeRaw`UPDATE contest_rounds SET message_id = ${m.message_id} WHERE id = ${r.id}`;
}

export async function weeklyGroups(botId?: string) {
  await ensureContestTables();
  const since = weekStart();
  const byBot = botId ? Prisma.sql`AND r.bot_id = ${botId}` : Prisma.empty;
  return prisma.$queryRaw<{ chat_id: string; title: string | null; username: string | null; points: bigint; players: bigint }[]>`
    SELECT r.chat_id, max(r.chat_title) title, max(r.chat_username) username, COALESCE(sum(a.points),0) points, count(DISTINCT a.user_id) players
    FROM contest_rounds r JOIN contest_answers a ON a.round_id = r.id
    WHERE r.created_at >= ${since} ${byBot}
    GROUP BY r.chat_id ORDER BY points DESC LIMIT 100`;
}

async function groupRank(chatId: string): Promise<number | null> {
  const rows = await weeklyGroups();
  const i = rows.findIndex((r) => r.chat_id === chatId);
  return i >= 0 ? i + 1 : null;
}

async function startRound(bot: TelegramBot, botRow: BotRow, msg: any) {
  const chatId = String(msg.chat.id);
  const live = await liveRound(botRow.id, chatId);
  if (live) {
    await bot.api.sendMessage(msg.chat.id, "في جولة شغّالة الآن، أكملوها أولاً 👆", { reply_to_message_id: live.message_id ? Number(live.message_id) : undefined }).catch(() => null);
    return;
  }
  const recentRows = await prisma.$queryRaw<{ questions: number[] }[]>`SELECT questions FROM contest_rounds WHERE bot_id = ${botRow.id} AND chat_id = ${chatId} ORDER BY id DESC LIMIT 8`;
  const qs = pickQuestions(recentRows.flatMap((r) => r.questions));
  const created = await prisma.$queryRaw<Round[]>`
    INSERT INTO contest_rounds (bot_id, chat_id, chat_title, chat_username, questions, started_by)
    VALUES (${botRow.id}, ${chatId}, ${String(msg.chat.title || "").slice(0, 80)}, ${msg.chat.username || null}, ${qs}::int[], ${String(msg.from.id)}) RETURNING *`;
  const sponsor = await activeSponsor("contest").catch(() => null);
  await bot.api.sendMessage(msg.chat.id, `🏆 جولة جديدة من ${ROUND_SIZE} أسئلة! اختاروا الإجابة بالأزرار.${sponsor ? `\n🎁 ${sponsor}` : ""}`).catch(() => null);
  await postQuestion(bot, created[0], msg.chat.id);
}

async function sendTop(bot: TelegramBot, botRow: BotRow, chatId: number | string) {
  const rows = await weeklyGroups(botRow.id);
  const mine = rows.findIndex((r) => r.chat_id === String(chatId));
  const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.username ? r.title || "جروب" : "جروب خاص"} · ${Number(r.points)} نقطة`);
  const sponsor = await activeSponsor("contest").catch(() => null);
  await bot.api.sendMessage(chatId, [
    "📊 صدارة الجروبات هذا الأسبوع", "", ...(lines.length ? lines : ["لا نقاط بعد هذا الأسبوع. ابدأوا: /contest"]),
    ...(mine >= 0 ? ["", `جروبكم: المركز ${mine + 1}`] : []), ...(sponsor ? ["", `🎁 ${sponsor}`] : []),
  ].join("\n")).catch(() => null);
}

async function handleAnswer(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const p = parseAnswer(String(cq.data || ""));
  if (!p) return false;
  await ensureContestTables();
  const r = (await prisma.$queryRaw<Round[]>`SELECT * FROM contest_rounds WHERE id = ${BigInt(p.roundId)}`)[0];
  const answer = (text: string) => bot.api.answerCallbackQuery(cq.id, { text }).catch(() => null);
  if (!r || r.bot_id !== botRow.id || String(cq.message?.chat?.id) !== r.chat_id || r.status !== "ACTIVE") { await answer("الجولة انتهت."); return true; }
  if (r.step !== p.step) { await answer("هذا سؤال سابق."); return true; }
  const qi = r.questions[r.step];
  const correct = QUESTIONS[qi].a === p.choice;
  const n = await prisma.$executeRaw`
    INSERT INTO contest_answers (round_id, step, user_id, user_name, choice, correct, points)
    VALUES (${r.id}, ${r.step}, ${String(cq.from.id)}, ${name(cq.from)}, ${p.choice}, ${correct},
      CASE WHEN ${correct} THEN ${POINTS_CORRECT} + CASE WHEN EXISTS (SELECT 1 FROM contest_answers WHERE round_id = ${r.id} AND step = ${r.step} AND correct) THEN 0 ELSE ${FIRST_BONUS} END ELSE 0 END)
    ON CONFLICT DO NOTHING`;
  await answer(n === 1 ? "سُجّلت إجابتك ✅ النتيجة عند السؤال التالي." : "أجبت على هذا السؤال من قبل.");
  if (n === 1 && cq.message?.message_id) {
    const c = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM contest_answers WHERE round_id = ${r.id} AND step = ${r.step}`;
    await bot.api.editMessageText(cq.message.chat.id, cq.message.message_id, questionText(r.step, qi, Number(c[0]?.n || 0)), { reply_markup: { inline_keyboard: questionKeyboard(String(r.id), r.step, qi) } }).catch(() => null);
  }
  return true;
}

async function handleNext(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const id = parseNext(String(cq.data || ""));
  if (!id) return false;
  await ensureContestTables();
  const r = (await prisma.$queryRaw<Round[]>`SELECT * FROM contest_rounds WHERE id = ${BigInt(id)}`)[0];
  const chat = cq.message?.chat;
  if (!r || r.bot_id !== botRow.id || String(chat?.id) !== r.chat_id || r.status !== "ACTIVE") { await bot.api.answerCallbackQuery(cq.id, { text: "الجولة انتهت." }).catch(() => null); return true; }
  if (String(cq.from.id) !== r.started_by && !(await isGroupAdmin(bot, chat.id, cq.from.id))) {
    await bot.api.answerCallbackQuery(cq.id, { text: "الانتقال لمن بدأ الجولة أو لمشرفي الجروب." }).catch(() => null);
    return true;
  }
  // Only one press moves the step.
  const moved = await prisma.$executeRaw`UPDATE contest_rounds SET step = step + 1 WHERE id = ${r.id} AND step = ${r.step} AND status = 'ACTIVE'`;
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
  if (moved !== 1) return true;
  const stats = await prisma.$queryRaw<{ total: bigint; right: bigint }[]>`SELECT count(*) total, count(*) FILTER (WHERE correct) "right" FROM contest_answers WHERE round_id = ${r.id} AND step = ${r.step}`;
  if (cq.message?.message_id) await bot.api.editMessageText(chat.id, cq.message.message_id, revealText(r.step, r.questions[r.step], Number(stats[0]?.right || 0), Number(stats[0]?.total || 0))).catch(() => null);
  const next = { ...r, step: r.step + 1 };
  if (next.step < ROUND_SIZE) { await postQuestion(bot, next, chat.id); return true; }
  await prisma.$executeRaw`UPDATE contest_rounds SET status = 'DONE', finished_at = now() WHERE id = ${r.id}`;
  const rows = await prisma.$queryRaw<{ name: string; points: bigint }[]>`SELECT max(user_name) name, sum(points) points FROM contest_answers WHERE round_id = ${r.id} GROUP BY user_id HAVING sum(points) > 0 ORDER BY sum(points) DESC LIMIT 10`;
  const [rank, sponsor] = await Promise.all([groupRank(r.chat_id).catch(() => null), activeSponsor("contest").catch(() => null)]);
  await bot.api.sendMessage(chat.id, resultsText(rows.map((x) => ({ name: x.name, points: Number(x.points) })), rank, sponsor)).catch(() => null);
  return true;
}

/** Returns true when the group update was a contest action. */
export async function handleContestGroupUpdate(bot: TelegramBot, botRow: BotRow, update: any): Promise<boolean> {
  const cq = update.callback_query;
  if (cq) return (await handleAnswer(bot, botRow, cq)) || (await handleNext(bot, botRow, cq));
  const msg = update.message;
  if (!msg?.chat || !msg.from || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) return false;
  const text = String(msg.text || "").trim();
  const viaStart = /^\/start(@[A-Za-z0-9_]+)?\s+contest\b/i.test(text);
  if (!viaStart && !CONTEST_CMD.test(text) && !TOP_CMD.test(text)) return false;
  await ensureContestTables();
  if (TOP_CMD.test(text)) { await sendTop(bot, botRow, msg.chat.id); return true; }
  await startRound(bot, botRow, msg);
  return true;
}

export async function sendContestIntro(bot: TelegramBot, chatId: number, appUrl?: string) {
  const me = await bot.api.getMe().catch(() => null);
  const u = me?.username || "";
  await bot.api.sendMessage(chatId,
    "🏆 مسابقات الجروبات\n\n" +
    "أضف البوت لجروبك فتبدأ جولة من 5 أسئلة (دين، جغرافيا، تاريخ، علوم، لغة). كل إجابة صحيحة 10 نقاط، وأول إجابة صحيحة 15.\n" +
    "نقاط كل الجولات تدخل لوحة صدارة أسبوعية بين كل الجروبات، والجوائز يموّلها الرعاة فقط. اللعب مجاني دائماً.\n\n" +
    `في الجروب: /contest@${u} لجولة جديدة، و/top@${u} للصدارة.`,
    { reply_markup: { inline_keyboard: [
      ...(appUrl ? [[{ text: "📱 الصدارة وجوائزي في التطبيق", web_app: { url: appUrl } }]] : []),
      [{ text: "➕ أضف البوت لجروب", url: `https://t.me/${u}?startgroup=contest` }],
    ] } });
}

export async function contestStats() {
  await ensureContestTables();
  const r = await prisma.$queryRaw<{ rounds: bigint; groups: bigint; players: bigint }[]>`SELECT (SELECT count(*) FROM contest_rounds) rounds, (SELECT count(DISTINCT chat_id) FROM contest_rounds) groups, (SELECT count(DISTINCT user_id) FROM contest_answers) players`;
  return { rounds: Number(r[0]?.rounds || 0), groups: Number(r[0]?.groups || 0), players: Number(r[0]?.players || 0) };
}
