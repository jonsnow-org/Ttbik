/**
 * «🌙 بطاقة اليوم» on the chains bot (STREAK_BOT, @Slaselbot): one card that changes every day, so there is a reason to come back tomorrow.
 *   - the Hijri and Gregorian date,
 *   - the day's prayer times for the user's own city (offline, src/lib/prayerCalc.ts) and how long until the next one,
 *   - «سؤال اليوم»: one question from the contest bank, one attempt a day; a right answer is the day's check-in of a fifth chain, «🧠 سؤال اليوم».
 * No new table: the city and the day's attempt live in bot_settings (`streak_city:<user>`, `streak_tq:<user>`). Free, nothing promised.
 */
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { QUESTIONS } from "@/lib/contests/questions";
import { PRAYER_CITIES, getPrayerCity, type PrayerCity } from "@/lib/prayerCities";
import { PRAYER_LABELS, computePrayerTimes, gregorianLabel, hijriLabel } from "@/lib/prayerCalc";
import { checkInCore, ensureStreakUser } from "@/lib/streakBotLogic";

export const QUIZ_CATEGORY = { id: "quiz", emoji: "🧠", title: "سؤال اليوم" } as const;

const dayNumber = (d = new Date()) => Math.floor(d.getTime() / 86_400_000);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The question of a UTC day: a fixed walk through the bank that visits every question before repeating. Pure. */
export function questionIndexForDay(day: number, total = QUESTIONS.length): number {
  const stride = [17, 13, 11, 7, 5, 3, 1].find((s) => gcd(s, total) === 1) || 1;
  return ((day * stride) % total + total) % total;
}

