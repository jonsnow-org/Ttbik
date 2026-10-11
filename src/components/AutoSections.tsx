import { fetchEnHeadlines, fetchFeaturedArticle, fetchOnThisDay, fetchTrending, type WikiLang } from "@/lib/autoFeeds";

// Self-updating sections (server components, cached by Next). They render
// nothing when the upstream source is unreachable, so a page never shows an
// empty box or an error.

const L = {
  en: {
    liveTag: "Live",
    liveTitle: "Live headlines",
    liveNote: "Updated automatically from BBC, The Guardian, DW, Al Jazeera, NPR and France 24. Each headline opens the publisher's own page.",
    watchTitle: "Watch live on YouTube",
    otdTitle: "On this day",
    otdNote: "From Wikipedia, updated daily.",
    trendTitle: "Most read on Wikipedia",
    trendNote: "The pages people are reading right now. Text from Wikipedia (CC BY-SA).",
    featTitle: "Article of the day",
    featNote: "Wikipedia's featured article for today (CC BY-SA).",
    read: "Read on Wikipedia",
    ago: (m: number) => (m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`),
    dir: "ltr" as const,
  },
  ar: {
    liveTag: "مباشر",
    liveTitle: "",
    liveNote: "",
    watchTitle: "",
    otdTitle: "في مثل هذا اليوم",
    otdNote: "من ويكيبيديا، يتحدث يومياً بشكل تلقائي.",
    trendTitle: "الأكثر قراءة في ويكيبيديا",
    trendNote: "الصفحات التي يقرؤها الناس الآن. النص من ويكيبيديا (CC BY-SA).",
    featTitle: "",
    featNote: "",
    read: "اقرأ في ويكيبيديا",
    ago: (m: number) => (m < 60 ? `قبل ${Math.max(1, m)} د` : m < 1440 ? `قبل ${Math.floor(m / 60)} س` : `قبل ${Math.floor(m / 1440)} يوم`),
    dir: "rtl" as const,
  },
};

const LIVE_LINKS = [
  ["Al Jazeera English", "https://www.youtube.com/channel/UCNye-wNBqNL5ZzHSJj3l8Bg/live"],
  ["BBC News", "https://www.youtube.com/channel/UC16niRr50-MSBwiO3YDb3RA/live"],
  ["Sky News", "https://www.youtube.com/channel/UCoMdktPbSTixAyNGwb-UYkQ/live"],
  ["DW News", "https://www.youtube.com/channel/UCknLrEdhRCp1aegoMqRaCZg/live"],
  ["France 24 English", "https://www.youtube.com/channel/UCQfwfsi5VrQ8yKZ-UWmAEFg/live"],
  ["Euronews", "https://www.youtube.com/channel/UCyoGb3SMlTlB8CLGVH4c8Rw/live"],
];

export async function LiveHeadlines({ limit = 12, links = true }: { limit?: number; links?: boolean }) {
  const items = await fetchEnHeadlines(limit);
  if (!items.length) return null;
  const t = L.en;
  return (
    <section className="mt-8 rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-4 shadow-sm" lang="en" dir="ltr">
      <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-red-600">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" /> {t.liveTag}
      </p>
      <h2 className="mt-1 text-lg font-black text-slate-900">{t.liveTitle}</h2>
      <p className="mt-1 text-xs leading-6 text-slate-500">{t.liveNote}</p>
      <ul className="mt-3 divide-y divide-sky-100">
        {items.map((it) => (
          <li key={it.link}>
            <a href={it.link} target="_blank" rel="noopener noreferrer" className="block py-2.5 hover:bg-white/70">
              <span className="text-[11px] font-black uppercase tracking-wide text-sky-700">{it.source}{it.ts ? ` · ${t.ago(Math.round((Date.now() - it.ts) / 60000))}` : ""}</span>
              <span className="mt-0.5 block text-[15px] font-bold leading-6 text-slate-900">{it.title}</span>
            </a>
          </li>
        ))}
      </ul>
      {links && (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t.watchTitle}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {LIVE_LINKS.map(([name, href]) => (
              <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-black text-white hover:bg-red-500">
                ▶ {name}
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export async function OnThisDay({ lang, limit = 6 }: { lang: WikiLang; limit?: number }) {
  const items = await fetchOnThisDay(lang, limit);
  if (!items.length) return null;
  const t = L[lang];
  return (
    <section className="mt-8" dir={t.dir} lang={lang}>
      <h2 className="text-xl font-black text-slate-900">🗓 {t.otdTitle}</h2>
      <p className="mt-1 text-xs text-slate-500">{t.otdNote}</p>
      <ul className="mt-3 grid gap-3">
        {items.map((e) => (
          <li key={`${e.year}-${e.text.slice(0, 20)}`} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            {e.page?.thumb && <img src={e.page.thumb} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />}
            <div className="min-w-0">
              <p className="text-sm font-black text-sky-700">{e.year}</p>
              <p className="text-sm leading-6 text-slate-800">{e.text}</p>
              {e.page && (
                <a href={e.page.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-bold text-sky-700 hover:underline">
                  {e.page.title} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function Trending({ lang, limit = 6 }: { lang: WikiLang; limit?: number }) {
  const items = await fetchTrending(lang, limit);
  if (!items.length) return null;
  const t = L[lang];
  return (
    <section className="mt-8" dir={t.dir} lang={lang}>
      <h2 className="text-xl font-black text-slate-900">🔥 {t.trendTitle}</h2>
      <p className="mt-1 text-xs text-slate-500">{t.trendNote}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:border-sky-300">
            {p.thumb && <img src={p.thumb} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}
            <div className="min-w-0">
              <p className="font-black text-slate-900">{p.title}</p>
              {p.description && <p className="text-xs font-semibold text-slate-500">{p.description}</p>}
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">{p.extract}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export async function FeaturedArticle() {
  const p = await fetchFeaturedArticle();
  if (!p) return null;
  const t = L.en;
  return (
    <section className="mt-8" dir="ltr" lang="en">
      <h2 className="text-xl font-black text-slate-900">⭐ {t.featTitle}</h2>
      <p className="mt-1 text-xs text-slate-500">{t.featNote}</p>
      <article className="mt-3 overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {p.thumb && <img src={p.thumb} alt="" loading="lazy" className="h-52 w-full object-cover" />}
        <div className="p-4">
          <h3 className="text-lg font-black text-slate-900">{p.title}</h3>
          <p className="mt-2 text-sm leading-7 text-slate-700">{p.extract}</p>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-full bg-sky-500 px-4 py-2 text-xs font-black text-white">{t.read} ↗</a>
        </div>
      </article>
    </section>
  );
}
