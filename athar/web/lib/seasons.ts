// Season definitions. A season is a plain description: which dates, how they are priced, which are held back for
// mystery boxes. The launch panel turns it into transactions; the contracts enforce it.
import { createHash } from "crypto";
import { indexOf, ruleTier, TIER } from "./dates";

export type Special = { y: number; m: number; d: number; tier: 1 | 2; note: string };
export type SeasonDef = {
  id: number;
  name: string;
  rangeStart: number;
  rangeEnd: number;
  specials: Special[];
  poolSize: number;                // mystery pool: composition = 1% mythic, 12% rare, rest common
  common: { start: string; floor: string; cap: string; bumpBps: number; decayBps: number };
  rare: { start: string; floor: string; cap: string; bumpBps: number; decayBps: number };
  ticket: { start: string; floor: string; cap: string; bumpBps: number; decayBps: number };
  walletDailyCap: number;
  auctionReserve: string;          // TON, mythic dates
  auctionHours: number;
  mysteryDays: number;             // ticket sale length before the reveal
  fees: { photo: string; silver: string };   // extra price (TON) of an own photo / of the waxed-silver treatment; the generated art is free
  specialReserve: string;          // TON, opening bid of a special (gold) date
  specialDays: number;             // auction length of a special date: long while the community is small, shorter later
};

// Notable dates outside the 2000-2007 range that belong to Season 1 (neutral, widely known).
const HIST: Special[] = [
  { y: 1953, m: 4, d: 25, tier: 1, note: "بنية الحمض النووي" },
  { y: 1957, m: 10, d: 4, tier: 2, note: "سبوتنيك" },
  { y: 1961, m: 4, d: 12, tier: 2, note: "غاغارين في الفضاء" },
  { y: 1962, m: 2, d: 20, tier: 1, note: "غلين يدور حول الأرض" },
  { y: 1963, m: 8, d: 28, tier: 1, note: "لدي حلم" },
  { y: 1969, m: 7, d: 20, tier: 2, note: "الهبوط على القمر" },
  { y: 1969, m: 10, d: 29, tier: 1, note: "أول رسالة على الإنترنت الأولي" },
  { y: 1971, m: 12, d: 2, tier: 2, note: "اليوم الوطني لدولة الإمارات" },
  { y: 1976, m: 4, d: 1, tier: 1, note: "تأسيس آبل" },
  { y: 1977, m: 5, d: 25, tier: 1, note: "حرب النجوم" },
  { y: 1981, m: 4, d: 12, tier: 1, note: "أول رحلة مكوك" },
  { y: 1985, m: 7, d: 13, tier: 1, note: "لايف إيد" },
  { y: 1986, m: 6, d: 22, tier: 1, note: "مباراة مارادونا الشهيرة" },
  { y: 1989, m: 3, d: 12, tier: 1, note: "مقترح الشبكة العنكبوتية" },
  { y: 1989, m: 11, d: 9, tier: 2, note: "سقوط جدار برلين" },
  { y: 1990, m: 2, d: 11, tier: 1, note: "الإفراج عن مانديلا" },
  { y: 1990, m: 4, d: 24, tier: 1, note: "إطلاق تلسكوب هابل" },
  { y: 1990, m: 10, d: 3, tier: 1, note: "توحيد ألمانيا" },
  { y: 1991, m: 8, d: 6, tier: 1, note: "أول موقع ويب" },
  { y: 1993, m: 4, d: 30, tier: 1, note: "الويب للعموم" },
  { y: 1997, m: 6, d: 26, tier: 1, note: "هاري بوتر" },
  { y: 1998, m: 7, d: 12, tier: 1, note: "نهائي كأس العالم 1998" },
  { y: 1998, m: 9, d: 4, tier: 1, note: "تأسيس غوغل" },
  { y: 2008, m: 10, d: 31, tier: 1, note: "ورقة بتكوين البيضاء" },
  { y: 2009, m: 1, d: 3, tier: 2, note: "أول كتلة في بتكوين" },
  { y: 2010, m: 5, d: 22, tier: 1, note: "يوم بيتزا بتكوين" },
  { y: 2012, m: 7, d: 4, tier: 1, note: "إعلان بوزون هيغز" },
  { y: 2013, m: 8, d: 14, tier: 2, note: "إطلاق تيليجرام" },
  { y: 2015, m: 7, d: 30, tier: 1, note: "بداية إيثريوم" },
  { y: 2019, m: 4, d: 10, tier: 1, note: "أول صورة لثقب أسود" },
  { y: 2022, m: 11, d: 20, tier: 1, note: "افتتاح كأس العالم قطر" },
  { y: 2022, m: 12, d: 18, tier: 2, note: "نهائي كأس العالم 2022" },
];

export const SEASON_1: SeasonDef = {
  id: 1,
  name: "الموسم الأول",
  rangeStart: indexOf(2000, 1, 1),
  rangeEnd: indexOf(2007, 12, 31),
  specials: HIST,
  poolSize: 500,
  common: { start: "0.5", floor: "0.25", cap: "8", bumpBps: 16, decayBps: 1500 },
  rare: { start: "3", floor: "1.5", cap: "40", bumpBps: 200, decayBps: 1500 },
  ticket: { start: "1.1", floor: "0.6", cap: "20", bumpBps: 60, decayBps: 1500 },
  walletDailyCap: 10,
  auctionReserve: "10",
  auctionHours: 48,
  mysteryDays: 7,
  fees: { photo: "0.15", silver: "0.3" },
  specialReserve: "25",
  specialDays: 90,
};

export const SEASONS: Record<number, SeasonDef> = { 1: SEASON_1 };

const h = (n: number, salt: string) => createHash("sha256").update(`athar:${salt}:${n}`).digest().readUInt32BE(0);

export function specialIndex(s: Special) { return indexOf(s.y, s.m, s.d); }

/** Tier the contract will compute for a date of this season (special overrides win). */
export function seasonTier(def: SeasonDef, index: number) {
  const sp = def.specials.find((s) => specialIndex(s) === index);
  return sp ? sp.tier : ruleTier(index);
}

/** The mystery pool: published composition, picked by hash so anyone can recompute it. */
export function buildPool(def: SeasonDef) {
  const mythic: number[] = [], rare: number[] = [], common: number[] = [];
  const special = new Set(def.specials.map(specialIndex));
  for (let i = def.rangeStart; i <= def.rangeEnd; i++) {
    if (special.has(i)) continue;
    const t = ruleTier(i);
    (t === TIER.MYTHIC ? mythic : t === TIER.RARE ? rare : common).push(i);
  }
  const pick = (arr: number[], n: number, salt: string) => [...arr].sort((a, b) => h(a, salt) - h(b, salt)).slice(0, n);
  const nM = Math.max(1, Math.round(def.poolSize * 0.01));
  const nR = Math.round(def.poolSize * 0.12);
  const nC = def.poolSize - nM - nR;
  const dates = [...pick(mythic, nM, `${def.id}m`), ...pick(rare, nR, `${def.id}r`), ...pick(common, nC, `${def.id}c`)];
  // deterministic shuffle of positions (the reveal permutation does the real mixing)
  dates.sort((a, b) => h(a, `${def.id}pos`) - h(b, `${def.id}pos`));
  return { dates, composition: { mythic: nM, rare: nR, common: nC } };
}

export function seasonSize(def: SeasonDef) {
  const inRange = def.rangeEnd - def.rangeStart + 1;
  const outside = def.specials.filter((s) => { const i = specialIndex(s); return i < def.rangeStart || i > def.rangeEnd; }).length;
  return inRange + outside;
}
