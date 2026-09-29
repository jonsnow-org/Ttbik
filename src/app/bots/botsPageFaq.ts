import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE, PATH, STEPS } from "./botsPageCopy";

export const FAQ = [
  { q: "هل أحصل على كود مصدري للبوت؟", a: "لا. المنتج بوت يعمل على توكنك. لا تحميل كوداً ولا بيع ملفات مصدرية." },
  { q: "هل يوجد سحب نقدي من البوت؟", a: "لا. النقاط داخل البوت فقط. لا يوجد سحب نقدي عبر سوق تولز." },
  { q: "كيف أفعّل بوتاً؟", a: "بعد طلب معتمد برمز طلب واحد لكل بوت. المالك يمكنه التجاوز للاختبار. الصق توكن BotFather في النموذج." },
  { q: "كيف أتأكد أن البوت يعمل؟", a: "استخدم فاحص صحة البوت للتوكن والويبهوك بلا حفظ التوكن." },
  { q: "هل أشارك توكن BotFather مع أحد؟", a: "لا. التوكن مفتاح البوت. الصقه فقط في نموذج التفعيل أو فاحص الصحة على هذا الموقع." },
  { q: "ماذا أفعل بعد التفعيل؟", a: "أرسل /start للبوت. إن لم يرد استخدم فاحص الصحة. الفحص لا يستهلك رمز الطلب. طلب واحد = بوت واحد." },
  { q: "هل أغيّر عنوان المجموعة أو صورتها أو أخرج البوت من الدردشة من نموذج الموقع (setChatTitle / leaveChat)؟", a: "لا. setChatTitle وsetChatDescription وsetChatPhoto وdeleteChatPhoto وleaveChat من تليجرام فقط. الموقع لا يغيّر عنوان مجموعة ولا صورتها ولا يُخرج البوت نيابة عنك. لا رمز طلب إضافياً. طلب واحد = بوت واحد." },
  { q: "هل أثبّت أو أفك تثبيت رسالة في المجموعة من الموقع (pinChatMessage / unpinChatMessage)؟", a: "لا. pinChatMessage وunpinChatMessage وunpinAllChatMessages من تليجرام فقط. الموقع لا يثبّت رسائل ولا يفك تثبيتها نيابة عنك. لا رمز طلب إضافياً. طلب واحد = بوت واحد." },
  { q: "هل أنشئ أو ألغي رابط دعوة للمجموعة من الموقع (exportChatInviteLink / createChatInviteLink)؟", a: "لا. exportChatInviteLink وcreateChatInviteLink وeditChatInviteLink وrevokeChatInviteLink من تليجرام فقط. الموقع لا يُنشئ رابط دعوة ولا يلغيه نيابة عنك. لا رمز طلب إضافياً. طلب واحد = بوت واحد." },
  { q: "هل أحظر أو أرفع حظر عضو أو أقيّد صلاحياته من الموقع (banChatMember / unbanChatMember / restrictChatMember / promoteChatMember)؟", a: "لا. banChatMember وunbanChatMember وrestrictChatMember وpromoteChatMember من تليجرام فقط. الموقع لا يحظر عضواً ولا يرفع حظراً ولا يقيّد صلاحيات نيابة عنك. لا رمز طلب إضافياً. طلب واحد = بوت واحد." },
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
