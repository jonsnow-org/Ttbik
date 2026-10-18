/**
 * Shared by the mini apps that promote Athar (the match app and the media app): date helpers, the deep link of a day, Athar's health check and
 * the live look at one day (picture + which kinds are still free). Read-only use of Athar's public pages; no payments, no wallet.
 */
import { ATHAR_URL } from "@/lib/atharBotLogic";
import { indexOf, TOTAL_DATES } from "../../athar/lib/rules";

export type Ymd = { y: number; m: number; d: number };
export function parseYmd(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
export function ymdOf(date: Date): Ymd {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}
export const dayKeyOf = (x: Ymd) => `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
/** Athar deep link for a date, or null outside 1950-2049. */
export function atharDateLink(x: Ymd): string | null {
  if (x.y < 1950 || x.y > 2049) return null;
  const i = indexOf(x.y, x.m, x.d);
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return null;
  return `${ATHAR_URL}/date?i=${i}&lang=ar`;
}

// Hide on failure: Athar must answer its public date API (cached 10 min, 3 s timeout).
let health: { ok: boolean; at: number } | null = null;
export async function atharHealthy(now = Date.now()): Promise<boolean> {
  if (health && now - health.at < 600_000) return health.ok;
  let ok = false;
  try {
    const r = await fetch(`${ATHAR_URL}/api/date/0`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    ok = r.ok;
  } catch { ok = false; }
  health = { ok, at: now };
  return ok;
}
// ---- a live look at one day of Athar: its picture and which kinds can still be gifted (the app's showcase card) -------------------
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const KIND_AR = ["عادي", "فضي", "ذهبي"];
export type AtharDay = { index: number; label: string; link: string; img: string; known: boolean; kinds: { name: string; free: boolean | null }[]; anyFree: boolean | null };
const dayCache = new Map<number, { at: number; taken: boolean[] | null }>();
/** Which of the three direct kinds of a date are taken (null: Athar did not say). Cached 10 minutes per date. */
async function takenKinds(index: number, now: number): Promise<boolean[] | null> {
  const hit = dayCache.get(index);
  if (hit && now - hit.at < 600_000) return hit.taken;
  let taken: boolean[] | null = null;
  try {
    const r = await fetch(`${ATHAR_URL}/api/date/${index}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const j: any = r.ok ? await r.json() : null;
    if (j && j.onChain && Array.isArray(j.taken)) taken = [0, 1, 2].map((k) => !!j.taken[k] || !!j.auction?.[k] || !!j.reserved?.[k]);
  } catch { taken = null; }
  if (dayCache.size > 400) dayCache.clear();
  dayCache.set(index, { at: now, taken });
  return taken;
}
export async function atharDay(x: Ymd, now = Date.now()): Promise<AtharDay | null> {
  const link = atharDateLink(x);
  if (!link) return null;
  const index = indexOf(x.y, x.m, x.d);
  const taken = await takenKinds(index, now);
  const kinds = KIND_AR.map((name, k) => ({ name, free: taken ? !taken[k] : null }));
  // the picture shows the richest kind that is still free (gold, silver, normal); when nothing is free, the normal one
  const show = taken ? [2, 1, 0].find((k) => !taken[k]) ?? 0 : 2;
  return {
    index, link, label: `${x.d} ${MONTHS_AR[x.m - 1]} ${x.y}`, img: `/api/athar/img/${show * 65536 + index}`, known: !!taken, kinds,
    anyFree: taken ? taken.some((t) => !t) : null,
  };
}
