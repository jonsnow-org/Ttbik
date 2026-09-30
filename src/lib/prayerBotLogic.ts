import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit, countBotVisitors } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";

/**
 * PRAYER_BOT template (docs/claude-feature-backlog.md item 6) — prayer times
 * and a daily dhikr reminder. Times are computed fully offline from the
 * city's coordinates with the standard solar-position formulas (no
 * third-party API, no ongoing cost). Cities are a fixed list defined in code
 * (PRAYER_CITIES); the user picks one and it is remembered. An opt-in daily
 * message (src/app/api/cron/prayer-reminders) sends that day's times + a dhikr.
 *
 * A brand-new, fully isolated template: no shared tables or logic with any
 * other bot on the platform.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";

// ---------------------------------------------------------------------
// Cities — static list. `method` picks the Fajr/Isha convention used
// locally: MWL (18°/17°), EGYPT (19.5°/17.5°), MAKKAH (18.5°, Isha = 90
// min after Maghrib).
// ---------------------------------------------------------------------
type Method = "MWL" | "EGYPT" | "MAKKAH";
type PrayerCity = { id: string; name: string; lat: number; lng: number; tz: string; method: Method };

export const PRAYER_CITIES: PrayerCity[] = [
  { id: "makkah", name: "مكة المكرمة", lat: 21.4225, lng: 39.8262, tz: "Asia/Riyadh", method: "MAKKAH" },
  { id: "madinah", name: "المدينة المنورة", lat: 24.4672, lng: 39.6111, tz: "Asia/Riyadh", method: "MAKKAH" },
  { id: "riyadh", name: "الرياض", lat: 24.7136, lng: 46.6753, tz: "Asia/Riyadh", method: "MAKKAH" },
  { id: "jeddah", name: "جدة", lat: 21.4858, lng: 39.1925, tz: "Asia/Riyadh", method: "MAKKAH" },
  { id: "damascus", name: "دمشق", lat: 33.5138, lng: 36.2765, tz: "Asia/Damascus", method: "MWL" },
  { id: "aleppo", name: "حلب", lat: 36.2021, lng: 37.1343, tz: "Asia/Damascus", method: "MWL" },
  { id: "amman", name: "عمّان", lat: 31.9454, lng: 35.9284, tz: "Asia/Amman", method: "MWL" },
  { id: "jerusalem", name: "القدس", lat: 31.7683, lng: 35.2137, tz: "Asia/Jerusalem", method: "MWL" },
  { id: "beirut", name: "بيروت", lat: 33.8938, lng: 35.5018, tz: "Asia/Beirut", method: "MWL" },
  { id: "baghdad", name: "بغداد", lat: 33.3152, lng: 44.3661, tz: "Asia/Baghdad", method: "MWL" },
  { id: "kuwait", name: "الكويت", lat: 29.3759, lng: 47.9774, tz: "Asia/Kuwait", method: "MWL" },
  { id: "doha", name: "الدوحة", lat: 25.2854, lng: 51.531, tz: "Asia/Qatar", method: "MAKKAH" },
  { id: "dubai", name: "دبي", lat: 25.2048, lng: 55.2708, tz: "Asia/Dubai", method: "MWL" },
  { id: "muscat", name: "مسقط", lat: 23.588, lng: 58.3829, tz: "Asia/Muscat", method: "MWL" },
  { id: "sanaa", name: "صنعاء", lat: 15.3694, lng: 44.191, tz: "Asia/Aden", method: "MAKKAH" },
  { id: "cairo", name: "القاهرة", lat: 30.0444, lng: 31.2357, tz: "Africa/Cairo", method: "EGYPT" },
  { id: "alexandria", name: "الإسكندرية", lat: 31.2001, lng: 29.9187, tz: "Africa/Cairo", method: "EGYPT" },
  { id: "khartoum", name: "الخرطوم", lat: 15.5007, lng: 32.5599, tz: "Africa/Khartoum", method: "EGYPT" },
  { id: "tripoli", name: "طرابلس", lat: 32.8872, lng: 13.1913, tz: "Africa/Tripoli", method: "EGYPT" },
  { id: "tunis", name: "تونس", lat: 36.8065, lng: 10.1815, tz: "Africa/Tunis", method: "MWL" },
  { id: "algiers", name: "الجزائر", lat: 36.7538, lng: 3.0588, tz: "Africa/Algiers", method: "MWL" },
  { id: "rabat", name: "الرباط", lat: 34.0209, lng: -6.8416, tz: "Africa/Casablanca", method: "MWL" },
  { id: "istanbul", name: "إسطنبول", lat: 41.0082, lng: 28.9784, tz: "Europe/Istanbul", method: "MWL" },
];

export function findCity(id: string | null | undefined): PrayerCity | undefined {
  return PRAYER_CITIES.find((c) => c.id === id);
}
function findCityByName(name: string): PrayerCity | undefined {
  return PRAYER_CITIES.find((c) => c.name === name);
}

// ---------------------------------------------------------------------
// Offline prayer-time computation (PrayTimes.org-style solar formulas).
// ---------------------------------------------------------------------
const DEG = Math.PI / 180;
const sin = (d: number) => Math.sin(d * DEG);
const cos = (d: number) => Math.cos(d * DEG);
const tan = (d: number) => Math.tan(d * DEG);
const fixAngle = (a: number) => ((a % 360) + 360) % 360;
const fixHour = (h: number) => ((h % 24) + 24) % 24;

function sunPosition(jd: number): { decl: number; eqt: number } {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixHour((Math.atan2(cos(e) * sin(L), cos(L)) / DEG) / 15);
  let eqt = q / 15 - RA;
  if (eqt > 12) eqt -= 24;
  if (eqt < -12) eqt += 24;
  const decl = Math.asin(sin(e) * sin(L)) / DEG;
  return { decl, eqt };
}

export type DayTimes = { fajr: number; sunrise: number; dhuhr: number; asr: number; maghrib: number; isha: number };

/** UTC offset (hours) of an IANA timezone at the given instant. */
function tzOffsetHours(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(at);
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(at.getTime() / 1000) * 1000) / 3.6e6;
}

