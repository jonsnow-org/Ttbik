import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { latestNewsItem } from "@/lib/newsItems";
import { clusterHeadlines, fetchAllNews, interleaveNews, type RssItem } from "@/lib/newsRss";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/news";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "مركز الأخبار العاجلة من مصادر عربية موثوقة | شام AI",
  description:
    "شريط عاجل من مصادر عربية موثوقة، وخبر اليوم بمصدرين على الأقل. لا نسخ للمقالات، وكل رابط يفتح المصدر الأصلي.",
  keywords: ["أخبار عربية", "خبر اليوم", "شام AI", "شريط عاجل"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أخبار وأحداث | شام AI",
    description: "شريط عاجل من مصادر موثوقة وخبر اليوم بمصدرين.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/og/news.jpg`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "أخبار وأحداث | شام AI",
    description: "شريط عاجل من مصادر موثوقة.",
    images: [`${SITE}/og/news.jpg`],
  },
};

const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "مركز المدونة والأخبار", item: `${SITE}${PATH}` },
  ],
};

export default async function NewsHubPage() {
  const all = await fetchAllNews();
  const ticker = interleaveNews(all, 12);
  const stories = clusterHeadlines(all).slice(0, 6);
  const now = Date.now();
  const updated = new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "long",
  }).format(new Date(now));
  const featured = latestNewsItem();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">مركز المدونة والأخبار</li>
          </ol>
        </nav>


        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">مركز المدونة والأخبار</h1>
        <p className="mb-4 text-sm leading-7 text-slate-600">
          اختر القسم: أخبار عاجلة من مصادر موثوقة، أو أحداث ومقالات تحريرية هادفة.
        </p>
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <a
            href="#news-feed"
            className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="text-2xl">📰</span>
            <h2 className="mt-2 text-base font-extrabold text-slate-900">قسم الأخبار</h2>
            <p className="mt-1 text-xs leading-6 text-slate-600">شريط عاجل وخبر اليوم من مصادر عربية موثوقة — الرابط يفتح المصدر الأصلي.</p>
          </a>
          <Link
            href="/events"
            className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="text-2xl">🗓️</span>
            <h2 className="mt-2 text-base font-extrabold text-slate-900">أحداث ومقالات</h2>
            <p className="mt-1 text-xs leading-6 text-slate-600">تقويم أحداث ومقالات تحريرية تقدم فائدة حقيقية للقارئ.</p>
          </Link>
        </div>
        <p className="mb-6 text-sm leading-7 text-slate-600" id="news-feed">
          الشريط أدناه يُحدَّث من الخادم كل عشر دقائق من موجزات رسمية. العناوين من المصدر،
          والرابط يفتح الموقع الأصلي. لا نسخ للمقالات.
        </p>

        {stories.length > 0 && (
          <section className="mb-8" aria-labelledby="top-stories">
            <h2 id="top-stories" className="mb-1 text-lg font-extrabold text-slate-900">
              أبرز القصص الآن
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              قصص تغطيها عدة مؤسسات إخبارية في الوقت نفسه — عنوان كل مصدر كما نشره، والرابط يفتح مقاله.
            </p>
            <ol className="space-y-3">
              {stories.map((st) => (
                <li key={st.items[0].link} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-[11px] font-bold text-indigo-700">
                    📡 {st.sources} مصادر · {ago(st.latest, now)}
                  </p>
                  <a
                    href={st.items[0].link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-extrabold leading-7 text-slate-900 hover:underline"
                  >
                    {st.items[0].title}
                  </a>
                  <span className="mr-1 text-xs text-slate-500">— {st.items[0].source}</span>
                  <ul className="mt-2 space-y-1.5 border-r-2 border-indigo-100 pr-3">
                    {st.items.slice(1).map((it) => (
                      <li key={it.link} className="text-sm leading-6">
                        <a href={it.link} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:underline">
                          {it.title}
                        </a>
                        <span className="mr-1 text-xs text-slate-500">— {it.source}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-label="شريط عاجل">
          <h2 className="mb-3 text-sm font-extrabold text-amber-950">عاجل من المصادر</h2>
          {ticker.length === 0 ? (
            <p className="text-sm text-slate-600">تعذّر جلب الموجز الآن. حدّث الصفحة لاحقاً.</p>
          ) : (
            <ul className="space-y-3">
              {ticker.map((item) => (
                <li key={item.link}>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 overflow-hidden rounded-2xl border border-amber-100 bg-white p-2.5 shadow-sm transition hover:border-amber-300 hover:shadow-md"
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-20 w-24 shrink-0 rounded-xl object-cover bg-slate-100"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-50 text-2xl" aria-hidden>
                        📰
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-sm leading-6">
                      <span className="font-bold text-slate-900 line-clamp-3">{item.title}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {item.source}
                        {item.ts ? ` · ${ago(item.ts, now)}` : ""}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">آخر تحديث: {updated} (بتوقيت مكة)</p>
        </section>

        <div className="mb-8">
          <AdSlot position="in-content" label="بين الشريط العاجل وخبر اليوم" />
        </div>

        {featured ? (
          <article className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · {featured.dateLabel}</p>
            <h2 className="mb-3 text-lg font-extrabold text-slate-900">
              <Link href={`/news/${featured.slug}`} className="hover:underline">
                {featured.title}
              </Link>
            </h2>
            <p className="mb-3 text-sm leading-7 text-slate-700">{featured.paragraphs[0]}</p>
            <p className="text-sm">
              <Link href={`/news/${featured.slug}`} className="font-bold text-indigo-800 hover:underline">
                قراءة الخبر كاملاً ←
              </Link>
            </p>
          </article>
        ) : null}

        <p className="mb-6 text-sm">
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">
            سياسة التحرير ←
          </Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">
            الأحداث ←
          </Link>
          {" · "}
          <Link href="/bots" className="font-bold text-indigo-800 hover:underline">
            أدوات البوتات ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل مركز الأخبار" />
      </main>
    </>
  );
}

function ago(ts: RssItem["ts"], now: number) {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return "الآن";
  if (min < 60) return min === 1 ? "منذ دقيقة" : min === 2 ? "منذ دقيقتين" : `منذ ${min} ${min <= 10 ? "دقائق" : "دقيقة"}`;
  const h = Math.round(min / 60);
  return h === 1 ? "منذ ساعة" : h === 2 ? "منذ ساعتين" : `منذ ${h} ${h <= 10 ? "ساعات" : "ساعة"}`;
}
