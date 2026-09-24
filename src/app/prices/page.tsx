import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { fetchEcbRates } from "@/lib/ecbRates";

const PATH = "/prices";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "أسعار الصرف المرجعية | سوق تولز",
  description:
    "جدول أسعار صرف مقابل اليورو من نشرة المصرف المركزي الأوروبي اليومية، مع تاريخ المصدر. بلا تقدير.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

const FAQ = [
  {
    q: "من أين تأتي الأرقام؟",
    a: "من نشرة المصرف المركزي الأوروبي اليومية eurofxref-daily.xml فقط. تاريخ النشرة ورابط المصدر ظاهران في الصفحة.",
  },
  {
    q: "لماذا لا يظهر الريال أو الدرهم أو الجنيه؟",
    a: "هذه العملات ليست في جدول ECB المرجعي مقابل اليورو. لا نخترع سعراً ولا نحوّل عبر وسيط غير منشور في المصدر.",
  },
  {
    q: "هل هذا سعر الصرافة في السوق المحلي؟",
    a: "لا. الرقم مرجعي مقابل اليورو من ECB، وليس سعر بيع/شراء في بنك أو محل صرافة.",
  },
];

export default async function PricesPage() {
  const snap = await fetchEcbRates();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "أسعار الصرف المرجعية",
    url: `${SITE_URL}${PATH}`,
    dateModified: snap?.date,
    description: "أسعار ECB الرسمية مقابل اليورو مع تاريخ النشرة.",
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "أسعار الصرف", item: `${SITE_URL}${PATH}` },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <main className="mx-auto max-w-2xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">أسعار الصرف</li>
          </ol>
        </nav>
        <h1 className="mb-3 text-3xl font-extrabold text-slate-900">أسعار الصرف المرجعية</h1>
        <p className="mb-4 text-sm leading-7">
          الأرقام أدناه من نشرة ECB اليومية فقط. ليست أسعار صرافة محلية وليست تقديراً. الريال
          السعودي والدرهم والجنيه المصري ليست في هذا الجدول؛ لذلك لا نعرض لها رقماً.
        </p>
        {snap ? (
          <>
            <p className="mb-4 text-xs text-slate-500">
              تاريخ النشرة: {snap.date} · المصدر:{" "}
              <a href={snap.sourceUrl} className="underline" rel="noopener noreferrer">
                {snap.sourceName}
              </a>
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold">العملة</th>
                    <th className="px-3 py-2 text-right font-semibold">الرمز</th>
                    <th className="px-3 py-2 text-right font-semibold">وحدات لكل 1 يورو</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.rates.map((r) => (
                    <tr key={r.currency} className="border-t border-slate-100">
                      <td className="px-3 py-2">{r.nameAr}</td>
                      <td className="px-3 py-2 font-mono">{r.currency}</td>
                      <td className="px-3 py-2 font-mono">{r.perEuro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            لا تتوفر أرقام اليوم من المصدر. لم نضع بديلاً تقديرياً.
          </p>
        )}
        <AdSlot position="in-content" label="وسط صفحة أسعار الصرف" />
        <h2 className="mb-3 mt-8 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
          {" · "}
          <Link href="/word-of-day" className="font-bold text-indigo-800 hover:underline">
            كلمة اليوم ←
          </Link>
        </p>
      </main>
    </>
  );
}
