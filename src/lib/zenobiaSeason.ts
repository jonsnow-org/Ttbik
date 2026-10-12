import { Address } from "@ton/core";
import { computeSeason, seasonHash, type PersonScore, type PersonSeason } from "@/lib/zenobiaScore";

/** Seasons are ISO weeks in UTC (Monday to Sunday): "2026-W42". Pure functions, no network. */

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function seasonId(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dow + 3); // the Thursday of this week decides the ISO year
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The seven UTC days (YYYY-MM-DD, Monday first) of a season id. */
export function seasonDays(id: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) throw new Error("bad season id");
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  const start = week1Monday + (Number(m[2]) - 1) * 7 * DAY;
  return Array.from({ length: 7 }, (_, i) => iso(new Date(start + i * DAY)));
}

export const previousSeason = (d: Date) => seasonId(new Date(d.getTime() - 7 * DAY));

/** Any TON address form -> the raw "0:hex" form tonapi uses. */
export const rawAddress = (a: string) => Address.parse(a).toRawString();

/** day -> (owner address in raw form -> balance in the jetton's smallest unit) */
export type Snapshots = Map<string, Map<string, bigint>>;

/**
 * One season's inputs per person, from daily balance snapshots.
 * A person is a Telegram user with verified wallets; their wallets are summed (so splitting does not help).
 * Volume is the sum of daily balance moves and sold is the sum of daily decreases: a daily-granularity
 * approximation that anyone can recompute from the published snapshots.
 */
export function buildPeople(snaps: Snapshots, days: string[], persons: Map<string, string[]>, decimals = 9): PersonSeason[] {
  const unit = 10 ** decimals;
  const out: PersonSeason[] = [];
  for (const [id, wallets] of persons) {
    const raws = wallets.map(rawAddress);
    const series: number[] = [];
    let last = 0;
    for (const d of days) {
      const snap = snaps.get(d);
      if (snap) last = Number(raws.reduce((a, w) => a + (snap.get(w) ?? 0n), 0n)) / unit; // a missing day carries the last balance
      series.push(last);
    }
    let volume = 0, sold = 0;
    for (let i = 1; i < series.length; i++) {
      const delta = series[i] - series[i - 1];
      volume += Math.abs(delta);
      if (delta < 0) sold += -delta;
    }
    const avg = series.reduce((a, b) => a + b, 0) / series.length;
    out.push({ id, avgBal: avg, volume, accum: series[series.length - 1] - series[0], startBal: series[0], sold });
  }
  return out;
}

export function closeSeason(id: string, people: PersonSeason[]): { season: string; hash: string; results: PersonScore[] } {
  const results = computeSeason(people);
  return { season: id, hash: seasonHash(id, results), results };
}
