import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import HealthCheckForm from "./HealthCheckForm";

const SITE = "https://souqtools.com";
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
    a: "تليجرام يرفض ويبهوك غير مشفّر. استخدم عنوان يبدأ بـ https:// حتى يعمل الاستقبال.",
  },
  {
    q: "هل ظهور التوكن داخل رابط الويبهوك خطر؟",
    a: "نعم غالباً. أي من يستطيع قراءة السجلات أو الرابط يرى التوكن. انقل السر إلى الترويسة أو مسار محمي.",
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

export default function BotHealthCheckPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <HealthCheckForm />
      <section className="relative mx-auto max-w-lg px-4 pb-10">
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
          <AdSlot position="in-content" label="أسفل فاحص صحة البوت" />
        </div>
      </section>
    </>
  );
}
