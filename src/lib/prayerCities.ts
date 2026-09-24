export type PrayerMethodId = "umm_al_qura" | "egyptian" | "mwl" | "karachi";

export type PrayerCity = {
  slug: string;
  nameAr: string;
  countryAr: string;
  lat: number;
  lng: number;
  tz: string;
  method: PrayerMethodId;
  methodLabel: string;
  note: string;
};

/** زوايا توافق طرق adhan الشائعة (بدون حزمة جديدة في هذا الدفع لتفادي كسر القفل). */
export const METHOD_ANGLES: Record<PrayerMethodId, { fajr: number; isha: number; maghribMin: number }> = {
  umm_al_qura: { fajr: 18.5, isha: 0, maghribMin: 90 },
  egyptian: { fajr: 19.5, isha: 17.5, maghribMin: 0 },
  mwl: { fajr: 18, isha: 17, maghribMin: 0 },
  karachi: { fajr: 18, isha: 18, maghribMin: 0 },
};

export const PRAYER_CITIES: PrayerCity[] = [
  { slug: "riyadh", nameAr: "الرياض", countryAr: "السعودية", lat: 24.7136, lng: 46.6753, tz: "Asia/Riyadh", method: "umm_al_qura", methodLabel: "أم القرى", note: "عاصمة نجد. الحساب على توقيت الرياض وطريقة أم القرى (العشاء بعد المغرب بـ90 دقيقة)." },
  { slug: "jeddah", nameAr: "جدة", countryAr: "السعودية", lat: 21.4858, lng: 39.1925, tz: "Asia/Riyadh", method: "umm_al_qura", methodLabel: "أم القرى", note: "على البحر الأحمر، أقرب من مكة. الشروق يتقدم دقائق قليلة عن الرياض بسبب خط الطول." },
  { slug: "makkah", nameAr: "مكة المكرمة", countryAr: "السعودية", lat: 21.3891, lng: 39.8579, tz: "Asia/Riyadh", method: "umm_al_qura", methodLabel: "أم القرى", note: "اتجاه القبلة من هنا قريب من الصفر. المصدر المرجعي لطريقة أم القرى." },
  { slug: "madinah", nameAr: "المدينة المنورة", countryAr: "السعودية", lat: 24.5247, lng: 39.5692, tz: "Asia/Riyadh", method: "umm_al_qura", methodLabel: "أم القرى", note: "شمال مكة على نفس خط الطول تقريباً؛ الفجر يتأخر قليلاً عن مكة في الشتاء." },
  { slug: "dammam", nameAr: "الدمام", countryAr: "السعودية", lat: 26.4207, lng: 50.0888, tz: "Asia/Riyadh", method: "umm_al_qura", methodLabel: "أم القرى", note: "شرق المملكة على الخليج. الغروب بعد الرياض بعدة دقائق." },
  { slug: "cairo", nameAr: "القاهرة", countryAr: "مصر", lat: 30.0444, lng: 31.2357, tz: "Africa/Cairo", method: "egyptian", methodLabel: "الهيئة المصرية", note: "حساب الهيئة المصرية العامة للمساحة: فجر 19.5° وعشاء 17.5°. التوقيت أفريقيا/القاهرة." },
  { slug: "alexandria", nameAr: "الإسكندرية", countryAr: "مصر", lat: 31.2001, lng: 29.9187, tz: "Africa/Cairo", method: "egyptian", methodLabel: "الهيئة المصرية", note: "على المتوسط، شمال غرب القاهرة؛ الفجر أبكر من الصعيد في الصيف." },
  { slug: "giza", nameAr: "الجيزة", countryAr: "مصر", lat: 30.0131, lng: 31.2089, tz: "Africa/Cairo", method: "egyptian", methodLabel: "الهيئة المصرية", note: "ملاصقة للقاهرة غرب النيل. الأوقات تختلف عن القاهرة بثوانٍ لا دقائق." },
  { slug: "dubai", nameAr: "دبي", countryAr: "الإمارات", lat: 25.2048, lng: 55.2708, tz: "Asia/Dubai", method: "umm_al_qura", methodLabel: "أم القرى (شائع محلياً)", note: "توقيت الإمارات UTC+4. لا تعتمد الدولة طريقة واحدة ملزمة؛ نعتمد أم القرى ونوضح ذلك." },
  { slug: "abu-dhabi", nameAr: "أبوظبي", countryAr: "الإمارات", lat: 24.4539, lng: 54.3773, tz: "Asia/Dubai", method: "umm_al_qura", methodLabel: "أم القرى (شائع محلياً)", note: "غرب دبي قليلاً؛ الغروب يسبق دبي بدقيقة إلى ثلاث." },
  { slug: "doha", nameAr: "الدوحة", countryAr: "قطر", lat: 25.2854, lng: 51.531, tz: "Asia/Qatar", method: "umm_al_qura", methodLabel: "أم القرى", note: "توقيت قطر. الطريقة الأقرب المعتمدة في المساجد الكبرى أم القرى." },
  { slug: "kuwait", nameAr: "الكويت", countryAr: "الكويت", lat: 29.3759, lng: 47.9774, tz: "Asia/Kuwait", method: "umm_al_qura", methodLabel: "أم القرى", note: "شمال الخليج. النهار الصيفي أطول من الرياض بسبب خط العرض." },
  { slug: "manama", nameAr: "المنامة", countryAr: "البحرين", lat: 26.2285, lng: 50.586, tz: "Asia/Bahrain", method: "umm_al_qura", methodLabel: "أم القرى", note: "جزيرة قريبة من الدمام؛ الأوقات شبه متطابقة مع الخبر." },
  { slug: "muscat", nameAr: "مسقط", countryAr: "عُمان", lat: 23.588, lng: 58.3829, tz: "Asia/Muscat", method: "mwl", methodLabel: "رابطة العالم الإسلامي", note: "شرق الجزيرة. رابطة العالم الإسلامي (فجر 18° عشاء 17°) شائعة في عُمان." },
  { slug: "amman", nameAr: "عمّان", countryAr: "الأردن", lat: 31.9454, lng: 35.9284, tz: "Asia/Amman", method: "egyptian", methodLabel: "الهيئة المصرية", note: "بلاد الشام. نعتمد الهيئة المصرية كما في بلاد الشام حسب O11." },
  { slug: "damascus", nameAr: "دمشق", countryAr: "سوريا", lat: 33.5138, lng: 36.2765, tz: "Asia/Damascus", method: "egyptian", methodLabel: "الهيئة المصرية", note: "سوريا ضمن نطاق الهيئة المصرية في توجيه O11." },
  { slug: "beirut", nameAr: "بيروت", countryAr: "لبنان", lat: 33.8938, lng: 35.5018, tz: "Asia/Beirut", method: "egyptian", methodLabel: "الهيئة المصرية", note: "ساحل المتوسط. الغروب بعد دمشق بدقائق بسبب الغرب." },
  { slug: "baghdad", nameAr: "بغداد", countryAr: "العراق", lat: 33.3152, lng: 44.3661, tz: "Asia/Baghdad", method: "karachi", methodLabel: "جامعة العلوم الإسلامية كراتشي", note: "طريقة كراتشي (18°/18°) شائعة في العراق. التوقيت بغداد." },
  { slug: "sanaa", nameAr: "صنعاء", countryAr: "اليمن", lat: 15.3694, lng: 44.191, tz: "Asia/Aden", method: "umm_al_qura", methodLabel: "أم القرى", note: "ارتفاع المدينة يؤثر عملياً على الشفق؛ الحساب فلكي بمستوى البحر." },
  { slug: "tunis", nameAr: "تونس", countryAr: "تونس", lat: 36.8065, lng: 10.1815, tz: "Africa/Tunis", method: "mwl", methodLabel: "رابطة العالم الإسلامي", note: "المغرب العربي. رابطة العالم الإسلامي مناسبة لخطوط العرض الأعلى." },
  { slug: "algiers", nameAr: "الجزائر", countryAr: "الجزائر", lat: 36.7538, lng: 3.0588, tz: "Africa/Algiers", method: "mwl", methodLabel: "رابطة العالم الإسلامي", note: "غرب تونس. الغروب بعد تونس بوضوح بسبب خط الطول." },
  { slug: "rabat", nameAr: "الرباط", countryAr: "المغرب", lat: 34.0209, lng: -6.8416, tz: "Africa/Casablanca", method: "mwl", methodLabel: "رابطة العالم الإسلامي", note: "المغرب يعتمد توقيتاً صيفياً متغيراً أحياناً؛ نعرض Africa/Casablanca كما في IANA." },
  { slug: "casablanca", nameAr: "الدار البيضاء", countryAr: "المغرب", lat: 33.5731, lng: -7.5898, tz: "Africa/Casablanca", method: "mwl", methodLabel: "رابطة العالم الإسلامي", note: "على الأطلسي جنوب الرباط قليلاً؛ الأوقات قريبة مع فرق دقائق." },
  { slug: "khartoum", nameAr: "الخرطوم", countryAr: "السودان", lat: 15.5007, lng: 32.5599, tz: "Africa/Khartoum", method: "egyptian", methodLabel: "الهيئة المصرية", note: "قرب مدار السرطان. النهار شبه ثابت على مدار السنة مقارنة بالشام." },
];

export function getPrayerCity(slug: string): PrayerCity | undefined {
  return PRAYER_CITIES.find((c) => c.slug === slug);
}
