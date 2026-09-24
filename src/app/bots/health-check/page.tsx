import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import HealthCheckForm from "./HealthCheckForm";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots/health-check";

export const metadata: Metadata = {
  title: "فاحص صحة بوت تليجرام | سوق تولز",
  description:
    "افحص مجاناً هل بوت تليجرام ما زال يعمل: التوكن، الويبهوك، شهادة HTTPS، ووجود التوكن داخل رابط الويبهوك. تقرير فوري بدون حفظ التوكن.",
  keywords: [
    "فاحص بوت تليجرام",
    "فحص ويبهوك تليجرام",
    "telegram bot webhook check",
    "صحة بوت تلغرام",
    "سوق تولز",
  ],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "فاحص صحة بوت تليجرام | سوق تولز",
    description:
      "تحقق فوري من توكن البوت والويبهوك وشهادة HTTPS. مجاني وللتخطيط الفني فقط.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "فاحص صحة بوت تليجرام | سوق تولز",
    description: "فحص توكن وويبهوك تليجرام مجاناً. لا نحفظ التوكن.",
    images: [`${SITE}/opengraph-image`],
  },
};

const FAQ = [
  {
    q: "هل تحفظون توكن البوت؟",
    a: "لا. الفحص يتم في الجلسة الحالية فقط ولا يُستخدم لإنشاء بوت أو سحب أي رصيد.",
  },
  {
    q: "ماذا يعني ويبهوك غير HTTPS؟",
    a: "تليجرام يرفض ويبهوك غير مشفَّر. استخدم عنوان يبدأ بـ https:// حتى يعمل الاستقبال.",
  },
  {
    q: "هل ظهور التوكن داخل رابط الويبهوك خطر؟",
    a: "نعم غالباً. أي من يستطيع قراءة السجلات أو الرابط يرى التوكن. انقل السر إلى الترويسة أو مسار محمي.",
  },
  {
    q: "ماذا تعني التحديثات المعلَّقة على الويبهوك؟",
    a: "عدد pending_update_count يرتفع إذا توقَّف المستقبل أو بطؤ. رقم صغير غير حرج. أكثر من 100 يستحق مراجعة الخادم.",
  },
  {
    q: "كيف أفحص البوت خطوة بخطوة؟",
    a: "انسخ التوكن من BotFather ثم الصقه هنا واضغط افحص الآن. اقرأ تقرير HTTPS والمنفذ والتحديثات المعلّقة دون حفظ التوكن.",
  },
];

const STEPS = [
  {
    name: "انسخ التوكن",
    text: "من BotFather انسخ توكن البوت فقط. لا ترسله لأي شخص.",
  },
  {
    name: "الصق وافحص",
    text: "الصق التوكن في الحقل ثم اضغط افحص الآن.",
  },
  {
    name: "اقرأ التقرير",
    text: "راجع HTTPS والمنفذ والتحديثات المعلّقة وملاحظة التوكن في الرابط.",
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

const BREADCRUMB_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "البوتات", item: `${SITE}/bots` },
    { "@type": "ListItem", position: 3, name: "فاحص صحة البوت", item: `${SITE}${PATH}` },
  ],
};

const HOWTO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "فحص صحة بوت تليجرام",
  description: "الصق توكن BotFather للحصول على تقرير ويبهوك وهوية البوت بدون حفظ التوكن.",
  inLanguage: "ar",
  step: STEPS.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.name,
    text: s.text,
  })),
};

export default function BotHealthCheckPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSON_LD) }}
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
          <li>
            <Link href="/bots" className="hover:text-slate-800">
              البوتات
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-slate-800">فاحص صحة البوت</li>
        </ol>
      </nav>
      <HealthCheckForm />
      <section className="relative mx-auto max-w-lg px-4 pb-10">
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">كيف تفحص البوت</h2>
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
        <aside className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby="hc-related">
          <h3 id="hc-related" className="mb-2 text-sm font-extrabold text-slate-900">
            روابط داخلية
          </h3>
          <ul className="space-y-2 text-sm font-bold text-indigo-800">
            <li>
              <Link href="/bots/earnings-calculator" className="hover:underline">
                حاسبة تقدير أرباح البوت ← أرقام تقريبية بلا سحب نقدي
              </Link>
            </li>
            <li>
              <Link href="/news" className="hover:underline">
                أخبار سوق تولز
              </Link>
            </li>
            <li>
              <Link href="/bots" className="hover:underline">
                تفعيل بوت على توكنك
              </Link>
            </li>
          </ul>
        </aside>
        <div className="mt-6">
          <AdSlot position="in-content" label="أسفل فاحص صحة البوت" />
        </div>
      </section>
    </>
  );
}
