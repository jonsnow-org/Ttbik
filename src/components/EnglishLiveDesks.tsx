import { EN_LIVE_DESKS, liveEmbedSrc, liveWatchUrl } from "@/lib/newsLive";

export default function EnglishLiveDesks() {
  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-l from-sky-50 via-white to-indigo-50 p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wide text-sky-700">Live</p>
      <h2 className="mt-1 text-lg font-black text-slate-900">English news desks</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">Official YouTube streams. Sham AI does not rebroadcast. If the embed stops, open the channel on YouTube.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {EN_LIVE_DESKS.map((desk) => (
          <article key={desk.channelId} className="overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
            <div className="relative aspect-video bg-slate-900">
              <iframe
                title={`${desk.name} live`}
                src={liveEmbedSrc(desk)}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="flex items-center justify-between gap-2 p-3">
              <p className="text-sm font-bold text-slate-900">Live · {desk.name}</p>
              <a href={liveWatchUrl(desk)} target="_blank" rel="noopener noreferrer" className="rounded-full bg-sky-500 px-3 py-1 text-[11px] font-black text-white hover:bg-sky-600">Open on YouTube</a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
