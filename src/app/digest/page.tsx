import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EditorialHero from "@/components/editorial/EditorialHero";
import { latestArticles } from "@/lib/articlesIndex";
import { latestEvent } from "@/lib/eventsIndex";
import { latestNewsItem } from "@/lib/newsItems";
import { interleaveNews, fetchAllNews } from "@/lib/newsRss";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/digest";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "ملخص اليوم | سوق تولز",
  description:
    "صفحة واحدة لحدث اليوم وخبر اليوم ومقال مفيد وعناوين عاجلة من مصادر عربية — ابدأ من هنا يومياً.",
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "ملخص اليوم | سوق تولز",
    description: "حدث + خبر + مقال + عاجل في صفحة واحدة.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
};

export default async function DigestPage() {
  const event = latestEvent();
  const news = latestNewsItem();
  const article = latestArticles(1)[0];
  const rss = interleaveNews(await fetchAllNews(), 8);
  const today = new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Asia/Riyadh",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
      <EditorialHero
        crumbs={[{ href: "/", label: "الرئيسة" }, { label: "ملخص اليوم" }]}
        title="ملخص اليوم"
        subtitle={`${today} — حدث موثّق، خبر بمصادر، مقال يقدّم قيمة، وعناوين عاجلة من وكالات عربية. صفحة واحدة لتبدأ يومك.`}
        links={[
          { href: "/events", label: "الأحداث" },
          { href: "/news", label: "الأخبار" },
          { href: "/articles", label: "المقالات" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {event && (
          <Link href={`/events/${event.slug}`} className="group rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm transition hover:shadow-md">
            <p className="text-[11px] font-black text-indigo-600">① حدث اليوم</p>
            <h2 className="mt-2 text-lg font-black leading-8 text-slate-900 group-hover:text-sky-800">{event.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-7 text-slate-600">{event.blurb}</p>
            <p className="mt-3 text-xs font-bold text-indigo-700">التفاصيل ←</p>
          </Link>
        )}
        {news && (
          <Link href={`/news/${news.slug}`} className="group rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition hover:shadow-md">
            <p className="text-[11px] font-black text-sky-600">② خبر اليوم</p>
            <h2 className="mt-2 text-lg font-black leading-8 text-slate-900 group-hover:text-sky-800">{news.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-7 text-slate-600">{news.description}</p>
            <p className="mt-3 text-xs font-bold text-sky-700">اقرأ الملخص ←</p>
          </Link>
        )}
      </div>

      <div className="my-6">
        <AdSlot position="in-content" label="منتصف ملخص اليوم" />
      </div>

      {article && (
        <Link href={`/articles/${article.slug}`} className="mb-6 block overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-l from-emerald-50 via-white to-white p-5 shadow-sm transition hover:shadow-md">
          <p className="text-[11px] font-black text-emerald-700">③ مقال يفيدك</p>
          <h2 className="mt-2 text-xl font-black text-slate-900">{article.title}</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">{article.description}</p>
          <p className="mt-3 text-xs font-bold text-emerald-800">{article.category} · {article.readMinutes} د قراءة ←</p>
        </Link>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-black text-slate-900">④ عناوين عاجلة</h2>
          <Link href="/news" className="text-xs font-bold text-sky-700 hover:underline">مركز الأخبار</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {rss.map((r) => (
            <li key={r.link + r.title} className="py-2.5">
              <a href={r.link} target="_blank" rel="noopener noreferrer" className="block text-sm font-bold leading-7 text-slate-800 hover:text-sky-800">{r.title}</a>
              <p className="text-[11px] text-slate-500">{r.source}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">الروابط تفتح المصدر الأصلي. لا ننسخ المقالات كاملة.</p>
      </section>

      <div className="mt-8">
        <AdSlot position="footer" label="أسفل ملخص اليوم" />
      </div>
    </main>
  );
}
