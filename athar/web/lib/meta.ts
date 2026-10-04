// What a buyer sees about a token: how rare it really is, what happened on its date, how old it is, how long it has been held.
// Pure functions so the metadata (what markets show), the token page and the picture itself all say the same thing.
import { SEASONS, SEASON_1, seasonTier, specialIndex } from "./seasons";
import { MONTHS_EN, STAGE_NAME_AR, TIER_NAME_AR, TIER_NAME_EN, ymd } from "./dates";

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
    { trait_type: "Rarity", value: TIER_NAME_EN[tier] }, { trait_type: "الندرة", value: TIER_NAME_AR[tier] },
    { trait_type: "Supply in rarity", value: supply }, { trait_type: "Season", value: season },
    { trait_type: "Living picture", value: "Flashes, turns and shines; livelier with age" },
  ];
  if (event) attrs.push({ trait_type: "Historic event", value: event });
  if (f) {
    attrs.push({ trait_type: "Age stage", value: `${STAGE_NAME_EN[stage]} · ${STAGE_NAME_AR[stage]}` }, { trait_type: "Owners so far", value: f.hands }, { trait_type: "Days held by current owner", value: heldDays }, { trait_type: "Engravings", value: f.engravings }, { trait_type: "Edition", value: 1 });
    const oc = f.occasion ? occasionName(f.occasion) : null;
    if (oc) attrs.push({ trait_type: "Occasion", value: oc });
    attrs.push({ trait_type: "Own picture", value: f.mediaRef ? "Yes" : "Not yet (can be added)" });
  }
  const dateAr = `${d} ${["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][m - 1]} ${y}`;
  const dateEn = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${d}, ${y}`;
  const ar = [
    `رمز يوم ${dateAr} (${WEEK_AR[wd]}) — ${TIER_NAME_AR[tier]}، واحد من ${supply} فقط في هذه الفئة.`,
    event ? `في هذا اليوم: ${event}.` : "",
    "رمز حيّ: صورته تومض وتدور وتلمع، وتزداد حياةً وهالةً كلما طال بقاؤه، وفي ذكرى يومه تتوهّج بهالة ذهبية.",
    f ? `يعدّ أصحابه (${f.hands} حتى الآن) ويتذكّر ما نُقش عليه، وعمره الحالي «${STAGE_NAME_AR[stage]}»${heldDays ? ` (${heldDays} يوماً عند مالكه الحالي)` : ""}.` : "يعدّ أصحابه ويتذكّر ما يُنقش عليه وينضج كلما طال احتفاظ مالكه به.",
    "يمكن لمالكه أن يضع صورته الخاصة عليه.",
    f?.lastEngraving ? `آخر نقش: ${f.lastEngraving}` : "",
  ].filter(Boolean).join("\n");
  const en = [
    `The token of ${dateEn} (${WEEK_EN[wd]}) — ${TIER_NAME_EN[tier]}, one of only ${supply} in its rarity.`,
    event ? `On this day: ${event}.` : "",
    "A living token: its picture flashes, turns and shines, livelier the longer it is held, and glows gold on the date's own anniversary.",
    f ? `It counts its owners (${f.hands} so far), remembers what is engraved on it, and is now ${STAGE_NAME_EN[stage].toLowerCase()}${heldDays ? ` (${heldDays} days with the current owner)` : ""}.` : "It counts its owners, remembers what is engraved on it and matures the longer it is held.",
    "Its owner can add a personal picture to it.",
  ].filter(Boolean).join("\n");
  return { attrs, description: `${ar}\n\n${en}`, supply, event };
}
