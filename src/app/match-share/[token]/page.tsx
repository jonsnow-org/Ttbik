// Privacy-safe public page for a mutual match (shared by one of the two members).
// Shows ONLY the match date and the app — no names, ids, photos, ages or countries.
import { notFound } from "next/navigation";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { readShare, atharClientConfig, atharDateLink, parseYmd } from "@/lib/match/athar";
import { botUsername } from "@/lib/match/hybrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "💞 تطابق جديد على توافق", robots: { index: false, follow: false } };

export default async function SharedMatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await readShare(token).catch(() => null);
  if (!share) notFound();
  const botRow = await prisma.bot.findUnique({ where: { id: share.botId } });
  if (!botRow || !botRow.isActive || botRow.template !== "MARRIAGE_BOT") notFound();
  const username = await botUsername(new TelegramBot(botRow.token), botRow.id).catch(() => null);
  const athar = await atharClientConfig().catch(() => null);
  const ymd = parseYmd(share.day);
  const atharLink = athar && ymd ? atharDateLink(ymd) : null;
  const dateText = ymd ? new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : share.day;
  return (
    <main dir="rtl" className="grid min-h-screen place-items-center bg-[#0b1020] p-6 text-white">
      <div className="w-full max-w-sm rounded-[32px] border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur">
        <div className="mb-3 text-6xl">💞</div>
        <h1 className="text-2xl font-black">تطابق جديد على «توافق»</h1>
        <p className="mt-2 text-sm text-white/70">اثنان أُعجب كلٌّ منهما بالآخر في {dateText}.</p>
        <p className="mt-1 text-[11px] text-white/40">لا تُعرض أي بيانات شخصية في هذه الصفحة.</p>
        {username && <a href={`https://t.me/${username}`} className="mt-6 block rounded-2xl bg-gradient-to-l from-[#ff2e93] to-[#e8b4a0] py-3 font-bold">ابحث عن شريكك في توافق</a>}
        {atharLink && <a href={atharLink} className="mt-3 block rounded-2xl border border-[#e8b4a0]/40 py-3 text-sm text-[#f3cbbd]">🕰 ذكرى هذا اليوم في أثر</a>}
      </div>
    </main>
  );
}
