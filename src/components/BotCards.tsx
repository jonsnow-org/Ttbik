"use client";

import { LIVE_BOTS } from "@/lib/liveBots";

// Photo per bot (self-hosted, /public/img), matched by keyword in the title.
function photoFor(title: string): string {
  if (title.includes("الإعلان")) return "/img/dashboard.jpg";
  if (title.includes("الوسائط")) return "/img/social.jpg";
  if (title.includes("العمل")) return "/img/code.jpg";
  if (title.includes("التعارف")) return "/img/community.jpg";
  if (title.includes("الطبي")) return "/img/analytics.jpg";
  return "/img/phone-apps.jpg";
}

// A <button>, not an <a href>: the owner wants only the bot's name on the
// card, with the t.me URL never shown (no status-bar preview, no long-press
// link menu). Same-window navigation — see the in-app browser crash note in
// liveBots.ts history (target=_blank from a Custom Tab).
export default function BotCards() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {LIVE_BOTS.map((bot) => (
        <button
          key={bot.href}
          type="button"
          onClick={() => {
            window.location.href = bot.href;
          }}
          className="group relative flex min-h-[170px] items-end overflow-hidden rounded-2xl text-right text-white shadow-md transition hover:-translate-y-1 hover:shadow-xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoFor(bot.title)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          <span className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/55 to-slate-900/10" />
          <span className="relative block p-4">
            <span className="block text-lg font-extrabold">{bot.title}</span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/80">{bot.desc}</span>
            <span className="mt-2 inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold backdrop-blur">افتح في تليجرام ←</span>
          </span>
        </button>
      ))}
    </div>
  );
}