/** The calendar date (Y/M/D) it currently is in the city's timezone. */
function localYmd(city: PrayerCity, at: Date): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: city.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** Prayer times as local decimal hours for a given local calendar date. */
export function computePrayerTimes(city: PrayerCity, y: number, m: number, d: number): DayTimes & { tz: number } {
  const tz = tzOffsetHours(city.tz, new Date(Date.UTC(y, m - 1, d, 12)));
  const jd0 = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5; // 0h UT of that date
  const posAt = (localHour: number) => sunPosition(jd0 + (localHour - tz) / 24);
  const noon = () => 12 + tz - city.lng / 15 - posAt(12).eqt;
  const dhuhr = noon();

  // hours from solar noon until the sun is `angle` degrees below (+) the horizon
  const offset = (angle: number, localHour: number) => {
    const { decl } = posAt(localHour);
    const x = (-sin(angle) - sin(decl) * sin(city.lat)) / (cos(decl) * cos(city.lat));
    return Math.acos(Math.max(-1, Math.min(1, x))) / DEG / 15;
  };
  const before = (angle: number) => {
    let t = dhuhr - 6;
    for (let i = 0; i < 3; i++) t = dhuhr - offset(angle, t);
    return t;
  };
  const after = (angle: number) => {
    let t = dhuhr + 6;
    for (let i = 0; i < 3; i++) t = dhuhr + offset(angle, t);
    return t;
  };

  const fajrAngle = city.method === "EGYPT" ? 19.5 : city.method === "MAKKAH" ? 18.5 : 18;
  const ishaAngle = city.method === "EGYPT" ? 17.5 : 17;
  const sunrise = before(0.833);
  const maghrib = after(0.833);
  // Asr (Shafi'i/majority: shadow = object length + noon shadow)
  const decAsr = posAt(dhuhr + 3).decl;
  const asrAngle = -Math.atan(1 / (1 + tan(Math.abs(city.lat - decAsr)))) / DEG;
  let asr = dhuhr + 3;
  for (let i = 0; i < 3; i++) asr = dhuhr + offset(asrAngle, asr);

  return {
    tz,
    fajr: before(fajrAngle),
    sunrise,
    dhuhr,
    asr,
    maghrib,
    isha: city.method === "MAKKAH" ? maghrib + 1.5 : after(ishaAngle),
  };
}

function fmtTime(hours: number): string {
  let mins = Math.round(fixHour(hours) * 60);
  if (mins >= 1440) mins -= 1440;
  const h24 = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, "0");
  const suffix = h24 >= 12 ? "م" : "ص";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

