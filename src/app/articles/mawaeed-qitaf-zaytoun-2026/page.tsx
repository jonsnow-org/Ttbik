import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/articles/mawaeed-qitaf-zaytoun-2026";
const TITLE = "مواعيد قطاف الزيتون 2026 في سوريا وافتتح المعاصر";
const DESCRIPTION =
  "جدول بدء قطاف الزيتون وافتتاح المعاصر لموسم 2026 حسب تعميم وزارة الزراعة: الساحل 1 أكتوبر، حمص 10 أكتوبر، وحلب ومعظم الداخل 15 أكتوبر. تقدير الإنتاج وأين يختلف نقل الصحف.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "مواعيد قطاف الزيتون 2026",
    "افتتاح معاصر الزيتون سوريا",
    "موسم الزيتون اللاذقية",
    "موسم الزيتون حلب",
    "تعميم وزارة الزراعة الزيتون",
  ],
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "article",
  },
};

const ROWS: { area: string; start: string; note: string }[] = [
  { area: "اللاذقية وطرطوس", start: "1 تشرين الأول 2026", note: "نقل تلفزيون سوريا عن التعميم" },
  { area: "حمص (ما عدا الريف الغربي)", start: "10 تشرين الأول 2026", note: "نقل تلفزيون سوريا" },
  { area: "الريف الغربي لحمص وحماة", start: "1 تشرين الأول 2026", note: "سانا: المعاصر تفتح مع الساحل" },
  { area: "حلب، معظم حماة، الغاب، دير الزور، الرقة، درعا", start: "15 تشرين الأول 2026", note: "نقل تلفزيون سوريا" },
  { area: "عفرين وجسر الشغور", start: "1 تشرين الأول 2026", note: "نقل تلفزيون سوريا" },
  { area: "أريحا", start: "20 تشرين الأول 2026", note: "نقل تلفزيون سوريا" },
  { area: "إدلب، خان شيخون، سراقب، معرة النعمان، حارم", start: "حتى 1 تشرين الثاني 2026", note: "الموعد الدقيق لكل ناحية في جدول التعميم" },
];

export default function OliveHarvestPage() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: TITLE,
    datePublished: "2026-10-07",
    dateModified: "2026-10-07",
    inLanguage: "ar",
    description: DESCRIPTION,
    author: { "@type": "Organization", name: "شام AI" },
    publisher: { "@type": "Organization", name: "شام AI" },
    url: `${SITE_URL}${PATH}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/" className="hover:text-slate-800">الرئيسة</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/articles" className="hover:text-slate-800">مقالات</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">موسم الزيتون 2026</li>
          </ol>
        </nav>
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="mb-3 text-[11px] font-bold text-emerald-800">مواسم · 7 أكتوبر 2026</p>
          <h1 className="text-2xl font-black leading-10 text-slate-900">{TITLE}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{DESCRIPTION}</p>
          <div className="my-6 min-h-[250px]">
            <AdSlot position="in-content" label="بطاقة إعلان بعد المقدمة" />
          </div>
          <div className="space-y-4 text-[15px] leading-8 text-slate-800">
            <p>في 4 أكتوبر 2026 أصدرت وزارة الزراعة تعميماً إلى مديرياتها يحدد بدء قطاف الزيتون وافتتاح المعاصر لموسم 2026. سانا أكدت التعميم ولم تنشر الجدول الكامل في متن الخبر، وأحالت التفاصيل إلى قناة الوزارة على تلغرام. الجدول أدناه يجمع ما نقلته سانا حرفياً مع ما فصّله تلفزيون سوريا عن التعميم نفسه.</p>
            <p>تُفتح المعاصر في كل محافظة مع موعد بدء القطاف المحدد لها. استثناء سانا: معاصر الريف الغربي في حماة وحمص تفتح مع الساحل في 1 أكتوبر 2026، لتشابه المناخ وبكور الأصناف. أصحاب المعاصر مطالبون بالصيانة والتجريب والتنظيف قبل 15 يوماً من الافتتاح الرسمي لمنطقتهم.</p>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-right text-sm">
              <caption className="mb-2 text-right text-sm font-black text-slate-900">بدء القطاف كما نُقل عن تعميم 4 أكتوبر 2026</caption>
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pl-3 font-bold">المنطقة</th>
                  <th className="py-2 pl-3 font-bold">البدء</th>
                  <th className="py-2 font-bold">الأساس</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.area} className="border-b border-slate-100">
                    <td className="py-2 pl-3 font-semibold text-slate-900">{row.area}</td>
                    <td className="py-2 pl-3">{row.start}</td>
                    <td className="py-2 text-slate-600">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-600">صحف نقلت مواعيد لريف دمشق والسويداء والقنيطرة والحسكة تختلف بينها (20 أو 25 أكتوبر في بعض النقل). هذه الخانات ليست في متن سانا ولا في تفصيل تلفزيون سوريا، لذلك ليست في الجدول. المرجع عند التعارض: منشور الوزارة.</p>
          <div className="mt-8 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
            <p className="mb-2 text-sm font-black text-emerald-900">تقدير الإنتاج</p>
            <ul className="list-disc space-y-1 pr-5 text-sm leading-7 text-emerald-950">
              <li>ثمار الزيتون: نحو 954730 طناً، تقدير مدير مكتب الزيتون محمد قواس، نقلته سانا.</li>
              <li>20% لزيتون المائدة و80% للعصر.</li>
              <li>زيت متوقع: نحو 190946 طناً على نسبة عصر 25%. الرقم تقدير لا سعر سوق.</li>
            </ul>
          </div>
        </article>
        <p className="mt-8 text-sm">
          <a className="font-bold text-sky-800 hover:underline" href="https://sana.sy/locals/2597224/" target="_blank" rel="noopener noreferrer">خبر سانا</a>
          {" · "}
          <a className="font-bold text-sky-800 hover:underline" href="https://t.me/SyrMOfA/5925" target="_blank" rel="noopener noreferrer">التعميم على تلغرام الوزارة</a>
          {" · "}
          <a className="font-bold text-sky-800 hover:underline" href="https://www.syria.tv/%D9%88%D8%B2%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B2%D8%B1%D8%A7%D8%B9%D8%A9-%D8%AA%D8%AD%D8%AF%D8%AF-%D9%85%D9%88%D8%A7%D8%B9%D9%8A%D8%AF-%D9%82%D8%B7%D8%A7%D9%81-%D8%A7%D9%84%D8%B2%D9%8A%D8%AA%D9%88%D9%86-%D9%88%D8%A7%D9%81%D8%AA%D8%AA%D8%A7%D8%AD-%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D8%B5%D8%B1-%D9%84%D9%85%D9%88%D8%B3%D9%85-2026-%D9%81%D9%8A-%D8%B3%D9%88%D8%B1%D9%8A%D8%A7" target="_blank" rel="noopener noreferrer">تلفزيون سوريا</a>
          {" · "}
          <Link href="/articles" className="font-bold text-sky-800 hover:underline">كل المقالات</Link>
        </p>
      </main>
    </>
  );
}
