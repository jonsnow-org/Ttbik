import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { latestNewsItem } from "@/lib/newsItems";
import { LIVE_DESKS, isMajorStory, liveEmbedSrc, liveWatchUrl } from "@/lib/newsLive";
import { clusterHeadlines, coverFor, fetchAllNews, interleaveNews, type NewsCluster, type RssItem } from "@/lib/newsRss";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/news";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "أخبار وأحداث | شام AI",
  description:
    "شريط عاجل من مصادر عربية موثوقة، بطاقات بصور، وبث رسمي للأحداث الكبرى. لا نسخ للمقالات.",
  keywords: ["أخبار عربية", "خبر اليوم", "شام AI", "بث مباشر"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أخبار وأحداث | شام AI",
    description: "شريط عاجل بصور وبث رسمي للأحداث الكبرى.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/og/news.jpg`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "أخبار وأحداث | شام AI",
    description: "شريط عاجل بصور وبث رسمي.",
    images: [`${SITE}/og/news.jpg`],
  },
};

const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "أخبار", item: `${SITE}${PATH}` },
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }} />
      <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">الرئيسة</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">أخبار</li>
          </ol>
        </nav>

        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">مركز الأخبار</h1>
        <p className="mb-6 text-sm leading-7 text-slate-600">
          العناوين من الموجزات الرسمية كل عشر دقائق. الصورة من المصدر إن وُجدت، وإلا غلاف ثابت للبطاقة. الرابط يفتح المقال الأصلي. لا نسخ للمقالات.
        </p>

        <section className="mb-8" aria-labelledby="live-desk">
          <h2 id="live-desk" className="mb-1 text-lg font-extrabold text-slate-900">
            بث الأحداث الكبرى
          </h2>
          <p className="mb-3 text-xs leading-6 text-slate-500">
            بث رسمي من يوتيوب للقنوات أدناه — ليس إعادة بث من شام AI. إن توقف التضمين اضغط «فتح على يوتيوب».
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LIVE_DESKS.map((desk) => (
              <figure key={desk.channelId} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950">
                <div className="aspect-video w-full bg-black">
                  <iframe
                    title={`بث ${desk.name}`}
                    src={liveEmbedSrc(desk)}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-white">
                  <span>مباشر · {desk.name}</span>
                  <a
                    href={liveWatchUrl(desk)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-extrabold text-white hover:bg-red-500"
                  >
                    فتح على يوتيوب
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <div className="mb-8">
          <AdSlot position="in-content" label="بعد قسم البث المباشر" />
        </div>

        {stories.length > 0 && (
          <section className="mb-8" aria-labelledby="top-stories">
            <h2 id="top-stories" className="mb-1 text-lg font-extrabold text-slate-900">
              أبرز القصص الآن
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              قصص تغطيها عدة مؤسسات. عنوان كل مصدر كما نشره، والصورة من الموجز إن وُجدت.
            </p>
            <ol className="space-y-4">
              {stories.map((st) => (
                <StoryCard key={st.items[0].link} st={st} now={now} />
              ))}
            </ol>
          </section>
        )}

        <section className="mb-8" aria-label="شريط عاجل">
          <h2 className="mb-3 text-sm font-extrabold text-amber-950">عاجل من المصادر</h2>
          {ticker.length === 0 ? (
            <p className="text-sm text-slate-600">تعذّر جلب الموجز الآن. حدّث الصفحة لاحقاً.</p>
          ) : (
            <ul className="space-y-3">
              {ticker.map((item) => (
                <TickerRow key={item.link} item={item} now={now} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">آخر تحديث: {updated} (بتوقيت مكة)</p>
        </section>

        <div className="mb-8">
          <AdSlot position="in-content" label="بين الشريط العاجل وخبر اليوم" />
        </div>

        {featured ? (
          <article className="mb-8 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {featured.imageUrl && (
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={featured.imageUrl} alt={featured.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </div>
            )}
            <div className="p-5">
              <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · {featured.dateLabel}</p>
              <h2 className="mb-3 text-lg font-extrabold text-slate-900">
                <Link href={`/news/${featured.slug}`} className="hover:underline">
                  {featured.title}
                </Link>
              </h2>
              <p className="mb-3 text-sm leading-7 text-slate-700">{featured.paragraphs[0]}</p>
              <Link href={`/news/${featured.slug}`} className="text-sm font-bold text-indigo-800 hover:underline">
                قراءة الخبر كاملاً ←
              </Link>
            </div>
          </article>
        ) : null}

        <p className="mb-6 text-sm">
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">سياسة التحرير ←</Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">الأحداث ←</Link>
          {" · "}
          <Link href="/bots" className="font-bold text-indigo-800 hover:underline">أدوات البوتات ←</Link>
        </p>
        <AdSlot position="footer-banner" label="أسفل مركز الأخبار" />
      </main>
    </>
  );
}

function StoryCard({ st, now }: { st: NewsCluster; now: number }) {
  const lead = st.items[0];
  const image = coverFor(lead.title, st.items.find((i) => i.image)?.image);
  const major = isMajorStory(lead.title);
  return (
    <li className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-indigo-800">
          {major ? "مباشر · " : ""}
          {st.sources} مصادر · {ago(st.latest, now)}
        </span>
      </div>
      <div className="p-4">
        <a href={lead.link} target="_blank" rel="noopener noreferrer" className="text-base font-extrabold leading-7 text-slate-900 hover:underline">
          {lead.title}
        </a>
        <span className="mr-1 text-xs text-slate-500">— {lead.source}</span>
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
      </div>
    </li>
  );
}

function TickerRow({ item, now }: { item: RssItem; now: number }) {
  const image = coverFor(item.title, item.image);
  return (
    <li className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="h-16 w-24 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" loading="lazy" />
      <div className="min-w-0 text-sm leading-6">
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="font-bold text-slate-900 hover:underline">
          {item.title}
        </a>
        <span className="mt-0.5 block text-xs text-slate-500">
          {item.source}
          {item.ts ? ` · ${ago(item.ts, now)}` : ""}
        </span>
      </div>
    </li>
  );
}

function ago(ts: number, now: number) {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return "الآن";
  if (min < 60) return min === 1 ? "منذ دقيقة" : min === 2 ? "منذ دقيقتين" : `منذ ${min} ${min <= 10 ? "دقائق" : "دقيقة"}`;
  const h = Math.round(min / 60);
  return h === 1 ? "منذ ساعة" : h === 2 ? "منذ ساعتين" : `منذ ${h} ${h <= 10 ? "ساعات" : "ساعة"}`;
}
