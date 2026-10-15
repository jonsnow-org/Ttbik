// The six creator-hub tools as plain functions, shared by the web API (src/app/api/hub/route.ts) and the bot templates (src/lib/hubBotLogic.ts).
import { hubGenerate } from "./ai";
import {
  crisisMessage, detectCrisis, LEGAL_COUNTRIES, LEGAL_REFUSAL, legalRequestIsHighRisk, MIND_DISCLAIMER, mindReplyIsSafe, withLegalDisclaimer,
} from "./safety";
import { AppConfig, AppTemplate, buildFromDescription, validateAppConfig } from "./appConfig";

export const MAX_INPUT = 3000;

// ------------------------------------------------------------------ (1) dialect translator
export const DIALECTS: Record<string, string> = {
  msa: "العربية الفصحى", egyptian: "اللهجة المصرية", levantine: "اللهجة الشامية", gulf: "اللهجة الخليجية", maghrebi: "اللهجة المغاربية (الدارجة)",
};
export function detectDialectRequest(text: string): string | null {
  if (/مصري|مصريه|مصرية|egypt/i.test(text)) return "egyptian";
  if (/شامي|شاميه|شامية|سوري|لبناني|اردني|فلسطيني|levant/i.test(text)) return "levantine";
  if (/خليجي|خليجيه|خليجية|سعودي|اماراتي|كويتي|gulf/i.test(text)) return "gulf";
  if (/مغربي|مغاربي|دارجه|دارجة|جزائري|تونسي|maghreb/i.test(text)) return "maghrebi";
  if (/فصحى|فصحي|msa/i.test(text)) return "msa";
  return null;
}
export async function translateDialect(text: string, from: string, to: string): Promise<{ ok: boolean; text: string }> {
  const src = DIALECTS[from] || "أي لهجة عربية";
  const dst = DIALECTS[to];
  if (!dst) return { ok: false, text: "اختر اللهجة المطلوبة: فصحى، مصرية، شامية، خليجية، مغاربية." };
  const r = await hubGenerate(
    `مهمتك: حوّل النص من ${src} إلى ${dst} مع الحفاظ على المعنى والنبرة. أعد النص المحوّل فقط بلا شرح. إن وُجد تعبير ثقافي خاص أضف سطراً أخيراً يبدأ بـ «💡» يشرحه باختصار. لا تضف محتوى مسيئاً.`,
    text.slice(0, MAX_INPUT), 600, "groq",
  );
  return r ? { ok: true, text: r.text } : { ok: false, text: "خدمة الترجمة مشغولة الآن، جرّب بعد دقيقة." };
}

// ------------------------------------------------------------------ (7) content repurposer
export const FORMATS: Record<string, string> = {
  posts: "3 منشورات قصيرة لوسائل التواصل (كل منشور سطران إلى أربعة مع 2-3 وسوم)",
  thread: "سلسلة تغريدات من 5 إلى 7 تغريدات مرقّمة، كل تغريدة أقل من 270 حرفاً",
  video: "سكربت فيديو قصير 60 ثانية: خطّاف أول 3 ثوانٍ، ثم 3 نقاط، ثم دعوة لفعل",
  newsletter: "فقرة نشرة بريدية: عنوان جذاب + ملخص من 4 أسطر + سطر دعوة",
};
export function repurposeFallback(article: string, format: string): string {
  const sentences = article.replace(/\s+/g, " ").split(/(?<=[.!؟?])\s+/).map((s) => s.trim()).filter((s) => s.length > 15).slice(0, 7);
  if (!sentences.length) return article.slice(0, 270);
  if (format === "thread") return sentences.map((s, i) => `${i + 1}/ ${s.slice(0, 260)}`).join("\n\n");
  if (format === "video") return `🎬 الخطّاف: ${sentences[0]}\n\n${sentences.slice(1, 4).map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n👉 تابعنا للمزيد.`;
  return sentences.slice(0, 3).map((s) => `✍️ ${s}\n#شام_AI`).join("\n\n———\n\n");
}
export async function repurpose(article: string, format: string): Promise<{ text: string; engine: string }> {
  const f = FORMATS[format] ? format : "posts";
  const r = await hubGenerate(
    `حوّل المقال التالي إلى: ${FORMATS[f]}. اكتب بالعربية الواضحة، لا تخترع معلومات أو أرقاماً غير موجودة في المقال، وأعد النتيجة فقط.`,
    article.slice(0, MAX_INPUT), 900, "groq",
  );
  return r ? { text: r.text, engine: r.engine } : { text: repurposeFallback(article, f), engine: "rules" };
}