const PRAYER_LABELS: { key: keyof DayTimes; label: string }[] = [
  { key: "fajr", label: "🌌 الفجر" },
  { key: "sunrise", label: "🌅 الشروق" },
  { key: "dhuhr", label: "☀️ الظهر" },
  { key: "asr", label: "🌤 العصر" },
  { key: "maghrib", label: "🌇 المغرب" },
  { key: "isha", label: "🌙 العشاء" },
];

export function todayTimesText(city: PrayerCity, at: Date = new Date()): string {
  const { y, m, d } = localYmd(city, at);
  const t = computePrayerTimes(city, y, m, d);
  const lines = PRAYER_LABELS.map((p) => `${p.label}: ${fmtTime(t[p.key])}`);
  return `🕌 مواقيت الصلاة في ${city.name}\n📅 ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}\n\n${lines.join("\n")}\n\n(بتوقيت المدينة المحلي)`;
}

function nextPrayerText(city: PrayerCity, at: Date = new Date()): string {
  const prayers = PRAYER_LABELS.filter((p) => p.key !== "sunrise");
  const { y, m, d } = localYmd(city, at);
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    const day = new Date(Date.UTC(y, m - 1, d + dayOffset));
    const t = computePrayerTimes(city, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    for (const p of prayers) {
      const instant = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + (t[p.key] - t.tz) * 3.6e6;
      if (instant > at.getTime()) {
        const mins = Math.max(1, Math.round((instant - at.getTime()) / 60000));
        const rem = mins >= 60 ? `${Math.floor(mins / 60)} ساعة و${mins % 60} دقيقة` : `${mins} دقيقة`;
        return `⏭ الصلاة القادمة في ${city.name}:\n\n${p.label} — ${fmtTime(t[p.key])}\n⏳ بعد ${rem}`;
      }
    }
  }
  return "تعذّر تحديد الصلاة القادمة.";
}

// ---------------------------------------------------------------------
// Dhikr — static list, one per day of the year
// ---------------------------------------------------------------------
const DHIKR: string[] = [
  "سبحان الله وبحمده، سبحان الله العظيم.\n(كلمتان خفيفتان على اللسان، ثقيلتان في الميزان)",
  "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير.",
  "لا حول ولا قوة إلا بالله — كنز من كنوز الجنة.",
  "أستغفر الله العظيم وأتوب إليه.",
  "اللهم صلِّ وسلِّم على نبينا محمد.",
  "حسبي الله لا إله إلا هو عليه توكلت وهو رب العرش العظيم.",
  "اللهم إنك عفوٌّ تحب العفو فاعفُ عنا.",
  "سبحان الله، والحمد لله، ولا إله إلا الله، والله أكبر.",
  "رضيتُ بالله رباً، وبالإسلام ديناً، وبمحمد ﷺ نبياً.",
  "اللهم أعنّي على ذكرك وشكرك وحسن عبادتك.",
  "يا حيّ يا قيوم برحمتك أستغيث، أصلح لي شأني كله ولا تكلني إلى نفسي طرفة عين.",
  "ربنا آتنا في الدنيا حسنة وفي الآخرة حسنة وقنا عذاب النار.",
  "اللهم اهدني وسدّدني.",
  "بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم.",
];

export function dhikrOfTheDay(at: Date = new Date()): string {
  const day = Math.floor(at.getTime() / 86400000);
  return `📿 ذكر اليوم\n\n${DHIKR[day % DHIKR.length]}`;
}

export function dailyReminderText(city: PrayerCity, at: Date = new Date()): string {
  return `${todayTimesText(city, at)}\n\n${dhikrOfTheDay(at)}`;
}

// ---------------------------------------------------------------------
// Types & menus
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "choose_city" }
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_channel" };

function backLabel(): string {
  return "◀️ رجوع";
}
function mainMenu(reminders: boolean): Keyboard {
  return new Keyboard()
    .text("🕌 مواقيت اليوم").text("⏭ الصلاة القادمة").row()
    .text("📿 ذكر اليوم").text("📍 تغيير المدينة").row()
    .text(reminders ? "🔕 إيقاف التذكير اليومي" : "🔔 تفعيل التذكير اليومي").text("ℹ️ معلومات")
    .resized();
}
function cityMenu(): Keyboard {
  const kb = new Keyboard();
  PRAYER_CITIES.forEach((c, i) => {
    kb.text(c.name);
    if (i % 3 === 2) kb.row();
  });
  kb.row().text(backLabel());
  return kb.resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("🔎 بحث عن مستخدم").row()
    .text("📡 قناة الاشتراك الإجباري").text("📢 بث جماعي")
    .resized();
}

