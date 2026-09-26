import type { Metadata } from "next";
import Link from "next/link";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots";

export const metadata: Metadata = {
  title: "تفعيل بوت تليجرام — سوق تولز",
  description:
    "فعّل بوت تليجرام يعمل فعلياً على توكنك الخاص خلال دقائق: مشاهدة إعلانات وربح نقاط، محفظة، وإحالة. منتج جاهز تملكه وتشغّله فوراً — بدون كتابة أي شيء.",
  keywords: [
    "بوت تليجرام",
    "تفعيل بوت تليجرام",
    "بوت مستضاف",
    "سوق تولز",
    "توكن BotFather",
    "بعد تفعيل البوت",
    "إعادة توليد التوكن",
    "اسم مستخدم البوت",
    "ويبهوك البوت",
    "setWebhook",
    "حذف البوت من BotFather",
    "استرجاع توكن البوت",
    "إضافة البوت لمجموعة",
    "setprivacy",
    "setjoingroups",
    "حد رسائل تليجرام",
    "flood",
    "أوامر البوت",
    "setcommands",
    "قائمة الأوامر",
    "بدء المحادثة",
    "/start",
    "مراسلة بدون ستارت",
  ],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "تفعيل بوت تليجرام — سوق تولز",
    description:
      "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "تفعيل بوت تليجرام — سوق تولز",
    description: "منتج جاهز على توكنك. طلب واحد = بوت واحد. لا سحب نقدي.",
    images: [`${SITE}/opengraph-image`],
  },
};

const TERMS = [
  "المنتج بوت يعمل على توكنك — ليس ملف كود للتحميل.",
  "طلب معتمد واحد = بوت واحد. لا يُعاد استخدام رمز الطلب.",
  "لا يوجد سحب نقدي عبر سوق تولز. النقاط داخل البوت فقط.",
];

const PREP = [
  "أنشئ بوتاً من @BotFather وانسخ التوكن فقط — لا تلصقه في محادثة عامة.",
  "اختياري: افحص التوكن من فاحص الصحة قبل التفعيل.",
  "رمز طلب معتمد واحد لكل بوت. المالك يتجاوز للاختبار فقط.",
];

const AFTER = [
  "افتح البوت في تليجرام وأرسل /start.",
  "إن لم يرد: افحص الويبهوك من فاحص الصحة — الفحص لا يستهلك رمز الطلب.",
  "لا تشارك التوكن ولا تعد استخدام رمز طلب لبوت ثانٍ.",
];

const LIMITS = [
  "اسم المستخدم والوصف والصورة تُضبط من @BotFather — ليس من هذا النموذج.",
  "إعادة توليد التوكن من BotFather تقطع الويبهوك حتى يُحدّث التوكن عند المالك. لا تفتح بوتاً ثانياً بنفس رمز الطلب.",
  "بعد التفعيل: لا تغيّر عنوان الويبهوك يدوياً من BotFather أو setWebhook — يقطع التشغيل. افحص الويبهوك من فاحص الصحة فقط.",
  "حذف البوت من BotFather لا يعيد رمز الطلب ولا يفتح بوتاً ثانياً بنفس الرمز.",
  "الموقع لا يعرض التوكن بعد التفعيل ولا يرسله لاحقاً. ضياعه يتطلب إعادة توليد من BotFather ثم تحديثاً عند المالك — بلا بوت ثانٍ بنفس الرمز.",
  "إضافة البوت لمجموعة أو قناة تُدار من تليجرام وBotFather فقط (/setjoingroups و/setprivacy) — ليست من هذا النموذج ولا تعيد رمز الطلب.",
  "حد تيليجرام نفسه: الإرسال المتكرر قد يوقف البوت مؤقتاً (flood). الموقع لا يرفع حد واجهة تيليجرام ولا يتخطاه.",
  "قائمة الأوامر الظاهرة في تليجرام (/ ثم القائمة) تُضبط من @BotFather بأمر /setcommands — ليست من هذا النموذج ولا تغيّر رمز الطلب.",
  "البوت لا يراسل من لم يضغط /start. هذا قيد تليجرام — الموقع لا يتجاوزه ولا يرسل رسائل جماعية نيابة عنك.",
  "النقاط داخل البوت فقط — لا سحب نقدي عبر سوق تولز.",
];

const INCLUDES = [
  "تشغيل القالب على توكن BotFather الذي تلصقه أنت",
  "بوت واحد لكل رمز طلب معتمد — بلا إعادة استخدام الرمز",
  "نقاط داخل البوت فقط — بلا سحب نقدي من سوق تولز",
  "ليس ملف كود وليس تحميل مصدر",
];

