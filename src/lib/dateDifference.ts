export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const DAY_MS = 86_400_000;

function utcDate({ year, month, day }: CalendarDate): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = utcDate(parsed);

  if (
    date.getUTCFullYear() !== parsed.year ||
    date.getUTCMonth() + 1 !== parsed.month ||
    date.getUTCDate() !== parsed.day
  ) {
    return null;
  }

  return parsed;
}

function formatCalendarDate(date: CalendarDate): string {
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}

export function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return formatCalendarDate({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

export function addCalendarDays(value: string, amount: number): string {
  const parsed = parseCalendarDate(value);
  if (!parsed || !Number.isSafeInteger(amount)) return "";

  const date = utcDate(parsed);
  date.setUTCDate(date.getUTCDate() + amount);

  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function addCalendarMonths(date: CalendarDate, amount: number): CalendarDate {
  const monthIndex = date.year * 12 + date.month - 1 + amount;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const firstOfNextMonth = utcDate({ year, month: month + 1, day: 1 });
  firstOfNextMonth.setUTCDate(0);
  const lastDay = firstOfNextMonth.getUTCDate();

  return { year, month, day: Math.min(date.day, lastDay) };
}

export type DateDifference = {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  weeks: number;
  hours: number;
};

export function calculateDateDifference(
  first: string,
  second: string,
): DateDifference | null {
  const firstDate = parseCalendarDate(first);
  const secondDate = parseCalendarDate(second);
  if (!firstDate || !secondDate) return null;

  const firstTime = utcDate(firstDate).getTime();
  const secondTime = utcDate(secondDate).getTime();
  const [start, end] =
    firstTime <= secondTime ? [firstDate, secondDate] : [secondDate, firstDate];
  const startTime = Math.min(firstTime, secondTime);
  const endTime = Math.max(firstTime, secondTime);
  const totalDays = Math.round((endTime - startTime) / DAY_MS);

  let totalMonths =
    (end.year - start.year) * 12 + (end.month - start.month);
  let anchor = addCalendarMonths(start, totalMonths);

  if (utcDate(anchor).getTime() > endTime) {
    totalMonths -= 1;
    anchor = addCalendarMonths(start, totalMonths);
  }

  const remainingDays = Math.round(
    (endTime - utcDate(anchor).getTime()) / DAY_MS,
  );
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  return {
    years,
    months,
    days: remainingDays,
    totalDays,
    weeks: Math.floor(totalDays / 7),
    hours: totalDays * 24,
  };
}

export function addDaysForDisplay(
  value: string,
  amount: number,
  locale = "ar-SA-u-ca-gregory",
): string {
  const nextDate = addCalendarDays(value, amount);
  const parsed = parseCalendarDate(nextDate);
  if (!parsed) return "";

  return utcDate(parsed).toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
