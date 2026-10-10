// Birthday reminders of the Athar bot: a person tells the bot their birthday once; a week before it and on the day itself the bot sends a
// message with a button that opens the token of that date. Only month, day and (optionally) year are kept, with the person's Telegram id,
// in the bot's own table; /birthday off removes them. The columns are added by deploy/oracle/migrations/003_athar_birthday.sql; every
// database call here is guarded, so a missing column can never break the rest of the bot.
import { indexOf, TOTAL_DATES } from "../../athar/lib/rules";

export type BLang = "en" | "ar" | "ru" | "tr" | "fa";
export type Birthday = { month: number; day: number; year: number | null };

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const daysIn = (m: number, y: number | null) => (m === 2 ? (y === null || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** "14/3/2003", "14-3", "2003-03-14", "١٤/٣/٢٠٠٣" ... -> the birthday, or null when it is not a real date. A year outside 1950-2049 is kept out
 *  (there is no token for it) but the reminder still works; a year in the future is refused. */
export function parseBirthday(input: string, now = new Date()): Birthday | null {
  const s = input.replace(/[٠-٩۰-۹]/g, (c) => DIGITS[c]).replace(/[^\d]+/g, " ").trim();
  const p = s.split(" ").filter(Boolean);
  if (p.length < 2 || p.length > 3 || p.some((x) => x.length > 4)) return null;
  let d: number, m: number, y: number | null = null;
  if (p.length === 3) {
    if (p[0].length === 4) { y = Number(p[0]); m = Number(p[1]); d = Number(p[2]); } else { d = Number(p[0]); m = Number(p[1]); y = Number(p[2]); if (p[2].length <= 2) y += y > 30 ? 1900 : 2000; }
  } else { d = Number(p[0]); m = Number(p[1]); }
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1) return null;
  if (y !== null) { if (y < 1900 || y > now.getUTCFullYear()) return null; if (y < 1950 || y > 2049) y = null; }
  if (d > daysIn(m, y)) return null;
  return { month: m, day: d, year: y };
}

/** Days from `now` (UTC date) to the next birthday (0 = today) and the year it falls in. A 29 February birthday is kept on 28 February in a common year. */
export function nextBirthday(b: { month: number; day: number }, now = new Date()): { days: number; year: number } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const d = Math.min(b.day, daysIn(b.month, y));
    const t = Date.UTC(y, b.month - 1, d);
    if (t >= today) return { days: Math.round((t - today) / 86400000), year: y };
  }
  return { days: 0, year: now.getUTCFullYear() };
}

/** The date whose token the reminder points at: the day they were born when it is a date Athar has (every date 1950-2049), else this year's birthday. */
export function targetIndex(b: Birthday, year: number): { index: number; own: boolean } {
  if (b.year !== null) { const i = indexOf(b.year, b.month, b.day); if (i >= 0 && i < TOTAL_DATES) return { index: i, own: true }; }
  return { index: indexOf(year, b.month, Math.min(b.day, daysIn(b.month, year))), own: false };
}

