import { fetchEnHeadlines } from "@/lib/autoFeeds";

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
