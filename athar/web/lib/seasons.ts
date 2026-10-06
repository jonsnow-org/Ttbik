// Season definitions. A season is a plain description: which dates are on sale, how each direct kind is priced and capped, the caps of the
// owner's classes. The launch panel turns it into transactions; the contracts enforce it.
import { indexOf, ruleTier, TIER, TOTAL_DATES } from "./dates";

export type Special = { y: number; m: number; d: number; tier: 1 | 2; note: string };   // a designed date; `tier` is only a flag kept for the contract's list
export type Curve = { start: string; floor: string; cap: string; bumpBps: number; decayBps: number };
export type KindDef = Curve & {
  maxSupply: number;       // the most tokens of this kind that will ever exist (the contract only lets it be lowered)
  specialFee: string;      // TON on top of the price for a designed (special) date
  photoFee: string;        // TON on top of the price for putting an own photo on the token
  walletMax: number;       // most tokens of this kind one wallet may buy from us (0 = no limit)
};
export type SeasonDef = {
  id: number;
  name: string;
  rangeStart: number;              // the dates on sale: the whole calendar, nothing fixed in the past or the future
  rangeEnd: number;
  specials: Special[];
  kinds: [KindDef, KindDef, KindDef];   // normal, silver, gold: each its own price curve
  classCaps: [number, number, number, number, number];   // supply caps of bronze, rare, purple, diamond, legendary
  walletDailyCap: number;
  classAuction: { reserve: [string, string, string, string, string]; hours: number };   // suggested opening bids and length of the owner's class auctions
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
  // الإضافات التي تُكمل الموسم إلى 3000 تاريخ (انظر docs/ATHAR_SPECIAL_DATES.md)
  { y: 1953, m: 5, d: 29, tier: 1, note: "أول صعود إلى قمة إيفرست" },
  { y: 1954, m: 5, d: 6, tier: 1, note: "أول ميل في أقل من 4 دقائق" },
  { y: 1955, m: 12, d: 1, tier: 1, note: "روزا باركس ترفض ترك مقعدها" },
  { y: 1957, m: 3, d: 25, tier: 1, note: "معاهدة روما: بذرة الاتحاد الأوروبي" },
  { y: 1958, m: 1, d: 31, tier: 1, note: "إطلاق أول قمر أمريكي (إكسبلورر 1)" },
  { y: 1959, m: 1, d: 2, tier: 1, note: "لونا 1: أول مركبة تتجاوز القمر" },
  { y: 1961, m: 8, d: 13, tier: 2, note: "بناء جدار برلين" },
  { y: 1962, m: 7, d: 10, tier: 1, note: "تلستار: أول قمر اتصالات" },
  { y: 1964, m: 10, d: 10, tier: 1, note: "افتتاح أولمبياد طوكيو" },
  { y: 1965, m: 3, d: 18, tier: 1, note: "أول سير في الفضاء" },
  { y: 1967, m: 12, d: 3, tier: 1, note: "أول زراعة قلب" },
  { y: 1968, m: 12, d: 24, tier: 2, note: "«شروق الأرض» من أبولو 8" },
  { y: 1969, m: 8, d: 15, tier: 1, note: "مهرجان وودستوك" },
  { y: 1970, m: 4, d: 22, tier: 1, note: "أول يوم للأرض" },
  { y: 1970, m: 6, d: 21, tier: 1, note: "البرازيل بطلة كأس العالم للمرة الثالثة" },
  { y: 1973, m: 4, d: 3, tier: 1, note: "أول مكالمة بهاتف محمول" },
  { y: 1976, m: 1, d: 21, tier: 1, note: "أول رحلة تجارية للكونكورد" },
  { y: 1977, m: 9, d: 5, tier: 2, note: "إطلاق فوياجر 1" },
  { y: 1978, m: 7, d: 25, tier: 1, note: "ولادة أول طفل أنابيب" },
  { y: 1980, m: 5, d: 8, tier: 1, note: "إعلان القضاء على الجدري" },
  { y: 1983, m: 1, d: 1, tier: 1, note: "ميلاد الإنترنت الحديثة (TCP/IP)" },
  { y: 1986, m: 1, d: 28, tier: 1, note: "كارثة مكوك تشالنجر" },
  { y: 1986, m: 4, d: 26, tier: 1, note: "كارثة تشيرنوبل" },
  { y: 1991, m: 12, d: 26, tier: 2, note: "تفكك الاتحاد السوفييتي" },
  { y: 1992, m: 7, d: 25, tier: 1, note: "افتتاح أولمبياد برشلونة" },
  { y: 1993, m: 11, d: 1, tier: 1, note: "بدء الاتحاد الأوروبي (ماستريخت)" },
  { y: 1994, m: 4, d: 27, tier: 1, note: "أول انتخابات ديمقراطية في جنوب أفريقيا" },
  { y: 1994, m: 5, d: 6, tier: 1, note: "افتتاح نفق المانش" },
  { y: 1996, m: 7, d: 5, tier: 1, note: "ولادة النعجة دوللي" },
  { y: 1998, m: 11, d: 20, tier: 1, note: "إطلاق أول وحدة من محطة الفضاء الدولية" },
  { y: 1999, m: 1, d: 1, tier: 1, note: "بدء اليورو" },
  { y: 2008, m: 8, d: 8, tier: 1, note: "افتتاح أولمبياد بكين" },
  { y: 2008, m: 9, d: 15, tier: 1, note: "انهيار ليمان براذرز: الأزمة المالية" },
  { y: 2010, m: 12, d: 17, tier: 2, note: "شرارة الربيع العربي (تونس)" },
  { y: 2011, m: 3, d: 11, tier: 1, note: "زلزال وتسونامي اليابان" },
  { y: 2011, m: 3, d: 15, tier: 2, note: "انطلاق الثورة السورية" },
  { y: 2012, m: 8, d: 6, tier: 1, note: "هبوط كيوريوسيتي على المريخ" },
  { y: 2014, m: 11, d: 12, tier: 1, note: "هبوط فيلة على مذنّب" },
  { y: 2015, m: 12, d: 12, tier: 1, note: "اتفاق باريس للمناخ" },
  { y: 2018, m: 7, d: 15, tier: 1, note: "نهائي كأس العالم 2018" },
  { y: 2020, m: 3, d: 11, tier: 1, note: "إعلان كوفيد-19 جائحة" },
  { y: 2021, m: 2, d: 18, tier: 1, note: "هبوط برسيفرنس على المريخ" },
  { y: 2021, m: 12, d: 25, tier: 2, note: "إطلاق تلسكوب جيمس ويب" },
  { y: 2022, m: 11, d: 30, tier: 1, note: "إطلاق ChatGPT: عصر الذكاء الاصطناعي العام" },
  { y: 2023, m: 8, d: 23, tier: 1, note: "هبوط شاندرايان-3 قرب القطب الجنوبي للقمر" },
  { y: 2024, m: 12, d: 8, tier: 2, note: "سقوط النظام في سوريا: انتصار الثورة" },
];