export const BD: Record<BLang, { button: string; ask: string; saved: string; savedNoYear: string; off: string; bad: string; soon: string; today: string; fail: string; free: string; taken: string; open: string }> = {
  en: {
    fail: "Reminders are not available right now, please try again later.",
    button: "🎂 Birthday reminder",
    ask: "🎂 Send your birthday, like 14/3/2003 (the year is optional: 14/3). I will remind you a week before and on the day, with the token of your date. Send «off» to stop.",
    saved: "✅ Saved: {d}. I will remind you a week before and on the day.", savedNoYear: "✅ Saved: {d} (without a year). I will remind you a week before and on the day.",
    off: "✅ Reminder removed.", bad: "I could not read that date. Try 14/3/2003 or 14/3.",
    soon: "🎂 Your birthday is in a week ({d})!", today: "🎉 Happy birthday! Today is {d}.",
    free: "The token of {t} is still available.", taken: "Every kind of {t} is already taken, but you can see it.", open: "Open the token of {t}",
  },
  ar: {
    fail: "التذكير غير متاح الآن، حاول لاحقاً.",
    button: "🎂 تذكير ميلادي",
    ask: "🎂 أرسل تاريخ ميلادك مثل 14/3/2003 (السنة اختيارية: 14/3). سأذكّرك قبل أسبوع وفي اليوم نفسه مع رمز تاريخك. أرسل «إيقاف» لإلغاء التذكير.",
    saved: "✅ تم الحفظ: {d}. سأذكّرك قبل أسبوع وفي اليوم نفسه.", savedNoYear: "✅ تم الحفظ: {d} (بلا سنة). سأذكّرك قبل أسبوع وفي اليوم نفسه.",
    off: "✅ أُلغي التذكير.", bad: "لم أفهم هذا التاريخ. جرّب 14/3/2003 أو 14/3.",
    soon: "🎂 بعد أسبوع يوم ميلادك ({d})!", today: "🎉 عيد ميلاد سعيد! اليوم {d}.",
    free: "رمز {t} ما زال متاحاً.", taken: "كل أنواع رمز {t} مأخوذة، لكن يمكنك رؤيته.", open: "افتح رمز {t}",
  },
  ru: {
    fail: "Напоминания сейчас недоступны, попробуйте позже.",
    button: "🎂 Напоминание о дне рождения",
    ask: "🎂 Отправьте дату рождения, например 14/3/2003 (год необязателен: 14/3). Я напомню за неделю и в сам день, с токеном вашей даты. Отправьте «off», чтобы отключить.",
    saved: "✅ Сохранено: {d}. Напомню за неделю и в сам день.", savedNoYear: "✅ Сохранено: {d} (без года). Напомню за неделю и в сам день.",
    off: "✅ Напоминание отключено.", bad: "Не удалось прочитать дату. Попробуйте 14/3/2003 или 14/3.",
    soon: "🎂 Через неделю ваш день рождения ({d})!", today: "🎉 С днём рождения! Сегодня {d}.",
    free: "Токен {t} ещё доступен.", taken: "Все виды токена {t} уже заняты, но вы можете его посмотреть.", open: "Открыть токен {t}",
  },
  tr: {
    fail: "Hatırlatmalar şu an kullanılamıyor, sonra tekrar dene.",
    button: "🎂 Doğum günü hatırlatması",
    ask: "🎂 Doğum gününü gönder, örneğin 14/3/2003 (yıl isteğe bağlı: 14/3). Bir hafta önce ve o gün, tarihinin tokenıyla birlikte hatırlatırım. Durdurmak için «off» yaz.",
    saved: "✅ Kaydedildi: {d}. Bir hafta önce ve o gün hatırlatacağım.", savedNoYear: "✅ Kaydedildi: {d} (yılsız). Bir hafta önce ve o gün hatırlatacağım.",
    off: "✅ Hatırlatma kaldırıldı.", bad: "Bu tarihi okuyamadım. 14/3/2003 veya 14/3 dene.",
    soon: "🎂 Doğum gününe bir hafta kaldı ({d})!", today: "🎉 Doğum günün kutlu olsun! Bugün {d}.",
    free: "{t} tokenı hâlâ alınabilir.", taken: "{t} tokenının tüm türleri alınmış, ama görebilirsin.", open: "{t} tokenını aç",
  },
  fa: {
    fail: "یادآور الان در دسترس نیست، بعداً دوباره امتحان کنید.",
    button: "🎂 یادآور تولد",
    ask: "🎂 تاریخ تولدتان را بفرستید، مثل 14/3/2003 (سال اختیاری است: 14/3). یک هفته قبل و در خود روز، همراه با توکن تاریخ شما یادآوری می‌کنم. برای توقف «off» بفرستید.",
    saved: "✅ ذخیره شد: {d}. یک هفته قبل و در خود روز یادآوری می‌کنم.", savedNoYear: "✅ ذخیره شد: {d} (بدون سال). یک هفته قبل و در خود روز یادآوری می‌کنم.",
    off: "✅ یادآور حذف شد.", bad: "این تاریخ را نفهمیدم. 14/3/2003 یا 14/3 را امتحان کنید.",
    soon: "🎂 یک هفته تا تولد شما مانده ({d})!", today: "🎉 تولدتان مبارک! امروز {d} است.",
    free: "توکن {t} هنوز در دسترس است.", taken: "همهٔ انواع توکن {t} گرفته شده‌اند، اما می‌توانید آن را ببینید.", open: "باز کردن توکن {t}",
  },
};
export const BD_OFF = /^(off|stop|cancel|إيقاف|ايقاف|إلغاء|الغاء|стоп|отмена|dur|iptal|توقف|لغو)$/i;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w)\}/g, (_, k) => v[k] ?? "");
export const fmtDate = (b: { month: number; day: number; year: number | null }) => `${b.day}/${b.month}${b.year ? "/" + b.year : ""}`;