const FAQ = [
  {
    q: "هل أحصل على كود مصدري للبوت؟",
    a: "لا. المنتج بوت يعمل على توكنك. لا تحميل كوداً ولا بيع ملفات مصدرية.",
  },
  {
    q: "هل يوجد سحب نقدي من البوت؟",
    a: "لا. النقاط داخل البوت فقط. لا يوجد سحب نقدي عبر سوق تولز.",
  },
  {
    q: "كيف أفعّل بوتاً؟",
    a: "بعد طلب معتمد برمز طلب واحد لكل بوت. المالك يمكنه التجاوز للاختبار. الصق توكن BotFather في النموذج.",
  },
  {
    q: "كيف أتأكد أن البوت يعمل؟",
    a: "استخدم فاحص صحة البوت للتوكن والويبهوك بلا حفظ التوكن.",
  },
  {
    q: "هل أشارك توكن BotFather مع أحد؟",
    a: "لا. التوكن مفتاح البوت. الصقه فقط في نموذج التفعيل أو فاحص الصحة على هذا الموقع.",
  },
  {
    q: "ماذا أفعل بعد التفعيل؟",
    a: "أرسل /start للبوت. إن لم يرد استخدم فاحص الصحة. الفحص لا يستهلك رمز الطلب. طلب واحد = بوت واحد.",
  },
  {
    q: "ماذا يحدث إن أعدت توليد التوكن من BotFather؟",
    a: "التوكن القديم يبطل ويتوقف الويبهوك. لا تفتح بوتاً جديداً بنفس رمز الطلب. التحديث عند المالك. اسم المستخدم يبقى من BotFather.",
  },
  {
    q: "هل أغيّر عنوان الويبهوك بعد التفعيل؟",
    a: "لا. تغيير الويبهوك يدوياً من BotFather أو setWebhook يقطع البوت. افحصه من فاحص الصحة. الفحص لا يستهلك رمز الطلب.",
  },
  {
    q: "حذفت البوت من BotFather هل أسترجع رمز الطلب؟",
    a: "لا. طلب واحد = بوت واحد. الحذف من تليجرام لا يعيد الرمز ولا يسمح ببوت ثانٍ بنفس الطلب. لا سحب نقدي.",
  },
  {
    q: "هل أسترجع التوكن من الموقع بعد التفعيل؟",
    a: "لا. التوكن لا يُعرض بعد التفعيل ولا يُرسل بالبريد. أعد توليده من BotFather ثم حدّثه عند المالك. لا بوت ثانٍ بنفس رمز الطلب.",
  },
  {
    q: "هل أضيف البوت لمجموعة من الموقع بعد التفعيل؟",
    a: "لا. الإضافة من تليجرام. السماح بالمجموعات وخصوصية الرسائل من BotFather (/setjoingroups و/setprivacy). الموقع لا يدير عضوية المجموعات. طلب واحد = بوت واحد.",
  },
  {
    q: "هل الموقع يرفع حد رسائل تيليجرام؟",
    a: "لا. حد الفيض (flood) من تيليجرام. الموقع لا يرفع حد Bot API ولا يتخطاه. الإرسال المتكرر قد يوقف البوت مؤقتاً.",
  },
  {
    q: "هل أضبط قائمة أوامر البوت من نموذج الموقع؟",
    a: "لا. قائمة الأوامر الظاهرة في تليجرام من @BotFather فقط بأمر /setcommands. النموذج لا يضبط القائمة ولا يستهلك رمز الطلب. طلب واحد = بوت واحد.",
  },
  {
    q: "هل البوت يراسل من لم يبدأ المحادثة؟",
    a: "لا. تليجرام يمنع مراسلة من لم يرسل /start. الموقع لا يتجاوز هذا القيد ولا يرسل جماعياً. طلب واحد = بوت واحد.",
  },
];

const STEPS = [
  {
    name: "احصل على رمز طلب معتمد",
    text: "طلب واحد = بوت واحد. المالك يمكنه تجاوز بوابة الدفع للاختبار.",
  },
  {
    name: "انسخ بوتاً من BotFather",
    text: "انسخ بوتاً جديداً في تليجرام وانسخ التوكن. لا ترسل التوكن لأحد.",
  },
  {
    name: "الصق التوكن في النموذج",
    text: "الصق التوكن ورمز الطلب ثم فعّل. المنتج بوت عامل على توكنك، ليس كوداً للتحميل.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

const HOWTO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "تفعيل بوت تليجرام على سوق تولز",
  description:
    "طلب معتمد واحد لكل بوت، ثم توكن BotFather في النموذج. لا كود للبيع ولا سحب نقدي.",
  inLanguage: "ar",
  step: STEPS.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.name,
    text: s.text,
  })),
};