export function countdownLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} س ${r} د` : `${r} د`;
}

export const COUNTRIES = [...new Set(PRAYER_CITIES.map((c) => c.countryAr))];

// --- per-user state in bot_settings (no migration)
const cityKey = (u: string) => `streak_city:${u}`;
const attemptKey = (u: string) => `streak_tq:${u}`;
async function getSetting(key: string): Promise<unknown> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", key).maybeSingle();
    return (data as { value?: unknown } | null)?.value ?? null;
  } catch {
    return null;
  }
}
async function putSetting(key: string, value: unknown): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    await supabaseAdmin().from("bot_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  } catch {
    /* the card still works without a saved city */
  }
}
export async function userCity(userId: string): Promise<PrayerCity | null> {
  const slug = await getSetting(cityKey(userId));
  return typeof slug === "string" ? getPrayerCity(slug) || null : null;
}
type Attempt = { day: number; choice: number };
async function todaysAttempt(userId: string, day: number): Promise<Attempt | null> {
  const v = (await getSetting(attemptKey(userId))) as Partial<Attempt> | null;
  return v && v.day === day && typeof v.choice === "number" ? (v as Attempt) : null;
}

export type TodayView = { text: string; keyboard: InlineKeyboard };

/** The card. Pure given its inputs. */
export function todayView(opts: { now: Date; city: PrayerCity | null; attempt: Attempt | null; quizStreak: number }): TodayView {
  const { now, city, attempt, quizStreak } = opts;
  const tz = city?.tz || "Asia/Riyadh";
  const day = dayNumber(now);
  const qi = questionIndexForDay(day);
  const q = QUESTIONS[qi];
  const lines = [`🌙 بطاقة اليوم`, "", `📅 ${hijriLabel(now, tz)}`, `🗓 ${gregorianLabel(now, tz)}`, ""];
  if (city) {
    const p = computePrayerTimes(city, now);
    lines.push(`🕌 مواقيت الصلاة — ${city.nameAr}`);
    for (const name of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const) lines.push(`${name === p.next ? "👉 " : "• "}${PRAYER_LABELS[name]}: ${p.times[name].label}`);
    lines.push(`⏳ القادمة ${PRAYER_LABELS[p.next]} بعد ${countdownLabel(p.nextDate.getTime() - now.getTime())}`, "");
  } else {
    lines.push("🕌 اختر مدينتك لتظهر لك مواقيت الصلاة كل يوم.", "");
  }
  lines.push(`🧠 سؤال اليوم · ${q.cat}`, q.q);
  const kb = new InlineKeyboard();
  if (attempt) {
    const right = attempt.choice === q.a;
    lines.push("", right ? `✅ أجبت اليوم: «${q.o[q.a]}» — صحيح! 🔥 سلسلتك ${quizStreak} يوم` : `❌ إجابتك «${q.o[attempt.choice]}». الصحيح: «${q.o[q.a]}». سؤال جديد غدًا.`);
  } else {
    lines.push("", "محاولة واحدة في اليوم، والإجابة الصحيحة تُسجَّل سلسلتك 🔥");
    q.o.forEach((o, i) => { kb.text(o, `tq|${day}|${i}`); if (i % 2 === 1) kb.row(); });
  }
  kb.text(city ? "📍 غيّر المدينة" : "📍 اختر مدينتك", "tcc");
  return { text: lines.join("\n"), keyboard: kb };
}

export const countryKeyboard = () => {
  const kb = new InlineKeyboard();
  COUNTRIES.forEach((c, i) => { kb.text(c, `tcc|${i}`); if (i % 2 === 1) kb.row(); });
  return kb;
};
export const citiesKeyboard = (countryIdx: number) => {
  const kb = new InlineKeyboard();
  PRAYER_CITIES.filter((c) => c.countryAr === COUNTRIES[countryIdx]).forEach((c, i) => { kb.text(c.nameAr, `tcp|${c.slug}`); if (i % 2 === 1) kb.row(); });
  return kb.row().text("◀️ رجوع", "tcc");
};

async function quizStreakOf(userId: string): Promise<number> {
  const e = await prisma.streakEntry.findUnique({ where: { userId_category: { userId, category: QUIZ_CATEGORY.id } } }).catch(() => null);
  return e?.currentStreak || 0;
}

export async function sendToday(bot: TelegramBot, chatId: number, userId: string, now = new Date()): Promise<void> {
  const [city, attempt, qs] = await Promise.all([userCity(userId), todaysAttempt(userId, dayNumber(now)), quizStreakOf(userId)]);
  const v = todayView({ now, city, attempt, quizStreak: qs });
  await bot.api.sendMessage(chatId, v.text, { reply_markup: v.keyboard });
}

async function redraw(bot: TelegramBot, cq: any, userId: string): Promise<void> {
  const now = new Date();
  const [city, attempt, qs] = await Promise.all([userCity(userId), todaysAttempt(userId, dayNumber(now)), quizStreakOf(userId)]);
  const v = todayView({ now, city, attempt, quizStreak: qs });
  const chat = cq.message?.chat?.id, mid = cq.message?.message_id;
  if (chat && mid) await bot.api.editMessageText(chat, mid, v.text, { reply_markup: v.keyboard }).catch(() => null);
}

/** Callbacks of the card: tq|<day>|<choice> (answer), tcc / tcc|<country> (cities), tcp|<slug> (pick). Returns true when it was one of them. */
export async function handleTodayCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const data = String(cq?.data || "");
  if (!/^(tq|tcc|tcp)(\||$)/.test(data)) return false;
  const userId = String(cq.from?.id || "");
  const toast = (text?: string, alert = false) => bot.api.answerCallbackQuery(cq.id, text ? { text, show_alert: alert } : undefined).catch(() => null);
  if (!userId) { await toast(); return true; }
  const user = await ensureStreakUser(botRow.id, userId);
  if (user.isBanned) { await toast("غير متاح لك."); return true; }
  const chat = cq.message?.chat?.id, mid = cq.message?.message_id;

  if (data === "tcc") {
    await toast();
    if (chat && mid) await bot.api.editMessageText(chat, mid, "📍 اختر دولتك:", { reply_markup: countryKeyboard() }).catch(() => null);
    return true;
  }
  const mCountry = /^tcc\|(\d{1,2})$/.exec(data);
  if (mCountry) {
    const i = Number(mCountry[1]);
    await toast();
    if (COUNTRIES[i] && chat && mid) await bot.api.editMessageText(chat, mid, `📍 اختر مدينتك في ${COUNTRIES[i]}:`, { reply_markup: citiesKeyboard(i) }).catch(() => null);
    return true;
  }
  const mCity = /^tcp\|([a-z-]{2,20})$/.exec(data);
  if (mCity) {
    const city = getPrayerCity(mCity[1]);
    if (!city) { await toast("مدينة غير معروفة."); return true; }
    await putSetting(cityKey(userId), city.slug);
    await toast(`✅ ${city.nameAr}`);
    await redraw(bot, cq, userId);
    return true;
  }
  const mAns = /^tq\|(\d{4,6})\|([0-3])$/.exec(data);
  if (!mAns) { await toast(); return true; }
  const day = dayNumber();
  if (Number(mAns[1]) !== day) { await toast("هذا سؤال يوم سابق."); await redraw(bot, cq, userId); return true; }
  if (await todaysAttempt(userId, day)) { await toast("أجبت على سؤال اليوم بالفعل."); await redraw(bot, cq, userId); return true; }
  const choice = Number(mAns[2]);
  await putSetting(attemptKey(userId), { day, choice });
  const q = QUESTIONS[questionIndexForDay(day)];
  if (choice === q.a) {
    const r = await checkInCore(botRow.id, userId, QUIZ_CATEGORY.id).catch(() => null);
    await toast(r ? `✅ صحيح! سلسلتك ${r.entry.currentStreak} يوم` : "✅ صحيح!");
  } else {
    await toast(`❌ الصحيح: ${q.o[q.a]}`, true);
  }
  await redraw(bot, cq, userId);
  return true;
}
