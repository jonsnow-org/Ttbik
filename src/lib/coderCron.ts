// Cron-style recurrence for the coder's scheduled tasks, evaluated in the user's own time zone (DST-safe: wall-clock matching).
// Standard 5 fields: minute hour day-of-month month day-of-week (0-6, Sun=0; 7 = Sun). Supports * , - and /. When both day fields
// are restricted the task runs when either matches (classic cron). Friendly forms (daily/weekly/weekdays/hourly) compile to cron.

type Field = { set: Set<number>; any: boolean };
export type Cron = { min: Field; hour: Field; dom: Field; mon: Field; dow: Field; src: string };

function field(spec: string, lo: number, hi: number, isDow = false): Field {
  const set = new Set<number>();
  const s = spec.trim();
  if (!s) throw new Error("empty field");
  for (const part of s.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`bad field ${part}`);
    const step = m[2] ? Number(m[2]) : 1;
    if (!step || step < 1) throw new Error("bad step");
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    if (isDow && b === 7) b = 7;
    if (a < lo || b > (isDow ? 7 : hi) || a > b) throw new Error(`out of range ${part}`);
    for (let v = a; v <= b; v += step) set.add(isDow && v === 7 ? 0 : v);
  }
  return { set, any: s === "*" };
}

export function parseCron(src: string): Cron {
  const f = src.trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron needs 5 fields");
  return { min: field(f[0], 0, 59), hour: field(f[1], 0, 23), dom: field(f[2], 1, 31), mon: field(f[3], 1, 12), dow: field(f[4], 0, 6, true), src: f.join(" ") };
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function wallClock(t: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; wd: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(t)) p[x.type] = x.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), wd: WD[p.weekday] ?? 0 };
}

function dayMatches(c: Cron, w: { d: number; wd: number }): boolean {
  if (c.dom.any && c.dow.any) return true;
  if (c.dom.any) return c.dow.set.has(w.wd);
  if (c.dow.any) return c.dom.set.has(w.d);
  return c.dom.set.has(w.d) || c.dow.set.has(w.wd);
}

/** The first minute strictly after `from` that matches, in time zone `tz`; null if none within ~400 days. */
export function nextRun(cron: string | Cron, tz: string, from: Date = new Date()): Date | null {
  const c = typeof cron === "string" ? parseCron(cron) : cron;
  const zone = validTimeZone(tz) ? tz : "UTC";
  let t = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  const end = t + 400 * 86400000;
  while (t < end) {
    const w = wallClock(new Date(t), zone);
    if (!c.mon.set.has(w.mo) || !dayMatches(c, w) || !c.hour.set.has(w.h)) {
      t += (60 - w.mi) * 60000;                       // jump to the next wall-clock hour
      continue;
    }
    if (c.min.set.has(w.mi)) return new Date(t);
    t += 60000;
  }
  return null;
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  "الأحد": 0, "الاثنين": 1, "الإثنين": 1, "الثلاثاء": 2, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6,
};

/** Friendly recurrence -> cron. "daily 09:00", "weekdays 08:30", "weekly mon,thu 18:00", "hourly :15", "monthly 1 09:00", or a raw cron. */
export function toCron(spec: string): string {
  const s = spec.trim().replace(/\s+/g, " ");
  const hm = (x: string) => {
    const m = x.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error("time must be HH:MM");
    return [Number(m[2]), Number(m[1])];
  };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^daily (\S+)$/i))) {
    const [mi, h] = hm(m[1]);
    return `${mi} ${h} * * *`;
  }
  if ((m = s.match(/^weekdays (\S+)$/i))) {
    const [mi, h] = hm(m[1]);
    return `${mi} ${h} * * 1-5`;
  }
  if ((m = s.match(/^weekly (\S+) (\S+)$/i))) {
    const days = m[1].split(",").map((d) => DAY_NAMES[d.toLowerCase().slice(0, 3)] ?? DAY_NAMES[d] ?? NaN);
    if (!days.length || days.some((d) => Number.isNaN(d))) throw new Error("unknown day");
    const [mi, h] = hm(m[2]);
    return `${mi} ${h} * * ${[...new Set(days)].sort().join(",")}`;
  }
  if ((m = s.match(/^monthly (\d{1,2}) (\S+)$/i))) {
    const d = Number(m[1]);
    if (d < 1 || d > 31) throw new Error("bad day of month");
    const [mi, h] = hm(m[2]);
    return `${mi} ${h} ${d} * *`;
  }
  if ((m = s.match(/^hourly :?(\d{1,2})$/i))) {
    const mi = Number(m[1]);
    if (mi > 59) throw new Error("bad minute");
    return `${mi} * * * *`;
  }
  return parseCron(s.replace(/^cron /i, "").replace(/^"|"$/g, "")).src;
}

/** A short human description (Arabic or English) of a cron string. */
export function describeCron(cron: string, lang: "ar" | "en" = "ar"): string {
  try {
    const c = parseCron(cron);
    const [mi, h, dom, , dow] = c.src.split(" ");
    const time = /^\d+$/.test(h) && /^\d+$/.test(mi) ? `${h.padStart(2, "0")}:${mi.padStart(2, "0")}` : "";
    const names = lang === "ar" ? ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (time && dom === "*" && dow === "*") return lang === "ar" ? `يومياً ${time}` : `Daily ${time}`;
    if (time && dom === "*" && dow === "1-5") return lang === "ar" ? `أيام العمل ${time}` : `Weekdays ${time}`;
    if (time && dom === "*" && /^[\d,]+$/.test(dow)) return `${lang === "ar" ? "أسبوعياً" : "Weekly"} ${dow.split(",").map((d) => names[Number(d) % 7]).join("، ")} ${time}`;
    if (time && /^\d+$/.test(dom) && dow === "*") return lang === "ar" ? `شهرياً يوم ${dom} ${time}` : `Monthly on ${dom} ${time}`;
    if (h === "*" && /^\d+$/.test(mi) && dom === "*" && dow === "*") return lang === "ar" ? `كل ساعة عند الدقيقة ${mi}` : `Hourly at :${mi.padStart(2, "0")}`;
    return c.src;
  } catch {
    return cron;
  }
}
