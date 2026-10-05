// Planning the owner's stock: which dates, and how they are split into wallet confirmations. Pure functions (tested); the server supplies
// the candidates (dates that are really free) and the panel sends the messages.

export type PickMode = "spread" | "start";

/** `count` dates out of the free candidates (ascending). "spread": evenly across the whole range, so no stretch of the calendar is emptied and the
 *  dates people are most likely to want (a run of neighbouring days) are not all taken; "start": the earliest ones. */
export function pickDates(candidates: number[], count: number, mode: PickMode = "spread"): number[] {
  const n = Math.max(0, Math.min(Math.floor(count), candidates.length));
  if (n === 0) return [];
  if (mode === "start") return candidates.slice(0, n);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(candidates[Math.floor(((k + 0.5) * candidates.length) / n)]);
  return Array.from(new Set(out));
}

/** Split `dates` into confirmations of at most `maxMsgs` messages each (the wallet's own limit), and never more than the wallet can fund at once
 *  (each message carries `perMsg`, the unused part of it comes straight back, so the next batch is funded again). */
export function planBatches(dates: number[], maxMsgs: number, balance: bigint, perMsg: bigint, reserve = 0n): number[][] {
  const fundable = perMsg > 0n && balance > reserve ? Number((balance - reserve) / perMsg) : 0;
  const size = Math.max(0, Math.min(Math.floor(maxMsgs), fundable));
  if (size === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < dates.length; i += size) out.push(dates.slice(i, i + size));
  return out;
}

/** What the owner really spends: per token about 0.15 in fees (of which about 0.1 stays inside the token as its storage), the sale price is not paid. */
export const FEE_PER_TOKEN = 0.15;
export const estimate = (n: number) => ({ perToken: FEE_PER_TOKEN, total: Math.round(n * FEE_PER_TOKEN * 100) / 100, stays: Math.round(n * 0.1 * 100) / 100 });
