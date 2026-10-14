// Creator hub (/create) safety rules — pure functions, no AI, no database. Unit-tested in src/lib/__tests__/hub.test.ts.
// Crisis detection runs BEFORE any model call in the mental-support tool: a match returns the fixed helpline text below and the
// model is never asked to improvise. Legal: every answer carries the disclaimer; high-risk requests are refused before the model.

export function normalizeAr(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/(.)\1{2,}/g, "$1") // "اموووت" -> "اموت"
    .replace(/\s+/g, " ")
    .trim();
}

// Normalized forms (see normalizeAr). MSA + Levantine + Gulf + Egyptian + Maghrebi + English. False positives are accepted on purpose:
// showing helplines to someone who did not need them costs little; missing someone in danger costs everything.
const CRISIS_PATTERNS: RegExp[] = [
  /انتحار|انتحر|بنتحر|راح انتحر|حنتحر|نتحر/,
  /(اقتل|اموت|اقتلي|نقتل) (نفسي|حالي|روحي|راسي)/,
  /(قتل|موت) (نفسي|حالي|روحي)/,
  /(بدي|ابي|ابغي|ابغا|ودي|عايز|عاوز|عايزه|نفسي|بغيت|حاب|اريد|اود) ا?موت/,
  /(انهي|انهاء|اخلص|اخلص من) (حياتي|عمري|روحي)/,
  /(ما بدي|مابدي|ما ابي|مابي|مش عايز|مش عاوز|ما اريد|لا اريد|ماعدت ابي|ما بغيتش|مابغيتش) (ا?عيش|اكمل|الحياه)/,
  /(اوذي|اذي|اذيت|بأذي|بوذي|اجرح|جرحت|اقطع) (نفسي|حالي|روحي|شراييني|شرايني|ايدي)/,
  /(اشرب|بشرب|ابلع|بلعت) (سم|السم|كل الحبوب|علبه حبوب|حبوب كثير)/,
  /(ارمي|برمي|رميت|نرمي) (نفسي|حالي|روحي)/,
  /الموت احسن|الموت ارحم|احسن لو مت|ياريتني ميت|ليتني مت|يا ريتني اموت/,
  /\b(suicid\w*|kill myself|end my life|want to die|self[- ]?harm|cut myself|overdose)\b/,
];

export function detectCrisis(text: string): boolean {
  const t = normalizeAr(text);
  if (!t) return false;
  return CRISIS_PATTERNS.some((rx) => rx.test(t));
}

// Fixed helplines (no AI). Country code -> lines. Numbers are official emergency / public mental-health lines; the owner should review
// them periodically (docs in prisma/migration_hub_creator.sql header).
export const HELPLINES: Record<string, { name: string; lines: string[] }> = {
  SA: { name: "السعودية", lines: ["الطوارئ: 911", "مركز اتصال وزارة الصحة (استشارات نفسية): 937"] },
  AE: { name: "الإمارات", lines: ["الطوارئ: 999", "خط الدعم النفسي: 800 4673 (800HOPE)"] },
  EG: { name: "مصر", lines: ["الإسعاف: 123", "الخط الساخن للصحة النفسية: 08008880700"] },
  JO: { name: "الأردن", lines: ["الطوارئ: 911"] },
  LB: { name: "لبنان", lines: ["خط الحياة (Embrace): 1564", "الصليب الأحمر: 140"] },
  SY: { name: "سوريا", lines: ["الإسعاف: 110", "الشرطة: 112"] },
  IQ: { name: "العراق", lines: ["الإسعاف: 122", "الشرطة: 104"] },
  KW: { name: "الكويت", lines: ["الطوارئ: 112"] },
  QA: { name: "قطر", lines: ["الطوارئ: 999"] },
  BH: { name: "البحرين", lines: ["الطوارئ: 999"] },
  OM: { name: "عُمان", lines: ["الطوارئ: 9999"] },
  PS: { name: "فلسطين", lines: ["الإسعاف: 101", "الشرطة: 100"] },
  MA: { name: "المغرب", lines: ["الإسعاف: 150", "الشرطة: 19"] },
  DZ: { name: "الجزائر", lines: ["الحماية المدنية: 14", "الشرطة: 17"] },
  TN: { name: "تونس", lines: ["الإسعاف SAMU: 190", "الشرطة: 197"] },
  TR: { name: "تركيا", lines: ["الطوارئ: 112"] },
};

