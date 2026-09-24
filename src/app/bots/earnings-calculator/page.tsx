import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EarningsCalculatorForm from "./EarningsCalculatorForm";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots/earnings-calculator";

export const metadata: Metadata = {
  title: "حاسبة أرباح قناة أو بوت تليجرام | سوق تولز",
  description:
    "قدّر أرباحك الشهرية التقريبية من الإعلانات على قناة أو بوت تليجرام حسب المشاهدات وCPM ونسبة بيع المساحات. أرقام تخطيط فقط — ليست وعداً بربح ولا سحب نقدي.",
  keywords: [
    "حاسبة أرباح تليجرام",
    "أرباح قناة تلغرام",
    "حاسبة CPM تليجرام",
    "ربح من بوت تليجرام",
    "سوق تولز",
  ],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "حاسبة أرباح قناة أو بوت تليجرام | سوق تولز",
    description:
      "تقدير تقريبي للأرباح من مشاهدات القناة أو البوت. للتخطيط فقط، بلا سحب نقدي وبلا وعد بربح.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "حاسبة أرباح قناة أو بوت تليجرام | سوق تولز",
    description: "تقدير تقريبي حسب المشاهدات وCPM. ليست وعداً بربح.",
    images: [`${SITE}/opengraph-image`],
  },
};

const FAQ = [
  {
    q: "هل الرقم الظاهر ربح مضمون؟",
    a: "لا. الحاسبة تعطي تقديراً تقريبياً للتخطيط فقط حسب المشاهدات وCPM ونسبة بيع المساحات التي تدخلها أنت.",
  },
  {
    q: "هل يمكن سحب المبلغ نقداً من هنا؟",
    a: "لا يوجد سحب نقدي عبر سوق تولز. النتيجة تقدير وليست رصيداً قابلاً للسحب.",
  },
  {
    q: "على ماذا يعتمد التقدير؟",
    a: "متوسط مشاهدات المنشور × عدد المنشورات الشهرية × نسبة بيع المساحات × CPM لكل ألف مشاهدة.",
  },
  {
    q: "كيف أستخدم الحاسبة خطوة بخطوة؟",
    a: "أدخل متوسط المشاهدات ثم المنشورات الشهرية ثم نسبة البيع وCPM. الرقم الناتج تخطيط فقط وليس رصيداً.",
  },
];

const STEPS = [
  {
    name: "أدخل المشاهدات والمنشورات",
    text: "ضع متوسط مشاهدات المنشور وعدد المنشورات في الشهر.",
  },
  {
    name: "حدّد نسبة البيع وCPM",
    text: "نسبة بيع المساحات وCPM لكل ألف مشاهدة من تقديرك أو عروضك الحالية.",
  },
  {
    name: "اقرأ التقدير فقط",
    text: "النتيجة رقم تخطيط. ليست وعداً بربح ولا رصيداً قابلاً للسحب.",
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
    { "@type": "ListItem", position: 3, name: "حاسبة الأرباح", item: `${SITE}${PATH}` },
  ],
};

const HOWTO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "تقدير أرباح قناة أو بوت تليجرام",
  description:
    "أدخل المشاهدات وCPM ونسبة البيع للحصول على تقدير شهري تقريبي بلا سحب نقدي.",
  inLanguage: "ar",
  step: STEPS.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.name,
    text: s.text,
  })),
};

export default function EarningsCalculatorPage() {
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
          <li className="font-semibold text-slate-800">حاسبة الأرباح</li>
        </ol>
      </nav>
      <EarningsCalculatorForm />
      <section className="relative mx-auto max-w-lg px-4 pb-10">
        <p className="mb-4 text-xs leading-6 text-slate-500">
          الأرقام تقريبية للتخطيط وليست وعداً بربح. لا سحب نقدي من هذه الصفحة.
        </p>
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">كيف تستخدم الحاسبة</h2>
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
        <aside className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby="earn-related">
          <h3 id="earn-related" className="mb-2 text-sm font-extrabold text-slate-900">
            روابط داخلية
          </h3>
          <ul className="space-y-2 text-sm font-bold text-indigo-800">
            <li>
              <Link href="/bots/health-check" className="hover:underline">
                فاحص صحة البوت ← توكن وويبهوك بلا حفظ التوكن
              </Link>
            </li>
            <li>
              <Link href="/bots" className="hover:underline">
                تفعيل بوت على توكنك
              </Link>
            </li>
            <li>
              <Link href="/news" className="hover:underline">
                أخبار سوق تولز
              </Link>
            </li>
          </ul>
        </aside>
        <div className="mt-6">
          <AdSlot position="in-content" label="أسفل حاسبة أرباح البوت" />
        </div>
      </section>
    </>
  );
}