// ------------------------------------------------------------------ (16) legal assistant
export async function legalAnalyze(facts: string, country: string): Promise<{ text: string; refused?: boolean }> {
  if (legalRequestIsHighRisk(facts)) return { text: LEGAL_REFUSAL, refused: true };
  const cn = LEGAL_COUNTRIES[country] || "بلد غير محدد";
  const r = await hubGenerate(
    `أنت مساعد معلومات قانونية عامة بالعربية (لست محامياً). البلد: ${cn}. نظّم جوابك هكذا:
1) ملخص الوقائع كما فهمتها. 2) المسائل القانونية المحتملة بشكل عام. 3) خيارات عامة متاحة عادة (تفاوض، إنذار، شكوى لجهة مختصة، دعوى). 4) مستندات وأدلة يُنصح بجمعها. 5) متى يجب مراجعة محامٍ فوراً.
قواعد صارمة: لا تذكر أرقام مواد أو قوانين إلا إن كنت متأكداً وقل «تحقق منها»، لا تعِد بنتيجة، لا تساعد في تزوير أو إخفاء أدلة أو التهرب من القضاء، ولا تقدّم خطة دفاع جنائي. اختم بتوصية مراجعة محامٍ مرخّص.`,
    facts.slice(0, MAX_INPUT), 900, "groq",
  );
  const body = r?.text || "تعذر التحليل الآن. رتّب وقائعك (من، ماذا، متى، أين، ما المستندات) واعرضها على محامٍ مرخّص أو على جهة المساعدة القانونية المجانية في بلدك.";
  return { text: withLegalDisclaimer(body) };
}

