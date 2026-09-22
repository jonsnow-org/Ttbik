import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import EarningsCalculatorForm from "./EarningsCalculatorForm";

const SITE = "https://souqtools.com";
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

export default function EarningsCalculatorPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <EarningsCalculatorForm />
      <section className="relative mx-auto max-w-lg px-4 pb-10">
        <p className="mb-4 text-xs leading-6 text-slate-500">
          الأرقام تقريبية للتخطيط وليست وعداً بربح. لا سحب نقدي من هذه الصفحة.
        </p>
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6">
          <AdSlot position="in-content" label="أسفل حاسبة أرباح البوت" />
        </div>
      </section>
    </>
  );
}