// ---- storage (raw SQL: the Prisma model does not know these columns, so the existing language queries can never fail because of them) ----
type Db = { $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>; $queryRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown> };
export async function saveBirthday(db: Db, botId: string, tgUserId: string, lang: string, b: Birthday | null): Promise<boolean> {
  try {
    await db.$executeRawUnsafe(
      `insert into athar_bot_user (bot_id, tg_user_id, lang, birth_month, birth_day, birth_year, birthday_notified, updated_at) values ($1,$2,$3,$4,$5,$6,null,now())
       on conflict (bot_id, tg_user_id) do update set birth_month=$4, birth_day=$5, birth_year=$6, birthday_notified=null, updated_at=now()`,
      botId, tgUserId, lang, b ? b.month : null, b ? b.day : null, b ? b.year : null);
    return true;
  } catch { return false; }
}
export type BirthdayRow = { bot_id: string; tg_user_id: string; lang: string; birth_month: number; birth_day: number; birth_year: number | null; birthday_notified: string | null };
export async function birthdayRows(db: Db, botIds: string[]): Promise<BirthdayRow[]> {
  if (!botIds.length) return [];
  try {
    return (await db.$queryRawUnsafe(`select bot_id, tg_user_id, lang, birth_month::int as birth_month, birth_day::int as birth_day, birth_year::int as birth_year, birthday_notified from athar_bot_user where birth_month is not null and bot_id = any($1)`, botIds)) as BirthdayRow[];
  } catch { return []; }
}
export async function markNotified(db: Db, botId: string, tgUserId: string, key: string): Promise<void> {
  try { await db.$executeRawUnsafe(`update athar_bot_user set birthday_notified=$3 where bot_id=$1 and tg_user_id=$2`, botId, tgUserId, key); } catch { /* it may be sent twice at worst */ }
}

/** The reminder text and button label for one person; `free` is whether some kind of the date can still be bought (null: unknown). */
export function reminderText(lang: BLang, b: Birthday, kind: "week" | "day", year: number, free: boolean | null): { text: string; button: string; index: number } {
  const t = BD[lang], { index, own } = targetIndex(b, year);
  const label = own ? fmtDate({ month: b.month, day: b.day, year: b.year }) : fmtDate({ month: b.month, day: b.day, year });
  const head = fill(kind === "week" ? t.soon : t.today, { d: fmtDate({ month: b.month, day: b.day, year: kind === "day" ? year : null }) });
  const line = free === null ? "" : "\n" + fill(free ? t.free : t.taken, { t: label });
  return { text: head + line, button: fill(t.open, { t: label }), index };
}
export function bdText(lang: BLang, key: "ask" | "saved" | "savedNoYear" | "off" | "bad" | "fail", b?: Birthday): string { return fill(BD[lang][key], { d: b ? fmtDate(b) : "" }); }
