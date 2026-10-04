// Reference (off-chain) implementation of the Athar date rules. The contract must agree with it on all 36,525 dates.
export const EPOCH_UTC = Date.UTC(1950, 0, 1);
export const TOTAL_DATES = 36525;
export const TIER = { COMMON: 0, RARE: 1, MYTHIC: 2 } as const;

export function ymd(index: number) {
  const d = new Date(EPOCH_UTC + index * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
export function indexOf(y: number, m: number, d: number) {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / 86400000);
}
export function ruleTier(index: number): number {
  const { y, m, d } = ymd(index);
  const s = String(d).padStart(2, "0") + String(m).padStart(2, "0") + String(y);
  const palindrome = s === [...s].reverse().join("");
  const distinct = new Set(s).size;
  if (palindrome || distinct <= 2) return TIER.MYTHIC;
  if (d === m && (d === 11 || d === 22)) return TIER.MYTHIC;
  if (d === 29 && m === 2) return TIER.MYTHIC;
  if (d === m && y % 100 === d) return TIER.MYTHIC;
  if (d === 1 && m === 1 && y % 100 === 0) return TIER.MYTHIC;
  if (d === m) return TIER.RARE;
  if (d === 1 && m === 1) return TIER.RARE;
  if ([1, 10, 20, 30].includes(d) && [1, 10].includes(m)) return TIER.RARE;
  if ((d === 10 && m === 1) || (d === 20 && m === 2) || (d === 30 && m === 3)) return TIER.RARE;
  return TIER.COMMON;
}
