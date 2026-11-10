/**
 * «ختمة» (2026-11-10): group Quran khatmas on the existing STREAK_BOT (no new bot), with paid memorial
 * khatmas (صدقة جارية) in Telegram Stars and Ramadan sponsorship slots. Pure rules, unit-tested in
 * src/lib/__tests__/khatma.test.ts.
 */
export const JUZ_COUNT = 30;
export const KHATMA_CMD = /^\/(khatma|ختمة)(@[A-Za-z0-9_]+)?(\s+([\s\S]*))?$/i;
export const MENU_BUTTON = "📖 ختمة جماعية";
export const MEMORIAL_BUTTON = "🕊 ختمة صدقة جارية";
export const STARS_KIND = "KHATMA:";
export const MEMORIAL_START_PREFIX = "k_";
export const TITLE_MAX = 60;
export const NAME_MAX = 60;
export const DEDICATION_MAX = 300;

/** Memorial tiers. Every tier gets a renewing khatma with its own page; the higher one is featured on /khatma. */
export const MEMORIAL_TIERS = [
  { id: "basic", stars: 100, label: "ختمة مستمرة وصفحة تذكارية", featuredDays: 0 },
  { id: "featured", stars: 300, label: "ختمة مستمرة وصفحة، وتظهر في الختمات المفتوحة 30 يوماً ليشارك فيها الناس", featuredDays: 30 },
] as const;
export type TierId = (typeof MEMORIAL_TIERS)[number]["id"];
export const tierById = (id: string) => MEMORIAL_TIERS.find((t) => t.id === id);

/** Ramadan sponsorship slot: one line «برعاية …» on every completion message and on the memorial pages. */
export const SPONSOR_PRICE_USD = 30;
export const SPONSOR_DAYS = 10;

export type JuzState = { juz: number; userId: string | null; userName: string | null; done: boolean };

export function emptyBoard(): JuzState[] {
  return Array.from({ length: JUZ_COUNT }, (_, i) => ({ juz: i + 1, userId: null, userName: null, done: false }));
}

export function progress(board: JuzState[]): { taken: number; done: number; free: number } {
  const taken = board.filter((j) => j.userId).length;
  const done = board.filter((j) => j.done).length;
  return { taken, done, free: JUZ_COUNT - taken };
}

export const isComplete = (board: JuzState[]) => board.length === JUZ_COUNT && board.every((j) => j.done);

export type TapResult =
  | { kind: "take" } // free juz → reserve for this user
  | { kind: "done" } // own juz, not done → mark read
  | { kind: "undo" } // own juz, done → back to reading
  | { kind: "busy"; by: string } // someone else's juz
  | { kind: "limit" }; // user already holds too many unread juz

export const MAX_OPEN_PER_USER = 3;

/** What a tap on juz n by userId does. */
export function tap(board: JuzState[], n: number, userId: string): TapResult {
  const j = board.find((x) => x.juz === n);
  if (!j) return { kind: "busy", by: "" };
  if (!j.userId) {
    const open = board.filter((x) => x.userId === userId && !x.done).length;
    return open >= MAX_OPEN_PER_USER ? { kind: "limit" } : { kind: "take" };
  }
  if (j.userId === userId) return j.done ? { kind: "undo" } : { kind: "done" };
  return { kind: "busy", by: j.userName || "مشارك" };
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const arNum = (n: number) => String(n).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);

export function cellLabel(j: JuzState): string {
  return `${j.done ? "✅" : j.userId ? "📖" : "⬜"} ${arNum(j.juz)}`;
}

/** 30 buttons, 5 per row. callback_data = kj|<khatmaId>|<round>|<juz> (well under Telegram's 64 bytes). */
export function boardKeyboard(khatmaId: string | number, round: number, board: JuzState[]) {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let r = 0; r < JUZ_COUNT / 5; r++) {
    rows.push(board.slice(r * 5, r * 5 + 5).map((j) => ({ text: cellLabel(j), callback_data: `kj|${khatmaId}|${round}|${j.juz}` })));
  }
  return rows;
}

export function parseJuzCallback(data: string): { khatmaId: string; round: number; juz: number } | null {
  const m = /^kj\|(\d{1,12})\|(\d{1,5})\|(\d{1,2})$/.exec(String(data || ""));
  if (!m) return null;
  const juz = Number(m[3]);
  if (juz < 1 || juz > JUZ_COUNT) return null;
  return { khatmaId: m[1], round: Number(m[2]), juz };
}

export function cleanText(s: string, max: number): string {
  return String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function boardText(opts: { title: string; dedication?: string | null; round: number; completedRounds: number; board: JuzState[]; sponsor?: string | null }): string {
  const p = progress(opts.board);
  const lines = [`📖 ${opts.title}`];
  if (opts.dedication) lines.push(`🤲 ${opts.dedication}`);
  lines.push("", `الختمة رقم ${arNum(opts.round)} · قُرئ ${arNum(p.done)} من ${arNum(JUZ_COUNT)} جزءاً · محجوز ${arNum(p.taken - p.done)} · متاح ${arNum(p.free)}`);
  if (opts.completedRounds) lines.push(`🌿 ختمات مكتملة: ${arNum(opts.completedRounds)}`);
  const holders = opts.board.filter((j) => j.userId && !j.done).slice(0, 30).map((j) => `${arNum(j.juz)}: ${j.userName || "مشارك"}`);
  if (holders.length) lines.push("", "📖 قيد القراءة:", holders.join(" · "));
  lines.push("", "اضغط رقم جزء متاح لتأخذه (⬜)، واضغطه مرة أخرى حين تنتهي منه (✅).");
  if (opts.sponsor) lines.push("", `🌙 ${opts.sponsor}`);
  return lines.join("\n").slice(0, 4000);
}

export const COMPLETION_DUA = "اللهم ارحمنا بالقرآن، واجعله لنا إماماً ونوراً وهدى ورحمة، اللهم ذكّرنا منه ما نُسّينا، وعلّمنا منه ما جهلنا، وارزقنا تلاوته آناء الليل وأطراف النهار.";

export function completionText(opts: { title: string; dedication?: string | null; round: number; readers: number; sponsor?: string | null }): string {
  const lines = [`🌿 تمّت الختمة رقم ${arNum(opts.round)}: ${opts.title}`, `شارك فيها ${arNum(opts.readers)} قارئاً. تقبّل الله منكم.`];
  if (opts.dedication) lines.push(`🤲 ${opts.dedication}`);
  lines.push("", COMPLETION_DUA);
  if (opts.sponsor) lines.push("", `🌙 ${opts.sponsor}`);
  return lines.join("\n");
}

/** Memorial page slug: short, url-safe, unguessable enough for sharing (not a secret). */
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
export function makeSlug(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}
export const isSlug = (s: string) => /^[a-z2-9]{8}$/.test(String(s || ""));

export const INTENTS = [
  { id: "ruh", label: "🕊 عن روح", title: (n: string) => `ختمة عن روح ${n}` },
  { id: "shifa", label: "💚 بنية الشفاء", title: (n: string) => `ختمة بنية شفاء ${n}` },
  { id: "niyya", label: "🤲 نية خاصة", title: (n: string) => `ختمة ${n}` },
] as const;
export function memorialTitle(name: string, intent: string = "ruh"): string {
  const it = INTENTS.find((i) => i.id === intent) || INTENTS[0];
  return it.title(cleanText(name, NAME_MAX));
}

export const sponsorLine = (name: string, url?: string | null) => `برعاية ${cleanText(name, 60)}${url ? ` · ${url}` : ""}`;
