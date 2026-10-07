import type { Metadata } from "next";
import Link from "next/link";
import { fetchMarkets } from "@/lib/markets";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/markets";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "سعر الذهب اليوم والدولار مقابل الليرة والريال والعملات الرقمية",
  description:
    "شريط حي لسعر أونصة الذهب وغرام 24، وبتكوين وإيثيريوم وسولانا، والدولار مقابل الليرة التركية والسورية والريال السعودي والدرهم والجنيه. مرجع مجاني وليس سعر صرافة.",
  keywords: [
    "سعر الذهب اليوم",
    "دولار ليرة تركية",
    "دولار ليرة سورية",
    "سعر البتكوين",
    "ريال سعودي",
    "درهم إماراتي",
    "شام AI",
  ],
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    title: "أسعار الذهب والدولار والعملات الرقمية | شام AI",
    description: "مرجع يومي مجاني للذهب والعملات الرقمية والدولار مقابل عملات الشرق الأوسط.",
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "website",
  },
};

function cell(n: number | null, digits = 2) {
  if (n == null) return "غير متاح";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default async function MarketsPage() {
  const data = await fetchMarkets();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "أسعار الذهب والدولار والعملات الرقمية",
    url: `${SITE_URL}${PATH}`,
    dateModified: data.updatedAt,
    description: "مرجع سوقي مجاني، ليس سعر صرافة محلي.",
  };
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="text-xs font-bold text-amber-700">شام AI · مرجع سوقي</p>
      <h1 className="mt-1 text-2xl font-extrabold text-slate-900">سعر الذهب اليوم والدولار مقابل عملات الشرق الأوسط</h1>
      <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
        الشريط أعلى الموقع يتحدث كل خمس دقائق. الأرقام هنا نفسها: ذهب، ثلاث عملات رقمية، والدولار مقابل 14 عملة.
        ليست سعر بيع في محل، وليست توصية.
      </p>
      <p className="mt-2 text-xs text-slate-500">آخر جلب: {data.updatedAt} · {data.note}</p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["أونصة الذهب", cell(data.goldUsd, 0) + " $"],
          ["غرام 24", cell(data.goldGram24) + " $"],
          ["غرام 21", cell(data.goldGram21) + " $"],
          ["غرام 21 بالليرة السورية", cell(data.goldGram21Syp, 0) + " ل.س"],
          ["غرام 21 بالليرة التركية", cell(data.goldGram21Try, 0) + " ₺"],
          ["دولار / ليرة سورية", cell(data.sypPerUsd, 2)],
          ["دولار / ليرة تركية", cell(data.tryPerUsd, 2)],
          ["بتكوين", cell(data.btc, 0) + " $"],
          ["إيثيريوم", cell(data.eth, 0) + " $"],
          ["سولانا", cell(data.sol) + " $"],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-bold text-slate-500">{label}</h2>
            <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-extrabold">دولار واحد مقابل</h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right">العملة</th>
                <th className="px-3 py-2 text-right">الرمز</th>
                <th className="px-3 py-2 text-right">السعر</th>
                <th className="px-3 py-2 text-right">المصدر</th>
              </tr>
            </thead>
            <tbody>
              {data.fx.map((row) => (
                <tr key={row.code} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold">{row.name}</td>
                  <td className="px-3 py-2">{row.code}</td>
                  <td className="px-3 py-2">{cell(row.rate, row.rate && row.rate > 100 ? 1 : 4)}</td>
                  <td className="px-3 py-2 text-slate-500">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 text-sm text-slate-600">
        نشرة البنك المركزي السوري للذهب المحلي تبقى في قسم الأحداث عند صدورها. هذه الصفحة سعر عالمي فقط.
        {" "}
        <Link href="/news" className="font-bold text-brand-700">الأخبار</Link>
        {" · "}
        <Link href="/events" className="font-bold text-brand-700">الأحداث</Link>
        {" · "}
        <Link href="/prices" className="font-bold text-brand-700">صرف اليورو المرجعي</Link>
      </p>
    </main>
  );
}