export function crisisMessage(country?: string | null): string {
  const cc = (country || "").toUpperCase();
  const own = HELPLINES[cc];
  const block = own
    ? `📞 ${own.name}:\n${own.lines.map((l) => "• " + l).join("\n")}`
    : Object.entries(HELPLINES)
        .slice(0, 8)
        .map(([, v]) => `• ${v.name}: ${v.lines[0]}`)
        .join("\n");
  return [
    "💛 كلامك مهم، وسلامتك أهم شيء الآن.",
    "إذا كنت تفكر بإيذاء نفسك أو في خطر، اتصل فوراً برقم الطوارئ في بلدك أو اذهب لأقرب مستشفى.",
    "",
    block,
    "",
    "🌍 أرقام كل الدول: https://findahelpline.com",
    "تحدّث الآن مع شخص تثق به ولا تبقَ وحدك. هذه الأداة ليست بديلاً عن مختص، ولن تحاول التعامل مع حالة خطر بنفسها.",
  ].join("\n");
}

export const MIND_DISCLAIMER =
  "ℹ️ هذا دعم أولي عام وليس تشخيصاً ولا علاجاً ولا وصفة دواء. إذا استمر الضيق أو أثّر على حياتك، راجع طبيباً أو أخصائياً نفسياً.";

// A model answer in the mental tool must never name medication or doses or hand out diagnoses; anything that does is replaced.
const MIND_FORBIDDEN = /(ملغ|ملليغرام|mg\b|جرعه|جرعة|حبه يوميا|خذ دواء|تناول دواء|مضاد اكتئاب|مضادات الاكتئاب|زاناكس|xanax|prozac|بروزاك|سيرترالين|sertraline|تشخيصك|انت مصاب ب|أنت مصاب ب|لديك اضطراب)/i;
export function mindReplyIsSafe(reply: string): boolean {
  return !MIND_FORBIDDEN.test(reply || "");
}

export const LEGAL_DISCLAIMER =
  "⚖️ تنبيه: هذه معلومات قانونية عامة وليست استشارة قانونية، وقد تختلف القوانين وتتغير. لأي قضية فعلية راجع محامياً مرخّصاً في بلدك قبل اتخاذ أي إجراء.";

export function withLegalDisclaimer(text: string): string {
  const t = (text || "").trim();
  return t.includes("ليست استشارة قانونية") ? t : `${t}\n\n${LEGAL_DISCLAIMER}`;
}

// High-risk legal requests: forging documents, hiding evidence, evading police/courts, specific criminal-defence tactics.
const LEGAL_REFUSE: RegExp[] = [
  /تزوير|ازور|زور لي|زورلي|مزور|forg(e|ery)|fake (document|contract|id)/,
  /(اخفي|اخفاء|اتخلص من|امسح) (الادله|الدليل|الاثبات|البصمات)/,
  /(اهرب|الهروب|اتهرب|التهرب) (من الشرطه|من الامن|من المحكمه|من العداله|من القضاء)/,
  /(كيف|طريقه) (افلت|انجو|اتخلص) من (تهمه|حكم|عقوبه)/,
  /(استراتيجيه|خطه) (الدفاع|دفاع) (الجنائي|في قضيه قتل|في جريمه)/,
  /(ابتز|ابتزاز|اهدد|تهديد) (شخص|احد|زوجتي|زوجي|موظف)/,
  /(اغسل|غسيل) (اموال|الاموال)/,
];
export function legalRequestIsHighRisk(text: string): boolean {
  const t = normalizeAr(text);
  return LEGAL_REFUSE.some((rx) => rx.test(t));
}
export const LEGAL_REFUSAL =
  "🚫 لا أستطيع المساعدة في هذا الطلب (تزوير، إخفاء أدلة، التهرب من القضاء، أو تفاصيل دفاع جنائي). إذا كنت طرفاً في قضية جنائية فحقك الأول هو محامٍ مرخّص — تواصل مع نقابة المحامين في بلدك لطلب محامٍ أو مساعدة قانونية مجانية.";

export const LEGAL_COUNTRIES: Record<string, string> = {
  SA: "السعودية", AE: "الإمارات", EG: "مصر", JO: "الأردن", SY: "سوريا", LB: "لبنان", IQ: "العراق", KW: "الكويت",
  QA: "قطر", BH: "البحرين", OM: "عُمان", PS: "فلسطين", MA: "المغرب", DZ: "الجزائر", TN: "تونس", TR: "تركيا",
};