export const LEGAL_DOCS: Record<string, { label: string; fields: string[] }> = {
  complaint: { label: "خطاب شكوى", fields: ["اسمك", "الجهة المشتكى إليها", "المشتكى عليه", "موضوع الشكوى", "الطلب"] },
  rental: { label: "عقد إيجار سكني مبسّط", fields: ["المؤجر", "المستأجر", "العقار", "الأجرة الشهرية", "المدة", "تاريخ البداية"] },
  employment: { label: "عقد عمل مبسّط", fields: ["صاحب العمل", "الموظف", "المسمى الوظيفي", "الراتب", "تاريخ البداية", "مدة التجربة"] },
  nda: { label: "اتفاقية عدم إفصاح (NDA)", fields: ["الطرف المفصح", "الطرف المتلقي", "الغرض", "المدة بالسنوات"] },
};
export function draftLegalDoc(kind: string, values: Record<string, string>, country: string): string | null {
  const d = LEGAL_DOCS[kind];
  if (!d) return null;
  const v = (k: string) => (String(values?.[k] ?? "").replace(/[<>]/g, "").trim().slice(0, 200) || `[${k}]`);
  const cn = LEGAL_COUNTRIES[country] || "[البلد]";
  const today = "[التاريخ]";
  let body = "";
  if (kind === "complaint") {
    body = `إلى: ${v("الجهة المشتكى إليها")}\nالتاريخ: ${today}\nالموضوع: شكوى بحق ${v("المشتكى عليه")}\n\nتحية طيبة وبعد،\nأتقدم أنا ${v("اسمك")} بهذه الشكوى بخصوص: ${v("موضوع الشكوى")}.\n\nالوقائع:\n1. [اكتب الواقعة الأولى مع تاريخها]\n2. [الواقعة الثانية]\n\nالمرفقات: [صور مستندات، إيصالات، رسائل]\n\nالطلب: ${v("الطلب")}\n\nوتفضلوا بقبول الاحترام،\n${v("اسمك")}\nالتوقيع: ________  رقم التواصل: [ ]`;
  } else if (kind === "rental") {
    body = `عقد إيجار سكني\nأُبرم هذا العقد في ${cn} بتاريخ ${today} بين:\nالطرف الأول (المؤجر): ${v("المؤجر")}\nالطرف الثاني (المستأجر): ${v("المستأجر")}\n\n1. العقار: ${v("العقار")}.\n2. المدة: ${v("المدة")} تبدأ من ${v("تاريخ البداية")}.\n3. الأجرة: ${v("الأجرة الشهرية")} شهرياً تُدفع مقدماً في أول كل شهر.\n4. التأمين: [مبلغ التأمين] يُرد عند انتهاء العقد بعد خصم الأضرار إن وُجدت.\n5. يلتزم المستأجر بالمحافظة على العقار وعدم تأجيره من الباطن إلا بموافقة خطية.\n6. الصيانة الأساسية على [المؤجر/المستأجر].\n7. الإنهاء المبكر: بإشعار خطي قبل [30] يوماً.\n8. يخضع العقد لقوانين ${cn}، وقد يلزم تسجيله لدى الجهة الرسمية المختصة.\n\nالمؤجر: ________   المستأجر: ________   شاهد: ________`;
  } else if (kind === "employment") {
    body = `عقد عمل\nبتاريخ ${today} في ${cn} اتفق كل من:\nصاحب العمل: ${v("صاحب العمل")}\nالموظف: ${v("الموظف")}\n\n1. الوظيفة: ${v("المسمى الوظيفي")}، والمهام وفق الوصف الوظيفي المرفق.\n2. تاريخ المباشرة: ${v("تاريخ البداية")}، وفترة التجربة: ${v("مدة التجربة")}.\n3. الأجر: ${v("الراتب")} شهرياً.\n4. ساعات العمل والإجازات وفق قانون العمل في ${cn}.\n5. السرية: يلتزم الموظف بعدم إفشاء معلومات العمل.\n6. الإنهاء: وفق أحكام قانون العمل النافذ ومدة الإشعار [ ].\n\nصاحب العمل: ________   الموظف: ________`;
  } else {
    body = `اتفاقية عدم إفصاح\nبتاريخ ${today} بين الطرف المفصح: ${v("الطرف المفصح")} والطرف المتلقي: ${v("الطرف المتلقي")}.\n\n1. الغرض: ${v("الغرض")}.\n2. المعلومات السرية: كل معلومة تجارية أو تقنية أو مالية يقدمها الطرف المفصح ولا تكون متاحة للعموم.\n3. يلتزم المتلقي باستخدامها للغرض فقط وعدم إفشائها لأي طرف ثالث.\n4. المدة: ${v("المدة بالسنوات")} سنوات من تاريخ التوقيع.\n5. عند الطلب يعيد المتلقي أو يتلف كل المعلومات.\n6. يخضع الاتفاق لقوانين ${cn}.\n\nالطرف المفصح: ________   الطرف المتلقي: ________`;
  }
  return `📄 ${d.label} — مسودة قابلة للتعديل\n\n${body}\n\n${"—".repeat(10)}\nهذه مسودة عامة ونموذج تعليمي. ${"⚖️"} راجعها مع محامٍ مرخّص قبل التوقيع، فقد تشترط قوانين ${cn} بنوداً أو تسجيلاً إضافياً.\n\n${withLegalDisclaimer("").trim()}`;
}
export function detectLegalDoc(text: string): string | null {
  if (/شكوى|شكوي|تظلم/.test(text)) return "complaint";
  if (/ايجار|إيجار|اجار|أجار|rent/i.test(text)) return "rental";
  if (/عقد عمل|توظيف|employment/i.test(text)) return "employment";
  if (/عدم افصاح|عدم إفصاح|سريه|سرية|nda/i.test(text)) return "nda";
  return null;
}

