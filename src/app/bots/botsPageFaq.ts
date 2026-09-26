import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE, PATH, STEPS } from "./botsPageCopy";

export const FAQ = [
  { q: "هل أحصل على كود مصدري للبوت؟", a: "لا. المنتج بوت يعمل على توكنك. لا تحميل كوداً ولا بيع ملفات مصدرية." },
  { q: "هل يوجد سحب نقدي من البوت؟", a: "لا. النقاط داخل البوت فقط. لا يوجد سحب نقدي عبر سوق تولز." },
  { q: "كيف أفعّل بوتاً؟", a: "بعد طلب معتمد برمز طلب واحد لكل بوت. المالك يمكنه التجاوز للاختبار. الصق توكن BotFather في النموذج." },
  { q: "كيف أتأكد أن البوت يعمل؟", a: "استخدم فاحص صحة البوت للتوكن والويبهوك بلا حفظ التوكن." },
  { q: "هل أشارك توكن BotFather مع أحد؟", a: "لا. التوكن مفتاح البوت. الصقه فقط في نموذج التفعيل أو فاحص الصحة على هذا الموقع." },
  { q: "ماذا أفعل بعد التفعيل؟", a: "أرسل /start للبوت. إن لم يرد استخدم فاحص الصحة. الفحص لا يستهلك رمز الطلب. طلب واحد = بوت واحد." },
  { q: "ماذا يحدث إن أعدت توليد التوكن من BotFather؟", a: "التوكن القديم يبطل ويتوقف الويبهوك. لا تفتح بوتاً جديداً بنفس رمز الطلب. التحديث عند المالك. اسم المستخدم يبقى من BotFather." },
  { q: "هل أغيّر عنوان الويبهوك بعد التفعيل؟", a: "لا. تغيير الويبهوك يدوياً من BotFather أو setWebhook يقطع البوت. افحصه من فاحص الصحة. الفحص لا يستهلك رمز الطلب." },
  { q: "حذفت البوت من BotFather هل أسترجع رمز الطلب؟", a: "لا. طلب واحد = بوت واحد. الحذف من تليجرام لا يعيد الرمز ولا يسمح ببوت ثانٍ بنفس الطلب. لا سحب نقدي." },
  { q: "هل أسترجع التوكن من الموقع بعد التفعيل؟", a: "لا. التوكن لا يُعرض بعد التفعيل ولا يُرسل بالبريد. أعد توليده من BotFather ثم حدّثه عند المالك. لا بوت ثانٍ بنفس رمز الطلب." },
  { q: "هل أضيف البوت لمجموعة من الموقع بعد التفعيل؟", a: "لا. الإضافة من تليجرام. السماح بالمجموعات وخصوصية الرسائل من BotFather (/setjoingroups و/setprivacy). الموقع لا يدير عضوية المجموعات. طلب واحد = بوت واحد." },
  { q: "هل الموقع يرفع حد رسائل تيليجرام؟", a: "لا. حد الفيض (flood) من تيليجرام. الموقع لا يرفع حد Bot API ولا يتخطاه. الإرسال المتكرر قد يوقف البوت مؤقتاً." },
  { q: "هل أضبط قائمة الأوامر من الموقع؟", a: "لا. /setcommands من BotFather فقط. الحد من تليجرام. الضبط لا يستهلك رمز الطلب." },
  { q: "هل يراسل البوت من لم يبدأ المحادثة؟", a: "لا. تليجرام يمنع المراسلة قبل /start. الموقع لا يبث رسائل جماعية نيابة عنك." },
  { q: "هل تغيير اليوزر من BotFather يستهلك رمز الطلب؟", a: "لا. /setusername من BotFather ولا يفتح بوتاً ثانياً ولا يستهلك الرمز." },
  { q: "هل أغيّر اسم البوت ووصفه من النموذج؟", a: "لا. /setname و/setdescription و/setabouttext من BotFather. لا تستهلك رمز الطلب." },
  { q: "هل الموقع يرفع حد حجم الملفات في البوت؟", a: "لا. حد الملفات من Bot API لدى تليجرام. الموقع لا يرفع هذا الحد ولا يتجاوزه." },
  { q: "مستخدم حظر البوت — هل يصلّحه الموقع؟", a: "لا. الحظر من تليجرام. الموقع لا يفك الحظر ولا يرسل لمن حظر البوت. طلب واحد = بوت واحد. لا سحب نقدي." },
];

export const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export const HOWTO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "تفعيل بوت تليجرام على سوق تولز",
  description: "طلب معتمد واحد لكل بوت، ثم توكن BotFather في النموذج. لا كود للبيع ولا سحب نقدي.",
  inLanguage: "ar",
  step: STEPS.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.name,
    text: s.text,
  })),
};

export const LIVE_BOTS_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "بوتات سوق تولز العاملة على تليجرام",
  numberOfItems: LIVE_BOTS.length,
  itemListElement: LIVE_BOTS.map((bot, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "SoftwareApplication",
      name: bot.title,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Telegram",
      description: bot.desc,
      url: bot.href,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  })),
};

export const BREADCRUMB_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "البوتات", item: `${SITE}${PATH}` },
  ],
};

export const WEBPAGE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "تفعيل بوت تليجرام — سوق تولز",
  url: `${SITE}${PATH}`,
  inLanguage: "ar",
  description: "تفعيل بوت على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};

export const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "تفعيل بوت تليجرام — سوق تولز",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Telegram",
  url: `${SITE}${PATH}`,
  description: "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};
