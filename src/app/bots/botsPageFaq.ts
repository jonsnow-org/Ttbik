import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE, PATH, STEPS } from "./botsPageCopy";

/** Short, general FAQ only — no API method names, no owner/admin internals. */
export const FAQ = [
  {
    q: "ماذا أحصل عليه بعد التفعيل؟",
    a: "بوت يعمل على توكنك في تليجرام. ليس ملفاً للتحميل ولا كوداً مصدرياً.",
  },
  {
    q: "هل يوجد سحب نقدي من البوت؟",
    a: "لا. أي نقاط داخل البوت تبقى داخله فقط. لا سحب نقدي عبر شام AI.",
  },
  {
    q: "كيف أفعّل بوتاً؟",
    a: "بعد طلب معتمد (رمز واحد لكل بوت) الصق توكن BotFather في النموذج. المالك يمكنه التجاوز للاختبار.",
  },
  {
    q: "كيف أتأكد أن البوت يعمل؟",
    a: "أرسل /start للبوت في تليجرام. إن لم يرد استخدم فاحص الصحة على هذه الصفحة — الفحص لا يستهلك رمز الطلب.",
  },
  {
    q: "هل أشارك توكن BotFather مع أحد؟",
    a: "لا. التوكن مفتاح البوت. الصقه فقط في نموذج التفعيل أو فاحص الصحة على هذا الموقع.",
  },
  {
    q: "هل أعدّل اسم البوت أو صورته من هذه الصفحة؟",
    a: "لا. الاسم والصورة والوصف تُضبط من @BotFather في تليجرام.",
  },
  {
    q: "هل أدير المجموعة أو الأعضاء من نموذج الموقع؟",
    a: "لا. إدارة المجموعات والأعضاء تتم من داخل تليجرام والبوت المفعّل، وليس من نموذج التفعيل هنا.",
  },
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
  name: "تفعيل بوت تليجرام على شام AI",
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
  name: "بوتات شام AI العاملة على تليجرام",
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
  name: "تفعيل بوت تليجرام — شام AI",
  url: `${SITE}${PATH}`,
  inLanguage: "ar",
  description: "تفعيل بوت على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};

export const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "تفعيل بوت تليجرام — شام AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Telegram",
  url: `${SITE}${PATH}`,
  description: "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};
