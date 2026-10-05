// What a buyer sees about a token: how rare it really is, what happened on its date, how old it is, how long it has been held.
// Pure functions so the metadata (what markets show), the token page and the picture itself all say the same thing.
import { SEASONS, SEASON_1, seasonTier, specialIndex } from "./seasons";
import { MONTHS_EN, STAGE_DAYS, STAGE_NAME_AR, TIER_NAME_AR, TIER_NAME_EN, ymd } from "./dates";

const WEEK_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const STAGE_NAME_EN = ["New", "Mature", "Aged", "Old", "Historic"];

const supplyCache = new Map<number, [number, number, number]>();
/** How many dates of each rarity the season holds: [common, rare, mythic]. */
export function tierSupply(seasonId: number): [number, number, number] {
  const hit = supplyCache.get(seasonId);
  if (hit) return hit;
  const def = SEASONS[seasonId] || SEASON_1;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = def.rangeStart; i <= def.rangeEnd; i++) out[seasonTier(def, i)]++;
  for (const s of def.specials) { const i = specialIndex(s); if (i < def.rangeStart || i > def.rangeEnd) out[seasonTier(def, i)]++; }
  supplyCache.set(seasonId, out);
  return out;
}

export const weekdayOf = (index: number) => { const { y, m, d } = ymd(index); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const eventOf = (index: number, seasonId = 1) => (SEASONS[seasonId] || SEASON_1).specials.find((s) => specialIndex(s) === index)?.note ?? null;

/** Why a date has its rarity, in words: rarity is never luck, it is computed from the date by public rules (the same ones the contract enforces). */
export function rarityReason(index: number, tier: number, seasonId = 1): { ar: string; en: string } {
  const { y, m, d } = ymd(index);
  if (eventOf(index, seasonId)) return { ar: "تاريخ حدث تاريخي مختار", en: "a hand-picked historic date" };
  const s = String(d).padStart(2, "0") + String(m).padStart(2, "0") + String(y);
  if (s === [...s].reverse().join("")) return { ar: "تاريخ متناظر يُقرأ بالاتجاهين", en: "a palindrome date, the same read backwards" };
  if (new Set(s).size <= 2) return { ar: "تاريخ لا يتكوّن إلا من رقمين مختلفين", en: "a date made of only two different digits" };
  if (d === 29 && m === 2) return { ar: "29 فبراير: يوم لا يأتي إلا كل أربع سنوات", en: "February 29, a day that comes once in four years" };
  if (d === m && (d === 11 || d === 22)) return { ar: "يوم وشهر متطابقان بنمط 11/11 أو 22/22", en: "matching day and month in the 11/11 or 22/22 pattern" };
  if (d === m && y % 100 === d) return { ar: "اليوم والشهر والسنة المختصرة متطابقة", en: "day, month and short year all match" };
  if (d === 1 && m === 1) return { ar: "أول يوم في السنة", en: "the first day of the year" };
  if (d === m) return { ar: "اليوم والشهر متطابقان", en: "day and month are the same number" };
  if (tier === 1) return { ar: "بداية عشرة أو شهر مستدير", en: "a round day-and-month combination" };
  return { ar: "تاريخ عادي", en: "an everyday date" };
}

/** The same day in the Islamic (Umm al-Qura) calendar; the printed day can differ by one from a local sighting. */
export function hijriLabel(index: number, locale = "ar"): string {
  const { y, m, d } = ymd(index);
  try { return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))); } catch { return ""; }
}

export type TokenFacts = { season: number; tier: number; hands: number; engravings: number; lastTransferAt: number; mintedAt: number; mediaRef?: string | null; occasion: number; lastEngraving?: string };

