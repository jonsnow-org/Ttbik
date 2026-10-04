export { ymd, indexOf, ruleTier, TIER, TOTAL_DATES } from "../../lib/rules";
export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const TIER_NAME_AR = ["عادي", "نادر", "أسطوري"];
export const TIER_NAME_EN = ["Common", "Rare", "Mythic"];
export function dateLabelAr(y: number, m: number, d: number) { return `${d} ${MONTHS_AR[m - 1]} ${y}`; }
export const STAGE_DAYS = [0, 30, 180, 365, 1095];            // visual age stages (days since the last transfer)
export const STAGE_NAME_AR = ["جديد", "ناضج", "عتيق", "قديم", "تاريخي"];
export function stageOf(lastTransferSec: number, nowSec = Math.floor(Date.now() / 1000)) {
  const days = Math.max(0, (nowSec - lastTransferSec) / 86400);
  let s = 0;
  STAGE_DAYS.forEach((t, i) => { if (days >= t) s = i; });
  return s;
}