// upsert, not findUnique-then-create — avoids the first-message race.
async function ensurePrayerUser(botId: string, tgUserId: string) {
  return prisma.prayerUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.prayerUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function handlePrayerAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensurePrayerUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start" || text.startsWith("/start ")) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت مواقيت الصلاة.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.prayerUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
    const messageText = formatBroadcastText(text);
    let sent = 0;
    for (const r of recipients) {
      try {
        await bot.api.sendMessage(Number(r.id), messageText);
        sent++;
      } catch {}
    }
    await bot.api.sendMessage(chatId, `✅ تم الإرسال إلى ${sent} من أصل ${recipients.length}.`);
    return true;
  }
  if (pending?.mode === "admin_lookup" && text) {
    await setPending(tgUserId, null);
    const targetId = text.replace(/[^0-9]/g, "");
    const user = await prisma.prayerUser.findUnique({ where: { id: targetId } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n📍 المدينة: ${findCity(user.cityId)?.name || "—"}\n🔔 التذكير اليومي: ${user.dailyReminder ? "مفعّل" : "متوقف"}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n\nلحظر/رفع الحظر أرسل: /ban ${targetId} أو /unban ${targetId}`
    );
    return true;
  }
  if (text.startsWith("/ban ") || text.startsWith("/unban ")) {
    const ban = text.startsWith("/ban ");
    const targetId = text.split(" ")[1]?.replace(/[^0-9]/g, "") || "";
    const target = await prisma.prayerUser.findUnique({ where: { id: targetId } });
    if (!target) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await prisma.prayerUser.update({ where: { id: targetId }, data: { isBanned: ban } });
    await bot.api
      .sendMessage(Number(targetId), ban ? "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة." : "✅ تم رفع الحظر عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.")
      .catch(() => null);
    await bot.api.sendMessage(chatId, ban ? "⛔ تم الحظر." : "🔓 تم رفع الحظر.");
    return true;
  }
  if (text === "📊 الإحصائيات") {
    const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
    const [ownUsers, reminders, banned] = await Promise.all([
      prisma.prayerUser.count({ where: { botId: botRow.id, ...notAdmin } }),
      prisma.prayerUser.count({ where: { botId: botRow.id, dailyReminder: true, cityId: { not: null }, ...notAdmin } }),
      prisma.prayerUser.count({ where: { botId: botRow.id, isBanned: true } }),
    ]);
    const users = await countBotVisitors(botRow.id, SUPER_ADMIN_ID, ownUsers);
    await bot.api.sendMessage(chatId, `📊 إحصائيات بوت مواقيت الصلاة\n\n👥 المستخدمون: ${users}\n🚫 المحظورون: ${banned}\n🔔 مفعّلو التذكير اليومي: ${reminders}`);
    return true;
  }
  if (text === "🔎 بحث عن مستخدم") {
    await setPending(tgUserId, { mode: "admin_lookup" });
    await bot.api.sendMessage(chatId, "أرسل آيدي المستخدم:");
    return true;
  }
  if (text === "📡 قناة الاشتراك الإجباري") {
    await setPending(tgUserId, { mode: "admin_channel" });
    await bot.api.sendMessage(chatId, "أرسل معرّف القناة (@channel)، أو اضغط تخطّي لإلغاء الاشتراط الحالي:", { reply_markup: new Keyboard().text("⏭ تخطّي").resized() });
    return true;
  }
  if (pending?.mode === "admin_channel" && text) {
    await setPending(tgUserId, null);
    const skip = text === "⏭ تخطّي";
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: skip ? null : text.replace(/^@/, "") } });
    await bot.api.sendMessage(chatId, skip ? "✅ تم إلغاء اشتراط الاشتراك الإجباري." : `✅ تم تعيين قناة الاشتراك الإجباري: @${text.replace(/^@/, "")}`);
    return true;
  }
  if (text === "📢 بث جماعي") {
    await setPending(tgUserId, { mode: "admin_broadcast" });
    await bot.api.sendMessage(chatId, `✍️ اكتب رسالة البث الجماعي — ستُرسل لجميع مستخدمي البوت:\n\n${BROADCAST_COMPOSE_HINT}`);
    return true;
  }
  await bot.api.sendMessage(chatId, "🛠 اختر من لوحة التحكم بالأسفل.", { reply_markup: adminMenu() });
  return true; // super admin's own chat never falls through to the regular flow
}

// ---------------------------------------------------------------------
// Regular flow
// ---------------------------------------------------------------------
export async function handlePrayerBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (await handlePrayerAdmin(bot, botRow, msg)) return;

  const user = await ensurePrayerUser(botRow.id, tgUserId);
  await prisma.prayerUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }

  // Mandatory subscription channel gate (same pattern as the other templates).
  if (botRow.requiredChannel) {
    try {
      const member = await bot.api.getChatMember(`@${botRow.requiredChannel}`, Number(tgUserId));
      if (!["creator", "administrator", "member"].includes(member.status)) {
        await bot.api.sendMessage(chatId, `📡 يجب الاشتراك في القناة أولاً: @${botRow.requiredChannel}`);
        return;
      }
    } catch {
      // channel/bot admin misconfigured — fail open rather than lock everyone out
    }
  }

  const text = String(msg.text || "").trim();
  if (!text) return;

  const pending = user.pendingAction as PendingAction | null;
  const city = findCity(user.cityId);
  const menu = () => mainMenu(user.dailyReminder);

  if (text === backLabel()) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: menu() });
    return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await recordBotVisit(botRow.id, tgUserId);
    if (!city) {
      await setPending(tgUserId, { mode: "choose_city" });
      await bot.api.sendMessage(chatId, "🕌 أهلاً بك في بوت مواقيت الصلاة!\n\nاختر مدينتك لأعرض لك مواقيت الصلاة بدقة:", { reply_markup: cityMenu() });
      return;
    }
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, `🕌 أهلاً بك من جديد! مدينتك: ${city.name}`, { reply_markup: menu() });
    return;
  }

  if (text === "📍 تغيير المدينة" || (pending?.mode === "choose_city" && !findCityByName(text))) {
    await setPending(tgUserId, { mode: "choose_city" });
    await bot.api.sendMessage(chatId, "📍 اختر مدينتك:", { reply_markup: cityMenu() });
    return;
  }

  const chosen = findCityByName(text);
  if (chosen && pending?.mode === "choose_city") {
    await prisma.prayerUser.update({ where: { id: tgUserId }, data: { cityId: chosen.id, pendingAction: null as any } });
    await bot.api.sendMessage(chatId, `✅ تم اختيار ${chosen.name}.\n\n${todayTimesText(chosen)}`, { reply_markup: menu() });
    return;
  }

  if (!city) {
    await setPending(tgUserId, { mode: "choose_city" });
    await bot.api.sendMessage(chatId, "اختر مدينتك أولاً:", { reply_markup: cityMenu() });
    return;
  }

  if (text === "🕌 مواقيت اليوم") {
    await bot.api.sendMessage(chatId, todayTimesText(city), { reply_markup: menu() });
    return;
  }
  if (text === "⏭ الصلاة القادمة") {
    await bot.api.sendMessage(chatId, nextPrayerText(city), { reply_markup: menu() });
    return;
  }
  if (text === "📿 ذكر اليوم") {
    await bot.api.sendMessage(chatId, dhikrOfTheDay(), { reply_markup: menu() });
    return;
  }
  if (text === "🔔 تفعيل التذكير اليومي" || text === "🔕 إيقاف التذكير اليومي") {
    const on = text === "🔔 تفعيل التذكير اليومي";
    await prisma.prayerUser.update({ where: { id: tgUserId }, data: { dailyReminder: on } });
    await bot.api.sendMessage(
      chatId,
      on ? "🔔 تم التفعيل — سأرسل لك كل صباح مواقيت اليوم مع ذكر." : "🔕 تم إيقاف التذكير اليومي.",
      { reply_markup: mainMenu(on) }
    );
    return;
  }

  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    const info =
      `ℹ️ بوت مواقيت الصلاة\n\n` +
      `• مواقيت الصلاة لمدينتك تُحسب مباشرة من إحداثياتها (بدون أي خدمة خارجية).\n` +
      `• «⏭ الصلاة القادمة» يخبرك بالوقت المتبقي.\n` +
      `• فعّل التذكير اليومي لتصلك المواقيت مع ذكر كل صباح.\n` +
      `• المدينة الحالية: ${city.name}\n\n` +
      `⚠️ الحساب تقريبي ويمكن أن يختلف دقيقة أو دقيقتين عن تقويم مسجدك المحلي.\n\n` +
      `📲 شارك البوت: https://t.me/${me.username}`;
    await bot.api.sendMessage(chatId, info, { reply_markup: menu() });
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: menu() });
}