/** Everything worth saying about a token, as market attributes plus a two-language description. */
export function tokenStory(index: number, f: TokenFacts | null, tier: number, stage: number, occasionName: (id: number) => string | null, now = Date.now()) {
  const { y, m, d } = ymd(index);
  const season = f?.season ?? 1;
  const supply = tierSupply(season)[tier];
  const wd = weekdayOf(index);
  const yearsAgo = Math.max(0, new Date(now).getUTCFullYear() - y);
  const event = eventOf(index, season);
  const heldDays = f?.lastTransferAt ? Math.max(0, Math.floor((now / 1000 - f.lastTransferAt) / 86400)) : 0;
  const attrs: { trait_type: string; value: string | number }[] = [
    { trait_type: "Date", value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` },
    { trait_type: "Year", value: y }, { trait_type: "Month", value: MONTHS_EN[m - 1] }, { trait_type: "Weekday", value: WEEK_EN[wd] },
    { trait_type: "Years since the date", value: yearsAgo },
    { trait_type: "Hijri date", value: hijriLabel(index, "en") },
    { trait_type: "Rarity", value: TIER_NAME_EN[tier] }, { trait_type: "الندرة", value: TIER_NAME_AR[tier] },
    { trait_type: "Supply in rarity", value: supply }, { trait_type: "Season", value: season },
    { trait_type: "Living picture", value: "Flashes, turns and shines; livelier with age" },
  ];
  const why = rarityReason(index, tier, season);
  attrs.push({ trait_type: "Why this rarity", value: why.en });
  if (event) attrs.push({ trait_type: "Historic event", value: event });
  if (f) {
    if (stage < 4) attrs.push({ trait_type: "Days to next age stage", value: Math.max(0, STAGE_DAYS[stage + 1] - heldDays) });
    attrs.push({ trait_type: "Age stage", value: `${STAGE_NAME_EN[stage]} · ${STAGE_NAME_AR[stage]}` }, { trait_type: "Owners so far", value: f.hands }, { trait_type: "Days held by current owner", value: heldDays }, { trait_type: "Engravings", value: f.engravings }, { trait_type: "Edition", value: 1 });
    const oc = f.occasion ? occasionName(f.occasion) : null;
    if (oc) attrs.push({ trait_type: "Occasion", value: oc });
    attrs.push({ trait_type: "Own picture", value: f.mediaRef ? "Yes" : "Not yet (can be added)" });
  }
  const dateAr = `${d} ${["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][m - 1]} ${y}`;
  const dateEn = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${d}, ${y}`;
  const ar = [
    `رمز يوم ${dateAr} (${hijriLabel(index, "ar")}، ${WEEK_AR[wd]}) — ${TIER_NAME_AR[tier]}، واحد من ${supply} فقط في هذه الفئة.`,
    `سبب ندرته: ${why.ar}. الندرة محسوبة من التاريخ بقواعد معلنة وليست حظاً.`,
    event ? `في هذا اليوم: ${event}.` : "",
    "رمز حيّ: صورته تومض وتدور وتلمع، وتزداد حياةً وهالةً كلما طال بقاؤه، وفي ذكرى يومه تتوهّج بهالة ذهبية.",
    f ? `يعدّ أصحابه (${f.hands} حتى الآن) ويتذكّر ما نُقش عليه، وعمره الحالي «${STAGE_NAME_AR[stage]}»${heldDays ? ` (${heldDays} يوماً عند مالكه الحالي)` : ""}.` : "يعدّ أصحابه ويتذكّر ما يُنقش عليه وينضج كلما طال احتفاظ مالكه به.",
    "ينضج بالاحتفاظ: يتغيّر شكله بعد 30 يوماً و6 أشهر وسنة و3 سنوات دون نقل، وأي نقل يعيد العدّاد فيكافئ من يحتفظ به.",
    "يُمكن إهداؤه لشخص آخر عند الصك، ويمكن لكل مالك أن ينقش عليه رسالة حتى 32 حرفاً تبقى مع الرمز.",
    "يمكن لمالكه أن يضع صورته الخاصة عليه ويختار مناسبته (ميلاد، زواج، مولود، تخرّج...).",
    f?.lastEngraving ? `آخر نقش: ${f.lastEngraving}` : "",
  ].filter(Boolean).join("\n");
  const en = [
    `The token of ${dateEn} (${hijriLabel(index, "en")}, ${WEEK_EN[wd]}) — ${TIER_NAME_EN[tier]}, one of only ${supply} in its rarity.`,
    `Why this rarity: ${why.en}. Rarity is computed from the date by public rules, never luck.`,
    event ? `On this day: ${event}.` : "",
    "A living token: its picture flashes, turns and shines, livelier the longer it is held, and glows gold on the date's own anniversary.",
    f ? `It counts its owners (${f.hands} so far), remembers what is engraved on it, and is now ${STAGE_NAME_EN[stage].toLowerCase()}${heldDays ? ` (${heldDays} days with the current owner)` : ""}.` : "It counts its owners, remembers what is engraved on it and matures the longer it is held.",
    "It matures with holding: it changes after 30 days, 6 months, 1 year and 3 years without moving, and any transfer resets the clock, rewarding those who keep it.",
    "It can be gifted to someone else when minted, and each owner can engrave a message of up to 32 characters that stays with the token.",
    "Its owner can add a personal picture and choose its occasion (birthday, wedding, newborn, graduation...).",
  ].filter(Boolean).join("\n");
  return { attrs, description: `${en}\n\n${ar}`, supply, event, dateEn };
}