export const SEASON_1: SeasonDef = {
  id: 1,
  name: "الموسم الأول",
  rangeStart: 0,
  rangeEnd: TOTAL_DATES - 1,
  specials: HIST,
  kinds: [
    { start: "0.5", floor: "0.25", cap: "8", bumpBps: 16, decayBps: 1500, maxSupply: TOTAL_DATES, specialFee: "1", photoFee: "0.15", walletMax: 0 },
    { start: "1.5", floor: "0.75", cap: "24", bumpBps: 16, decayBps: 1500, maxSupply: 900, specialFee: "3", photoFee: "0.3", walletMax: 20 },
    { start: "5", floor: "2.5", cap: "80", bumpBps: 16, decayBps: 1500, maxSupply: 300, specialFee: "10", photoFee: "0.6", walletMax: 5 },
  ],
  classCaps: [1000, 500, 150, 50, 10],
  walletDailyCap: 10,
  classAuction: { reserve: ["5", "10", "25", "60", "150"], hours: 72 },
};

export const SEASONS: Record<number, SeasonDef> = { 1: SEASON_1 };

export function specialIndex(s: Special) { return indexOf(s.y, s.m, s.d); }

/** The price premium of a patterned date (palindromes, 11/11, 29 Feb, ...), as a fraction: rare pattern x3/2, mythic pattern x2. Same as the contract. */
export function premiumOf(date: number): [number, number] {
  const r = ruleTier(date);
  return r === TIER.MYTHIC ? [2, 1] : r === TIER.RARE ? [3, 2] : [1, 1];
}
/** The supply cap of any kind in this season (the three direct kinds have their own, the classes a cap each). */
export function capOf(def: SeasonDef, kind: number): number { return kind <= 2 ? def.kinds[kind].maxSupply : def.classCaps[kind - 3]; }