const LIVE_BOTS_JSON_LD = {
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

const BREADCRUMB_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "البوتات", item: `${SITE}${PATH}` },
  ],
};

const WEBPAGE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "تفعيل بوت تليجرام — سوق تولز",
  url: `${SITE}${PATH}`,
  inLanguage: "ar",
  description:
    "تفعيل بوت على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};

const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "تفعيل بوت تليجرام — سوق تولز",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Telegram",
  url: `${SITE}${PATH}`,
  description:
    "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
};

export default function BotsDeployPage() {
  const isOwner = isOwnerServer();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBPAGE_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LIVE_BOTS_JSON_LD) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOWTO_JSON_LD) }}
      />
      <nav className="relative mx-auto max-w-lg px-4 pt-6 text-sm text-slate-500" aria-label="مسار التنقل">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/" className="hover:text-slate-800">
              الرئيسة
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-slate-800">البوتات</li>
        </ol>
      </nav>
      <aside className="relative mx-auto max-w-lg px-4 pb-4" aria-labelledby="bots-terms">
        <h2 id="bots-terms" className="mb-2 text-sm font-extrabold text-slate-900">
          شروط المنتج
        </h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-4" aria-labelledby="bots-prep">
        <h2 id="bots-prep" className="mb-2 text-sm font-extrabold text-slate-900">
          قبل لصق التوكن
        </h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {PREP.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          <Link href="/bots/health-check" className="font-bold text-indigo-800 hover:underline">
            فاحص صحة البوت ←
          </Link>{" "}
          بلا حفظ التوكن.
        </p>
      </aside>
      <BotsDeployForm
        isOwner={isOwner}
        adSlot={<AdSlot position="in-content" label="أسفل نموذج تفعيل البوت" />}
      />
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-after">
        <h2 id="bots-after" className="mb-2 text-sm font-extrabold text-slate-900">
          بعد التفعيل
        </h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {AFTER.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-limits">
        <h2 id="bots-limits" className="mb-2 text-sm font-extrabold text-slate-900">
          حدود بعد التشغيل
        </h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {LIMITS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-includes">
        <h2 id="bots-includes" className="mb-2 text-sm font-extrabold text-slate-900">
          ما يشمله التفعيل
        </h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {INCLUDES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="live-bots">
        <h2 id="live-bots" className="mb-2 text-sm font-extrabold text-slate-900">
          بوتات عاملة يمكنك تجربها الآن على تليجرام
        </h2>
        <p className="mb-3 text-xs leading-5 text-slate-500">
          روابط مباشرة إلى البوت على تليجرام — بلا معلمة إحالة. ليست كوداً للتحميل.
        </p>
        <ul className="space-y-2">
          {LIVE_BOTS.map((bot) => (
            <li key={bot.href} className="rounded-xl border border-slate-200 bg-white p-3">
              <a
                href={bot.href}
                className="text-sm font-extrabold text-indigo-800 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {bot.title} ←
              </a>
              <p className="mt-1 text-xs leading-5 text-slate-600">{bot.desc}</p>
              <p className="mt-1 text-[11px] text-slate-400">t.me مباشر — بلا ?start= وبلا إحالة</p>
            </li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-related">
        <h2 id="bots-related" className="mb-2 text-sm font-extrabold text-slate-900">
          أدوات بوت مجانية على الموقع
        </h2>
        <ul className="space-y-2 text-sm font-bold text-indigo-800">
          <li>
            <Link href="/bots/health-check" className="hover:underline">
              فاحص صحة البوت ← توكن وويبهوك بلا حفظ التوكن
            </Link>
          </li>
          <li>
            <Link href="/bots/earnings-calculator" className="hover:underline">
              حاسبة أرباح القناة ← تقدير تخطيطي بلا سحب نقدي
            </Link>
          </li>
          <li>
            <Link href="/service/media-bot-premium" className="hover:underline">
              💎 ترقية بوت تحميل الوسائط ← 50 تحميلاً يومياً بدل 8
            </Link>
          </li>
          <li>
            <Link href="/watch-and-earn" className="hover:underline">
              اربح من مشاهدة الإعلانات ← كمستخدم في بوت قائم
            </Link>
          </li>
        </ul>
      </aside>
      <section className="relative mx-auto max-w-lg px-4 pb-10">
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">كيف تفعّل البوت</h2>
        <ol className="mb-8 list-decimal space-y-2 pr-5 text-sm leading-6 text-slate-600">
          {STEPS.map((s) => (
            <li key={s.name}>
              <span className="font-bold text-slate-800">{s.name}: </span>
              {s.text}
            </li>
          ))}
        </ol>
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
