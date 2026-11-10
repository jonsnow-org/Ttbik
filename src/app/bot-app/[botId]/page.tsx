import type { Metadata } from "next";
import { SERVICE_LINKS } from "@/config/navigation";
import { botParam } from "@/lib/remit/remit";
import { ownerBotGetbotLink } from "@/lib/builderOwnerBot";

// The Mini App of the ads & earn builder's bots (AD_BOT template: the owner bot and supervisor bots), open to every user. It lists the platform's services (remittances, channel exchange and audit, advertising, khatma,
// group contests, shops) as in-app pages; each one is tagged with the bot that opened it (?bot=<id>, e.g. remittance commission stats).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "خدمات وأرباح المنصة", robots: { index: false, follow: false } };

export default async function BotAppPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const bot = botParam(botId);
  const getbot = await ownerBotGetbotLink().catch(() => null);
  const tag = (href: string) => `${href}?${bot ? `bot=${encodeURIComponent(bot)}&` : ""}src=tg`;
  return (
    <main className="mx-auto max-w-xl px-3 py-5 text-slate-700" dir="rtl" lang="ar">
      <h1 className="text-xl font-extrabold text-slate-900">🧭 خدمات وأرباح المنصة</h1>
      <p className="mt-1 text-sm leading-7">كل خدمات المنصة تفتح هنا داخل تيليجرام.</p>
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SERVICE_LINKS.map((s) => (
          <li key={s.id}>
            <a href={tag(s.href)} className="block rounded-2xl border bg-white p-4 shadow-sm hover:border-indigo-400">
              <div className="font-extrabold text-slate-900">{s.label}</div>
              <div className="mt-1 text-xs leading-6 text-slate-500">{s.desc}</div>
            </a>
          </li>
        ))}
      </ul>
      {getbot && (
        <a href={getbot} className="mt-4 block rounded-2xl bg-slate-900 p-4 text-center font-extrabold text-white">🤖 احصل على بوت مشابه</a>
      )}
    </main>
  );
}
