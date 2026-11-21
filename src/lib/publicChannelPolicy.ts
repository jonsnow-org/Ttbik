/** Shared public-channel policy. Keep these checks deterministic and fail closed. */
export const EXCLUDED_PUBLIC_BOT_SLUGS = new Set(["ads-and-earn", "medical"]);

const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const ARABIC_EARNINGS_PROMISE = /(?:اربح|اكسب)\s+(?:المال|أموال|اموال|دخل|مبلغ)|(?:اربح|اكسب)\s+(?:من|عن طريق|بسبب)\s+(?:مشاهدة|المشاهدة|الإعلانات|الاعلانات|النقرات|الضغطات)|(?:توزيع|يوزّع|يوزع|توزّع|توزع)\s+(?:الأرباح|الارباح|أرباح|ارباح|ربح)|(?:أرباح|ارباح|عوائد?|دخل)\s*(?:مضمونة|مضمون|ثابتة|ثابت|يومية|يومي|أسبوعية|اسبوعية|أسبوعي|اسبوعي|شهرية|شهري)|(?:ضاعف|مضاعفة)\s+(?:أموالك|اموالك|مالك|رأس المال|راس المال|الأرباح|الارباح)/iu;
const ENGLISH_EARNINGS_PROMISE = /\b(?:guaranteed|guarantee)\s+(?:profit|profits|earnings?|income|returns?|yield)\b|\b(?:make|earn)\s+(?:easy\s+)?money\b|\bpassive\s+income\b|\b(?:daily|weekly|monthly)\s+(?:profit|profits|returns?|income)\b|\b(?:profits?|earnings?)\s+(?:are|will\s+be|is)\s+(?:paid|distributed|credited|guaranteed)\b|\b(?:distribute|distributes|pay|pays)\s+(?:the\s+)?(?:viewing\s+)?(?:profits?|earnings?)\b|\b(?:earn|earnings?)\s+(?:from|by|through)\s+(?:watching|viewing|ads?|clicks?|referrals?)\b|\bget\s+paid\s+to\s+(?:watch|view|click)\b|\bpaid\s+per\s+(?:view|click|watch)\b|\bprofit[\s-]sharing\b|\bdouble\s+(?:your\s+)?(?:money|investment|profits?)\b/i;

const EXCLUDED_PRODUCT_TEXT = /(?:ads[-_\s]?and[-_\s]?earn|بوت الإعلانات والمهام|بوت الإعلان والمهام|البوت الطبي|medical bot)/iu;

export function hasArabicScript(text: unknown): boolean {
  return ARABIC_SCRIPT.test(String(text ?? ""));
}

export function isEnglishOnlyPublicText(...parts: unknown[]): boolean {
  return parts.every((part) => !hasArabicScript(part));
}

/** English public channel posts must begin with an English line before Arabic copy. */
export function ensureEnglishFirst(text: string): string {
  const value = String(text ?? "").trim();
  if (!value) return value;
  const firstVisibleLine = value
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return /[A-Za-z]/.test(firstVisibleLine) ? value : `Sham AI update\n\n${value}`;
}

/** Detect positive claims, not neutral mentions or explicit risk disclaimers. */
export function hasEarningsClaim(text: string): boolean {
  const value = String(text ?? "");
  return ARABIC_EARNINGS_PROMISE.test(value) || ENGLISH_EARNINGS_PROMISE.test(value);
}

export function isExcludedPublicPromoProductText(text: string): boolean {
  return EXCLUDED_PRODUCT_TEXT.test(String(text ?? ""));
}
