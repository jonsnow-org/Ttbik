/** Daily Arabic word. Definitions are short original glosses, not copied entries. */
export type WordEntry = {
  word: string;
  meaning: string;
  example: string;
};

export const WORD_BANK: WordEntry[] = [
  { word: "رَصِين", meaning: "متّزن وثابت الرأي، لا يندفع.", example: "قرار رصين بعد مراجعة الأرقام." },
  { word: "لَبِق", meaning: "حسن التصرف في الكلام والموقف.", example: "ردّ لبق يُنهي الجدل دون إهانة." },
  { word: "نَزاهة", meaning: "البعد عن الغش والمصلحة الخفية.", example: "النزاهة شرط لأي خدمة تُباع للناس." },
  { word: "حَصِيفة", meaning: "ذات رأي سديد وتنظر للعواقب.", example: "خطة حصيفة لا تعتمد على الحظ." },
  { word: "مُنْصِف", meaning: "يعطي كل طرف حقه بلا ميل.", example: "حكم منصف يشرح السبب لا الشعار." },
  { word: "كفاية", meaning: "ما يكفي للحاجة دون زيادة مُضرة.", example: "كفاية الوقت أهم من طول الصفحة." },
  { word: "أَناة", meaning: "تمهل محسوب، عكس العجلة العمياء.", example: "الأناة تمنع خطأ النشر السريع." },
  { word: "وضوح", meaning: "خلو المعنى من الغموض المتعمّد.", example: "وضوح السعر يمنع سوء الفهم." },
  { word: "ذِمّة", meaning: "مسؤولية أخلاقية تجاه وعد أو مال.", example: "الذمة لا تُباع بعمولة." },
  { word: "قَوام", meaning: "اعتدال بين طرفين دون إفراط.", example: "قوام الميزانية: لا بخل ولا تبذير." },
  { word: "مَكِين", meaning: "ثابت في موضعه، يصعب زحزحته.", example: "مصدر مكين أغلى من خبر سريع." },
  { word: "سَداد", meaning: "إصابة وجه الصواب في القول والعمل.", example: "سداد الرأي يظهر بعد التجربة." },
  { word: "عَزْم", meaning: "إرادة ماضية بعد اتخاذ القرار.", example: "العزم يكمل الخطة الناقصة." },
  { word: "رِفق", meaning: "لين في المعاملة دون ضعف الواجب.", example: "الرفق في الرد لا يلغي الحد." },
  { word: "تَثَبُّت", meaning: "التحقق قبل النقل أو الحكم.", example: "التثبت يمنع نقل رقم خاطئ." },
];

function utcDayIndex(d = new Date()): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const utc = Date.UTC(y, m, day) / 86400000;
  return Math.floor(utc);
}

export function wordOfDay(d = new Date()): WordEntry & { dateIso: string } {
  const idx = utcDayIndex(d);
  const entry = WORD_BANK[((idx % WORD_BANK.length) + WORD_BANK.length) % WORD_BANK.length];
  const dateIso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return { ...entry, dateIso };
}