// ------------------------------------------------------------------ (17) mental first support
export const EXERCISES: Record<string, string> = {
  breathing: "🌬️ تنفّس 4-7-8:\n1. ازفر كل الهواء.\n2. شهيق من الأنف 4 ثوانٍ.\n3. احبس النفس 7 ثوانٍ.\n4. زفير بطيء من الفم 8 ثوانٍ.\nكرّر 4 مرات.",
  box: "⬜ التنفس المربّع:\nشهيق 4 ثوانٍ ← حبس 4 ← زفير 4 ← حبس 4. كرّر دقيقتين وركّز على العدّ فقط.",
  grounding: "🌿 تمرين التثبيت 5-4-3-2-1:\nسمِّ 5 أشياء تراها، 4 تلمسها، 3 تسمعها، 2 تشمّها، وشيئاً واحداً تتذوقه. يعيدك هذا للحظة الحالية.",
  muscle: "💪 الاسترخاء العضلي:\nشدّ عضلات قدميك 5 ثوانٍ ثم أرخِها 10 ثوانٍ، واصعد تدريجياً: الساقين، البطن، اليدين، الكتفين، الوجه.",
};
export const PSYCHOED: Record<string, string> = {
  anxiety: "القلق استجابة طبيعية للجسم تجاه الخطر، لكنه يصبح مرهقاً حين يستمر بلا سبب واضح. يساعد: النوم المنتظم، تقليل الكافيين، الحركة اليومية، وتمارين التنفس. إذا أثّر على عملك أو نومك أسابيع، راجع مختصاً.",
  sadness: "الحزن شعور إنساني طبيعي بعد الفقد أو الخيبة. أما إن استمر المزاج المنخفض وفقدان الاهتمام أكثر من أسبوعين، فهذه علامة تستحق مراجعة مختص. التواصل مع من تحب والروتين البسيط يساعدان.",
  stress: "الضغط يأتي من كثرة المطالب مقابل الوقت والطاقة. قسّم المهام، خذ فواصل قصيرة، وحدّد ما يمكنك التحكم فيه وما لا يمكنك.",
  sleep: "لنوم أفضل: موعد ثابت للنوم والاستيقاظ، ابتعد عن الشاشات قبل ساعة، غرفة مظلمة وهادئة، وتجنّب الكافيين بعد العصر.",
};
export type MindResult = { text: string; crisis: boolean };
export async function mindReply(message: string, country?: string | null): Promise<MindResult> {
  if (detectCrisis(message)) return { text: crisisMessage(country), crisis: true }; // fixed text, never the model
  const r = await hubGenerate(
    `أنت رفيق دعم نفسي أولي بالعربية، دافئ ومختصر (4 أسطر كحد أقصى). استمع، اعكس شعور المستخدم، واقترح خطوة صغيرة آمنة (تنفس، مشي، التواصل مع شخص موثوق، تدوين).
ممنوع تماماً: التشخيص، ذكر أي دواء أو جرعة، الوعود، الحكم على المستخدم، النصائح الطبية. إن ذكر المستخدم أي خطر على نفسه أو غيره قل له فوراً أن يتصل بالطوارئ. شجّعه على مراجعة مختص عند الحاجة.`,
    message.slice(0, 1200), 300, "groq",
  );
  let text = r && mindReplyIsSafe(r.text) ? r.text : "أسمعك، وما تشعر به مهم. جرّب الآن تمرين تنفس قصير، وإن استطعت تحدّث مع شخص تثق به. وإذا استمر هذا الشعور، فالحديث مع مختص خطوة قوة لا ضعف.";
  if (detectCrisis(text)) text = crisisMessage(country);
  return { text: `${text}\n\n${MIND_DISCLAIMER}`, crisis: false };
}

// ------------------------------------------------------------------ (19) app builder with AI customization
export async function buildAppWithAi(description: string, forced?: AppTemplate): Promise<{ config: AppConfig; engine: string }> {
  const base = buildFromDescription(description, forced);
  const r = await hubGenerate(
    `أنت تبني إعدادات تطبيق مصغّر من وصف المستخدم. أعد JSON فقط بلا أي نص آخر بهذا الشكل:
{"title":"...","tagline":"...","items":[{"title":"...","desc":"...","price":"..."}]}
القالب: ${base.template}. ${base.template === "quiz" ? 'لكل سؤال: {"title":"السؤال","options":["أ","ب","ج"],"answer":0}.' : ""}${base.template === "links" ? 'لكل رابط: {"title":"...","url":"https://..."} وفقط روابط ذكرها المستخدم.' : ""} من 3 إلى 8 عناصر، أسعار فقط إن ذكرها المستخدم أو اكتب "—". لا HTML.`,
    description.slice(0, 1500), 700, "groq",
  );
  if (r) {
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        const v = validateAppConfig({ ...base, title: j.title || base.title, tagline: j.tagline, items: Array.isArray(j.items) && j.items.length ? j.items : base.items });
        if (v.ok && v.config.items.length) return { config: v.config, engine: r.engine };
      } catch { /* model JSON broken: rule-based app below */ }
    }
  }
  return { config: base, engine: "rules" };
}
