"use client";

import { LIVE_BOTS } from "@/lib/liveBots";

const GRADIENTS = [
  "from-sky-600 to-indigo-700",
  "from-rose-500 to-pink-700",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-700",
  "from-violet-500 to-purple-700",
];

// A <button>, not an <a href>: the owner wants only the bot's name on the
// card, with the t.me URL never shown (no status-bar preview, no long-press
// link menu). Same-window navigation — see the in-app browser crash note in
// liveBots.ts history (target=_blank from a Custom Tab).
export default function BotCards() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
      {LIVE_BOTS.map((bot, i) => (
        <button
          key={bot.href}
          type="button"
          onClick={() => {
            window.location.href = bot.href;
          }}
          className={`flex min-h-[110px] items-center justify-center rounded-2xl bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} p-5 text-center text-lg font-extrabold text-white shadow-md transition hover:-translate-y-1 hover:shadow-xl`}
        >
          {bot.title}
        </button>
      ))}
    </div>
  );
}
