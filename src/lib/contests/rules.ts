/**
 * «مسابقات الجروبات» (2026-11-10): sponsored group quiz contests with a weekly cross-group leaderboard.
 * Free to play, no entry fee, no bets; prizes are funded only by sponsors. Pure rules.
 */
import { QUESTIONS } from "@/lib/contests/questions";

export const CONTEST_CMD = /^\/(contest|مسابقة)(@[A-Za-z0-9_]+)?(\s|$)/i;
export const TOP_CMD = /^\/(top|الصدارة)(@[A-Za-z0-9_]+)?(\s|$)/i;
export const ROUND_SIZE = 5;
export const POINTS_CORRECT = 10;
export const FIRST_BONUS = 5; // first correct answer on a question
export const MENU_BUTTON = "🏆 مسابقات الجروبات";

/** Picks ROUND_SIZE question indexes not asked recently in this group, deterministic for a given random source. */
export function pickQuestions(recent: number[], rand: () => number = Math.random, size = ROUND_SIZE): number[] {
  const avoid = new Set(recent);
  let pool = QUESTIONS.map((_, i) => i).filter((i) => !avoid.has(i));
  if (pool.length < size) pool = QUESTIONS.map((_, i) => i);
  const out: number[] = [];
  while (out.length < size && pool.length) {
    const k = Math.floor(rand() * pool.length);
    out.push(pool[k]);
    pool.splice(k, 1);
  }
  return out;
}

/** callback_data cq|<roundId>|<step>|<choice>. */
export function parseAnswer(data: string): { roundId: string; step: number; choice: number } | null {
  const m = /^cq\|(\d{1,12})\|(\d)\|([0-3])$/.exec(String(data || ""));
  return m ? { roundId: m[1], step: Number(m[2]), choice: Number(m[3]) } : null;
}
/** callback_data cm|<roundId>: «🎯 نقاطي», answered with an ephemeral reply only the presser sees. */
export const parseMine = (data: string) => /^cm\|(\d{1,12})$/.exec(String(data || ""))?.[1] || null;
export const MINE_BUTTON = "🎯 نقاطي (سرّي)";
export function minePointsText(points: number, answered: number, right: number, step: number): string {
  if (!answered) return "لم تجب على أي سؤال في هذه الجولة بعد.";
  return `🎯 حسابك في هذه الجولة (يراه أنت فقط)\nالنقاط: ${points}\nأجبت على ${answered} من ${Math.min(step + 1, ROUND_SIZE)} · الصحيح حتى الآن: ${right}`;
}
export const AGAIN_DATA = "cr";
/** The line shown where a sponsor would be when the slot is free (honest: it is advertising space, nothing is promised about returns). Pure. */
export function sponsorCta(price: number, days: number, url: string): string {
  return `📣 مساحة إعلانية متاحة: ارعَ مسابقات الجروبات (${price}$ لمدة ${days} أيام) فيظهر اسمك وجائزتك في كل جولة ولوحة الصدارة.\n${url}`;
}
/** Buttons under the results and /top: play again, bring the bot to another group, book the sponsor slot. */
export function resultsKeyboard(botUsername: string, sponsorUrl: string) {
  return [
    [{ text: "🔁 جولة جديدة", callback_data: AGAIN_DATA }, { text: "📊 الصدارة", callback_data: "ct" }],
    [{ text: "➕ أضف البوت لجروبك", url: `https://t.me/${botUsername}?startgroup=contest` }],
    [{ text: "🎁 ارعَ المسابقات", url: sponsorUrl }],
  ];
}
export const parseNext = (data: string) => /^cn\|(\d{1,12})$/.exec(String(data || ""))?.[1] || null;

export function scoreFor(correct: boolean, firstCorrect: boolean): number {
  return correct ? POINTS_CORRECT + (firstCorrect ? FIRST_BONUS : 0) : 0;
}

export function questionText(step: number, qIndex: number, answered: number): string {
  const q = QUESTIONS[qIndex];
  return `🏆 السؤال ${step + 1} من ${ROUND_SIZE} · ${q.cat}\n\n${q.q}\n\n👥 أجاب ${answered}. أول إجابة صحيحة تأخذ ${POINTS_CORRECT + FIRST_BONUS} نقطة، وكل إجابة صحيحة ${POINTS_CORRECT}.`;
}

export function questionKeyboard(roundId: string, step: number, qIndex: number) {
  const q = QUESTIONS[qIndex];
  return [
    [{ text: q.o[0], callback_data: `cq|${roundId}|${step}|0` }, { text: q.o[1], callback_data: `cq|${roundId}|${step}|1` }],
    [{ text: q.o[2], callback_data: `cq|${roundId}|${step}|2` }, { text: q.o[3], callback_data: `cq|${roundId}|${step}|3` }],
    [{ text: MINE_BUTTON, callback_data: `cm|${roundId}` }],
    [{ text: step + 1 < ROUND_SIZE ? "▶️ السؤال التالي (للمشرف)" : "🏁 النتيجة (للمشرف)", callback_data: `cn|${roundId}` }],
  ];
}

export function revealText(step: number, qIndex: number, correctCount: number, total: number): string {
  const q = QUESTIONS[qIndex];
  return `✅ السؤال ${step + 1}: ${q.q}\nالإجابة: ${q.o[q.a]} · أصاب ${correctCount} من ${total}`;
}

export type Row = { name: string; points: number };
export function resultsText(rows: Row[], groupRank: number | null, sponsor: string | null, cta: string | null = null): string {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.slice(0, 10).map((r, i) => `${medals[i] || `${i + 1}.`} ${r.name}: ${r.points}`);
  const out = ["🏁 انتهت الجولة!", "", ...(lines.length ? lines : ["لم يجب أحد هذه المرة."])];
  if (groupRank) out.push("", `📊 ترتيب جروبكم هذا الأسبوع بين كل الجروبات: ${groupRank}`);
  if (sponsor) out.push("", `🎁 ${sponsor}`);
  else if (cta) out.push("", cta);
  out.push("", "جولة جديدة: /contest · لوحة الصدارة: /top");
  return out.join("\n");
}

/** Week starts Monday 00:00 UTC. */
export function weekStart(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}
