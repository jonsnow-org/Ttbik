import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { coinById, RECEIVE, STATUS_AR } from "@/lib/remit/changenow";
import { FROM_COUNTRIES, TO_COUNTRIES, fmt, transferByTrack } from "@/lib/remit/office";

// A shareable receipt of one remittance (the tracking number is random and unguessable). No sender identity is shown.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "إيصال حوالة USDT", robots: { index: false, follow: false } };

export default async function Receipt({ params }: { params: Promise<{ track: string }> }) {
  const { track } = await params;
  if (!/^HW-[A-Z2-9]{10}$/.test(track)) notFound();
  const t = await transferByTrack(track).catch(() => null);
  if (!t) notFound();
  const c = coinById(t.coin);
  const name = (list: readonly (readonly [string, string])[], id: string | null) => list.find((x) => x[0] === id)?.[1] || "🌍";
  const done = t.status === "finished";
  return (
    <main className="mx-auto max-w-md px-4 py-8" dir="rtl" lang="ar">
      <div className={`rounded-3xl border-2 p-5 shadow-sm ${done ? "border-emerald-300 bg-emerald-50" : "border-sky-200 bg-white"}`}>
        <p className="text-xs text-slate-500">🧾 إيصال حوالة</p>
        <h1 className="mt-1 font-mono text-lg font-extrabold text-slate-900" dir="ltr">{t.track}</h1>
        <p className="mt-3 text-sm">{name(FROM_COUNTRIES, t.from_country)} ← {name(TO_COUNTRIES, t.to_country)}</p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">المرسَل</dt><dd dir="ltr">{fmt(t.from_amount)} {c?.label || t.coin}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">للمستلم</dt><dd dir="ltr" className="font-bold">≈ {fmt(t.to_amount, 2)} {RECEIVE.label}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">المحفظة</dt><dd dir="ltr" className="font-mono text-xs">{t.address.slice(0, 6)}…{t.address.slice(-4)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">التاريخ</dt><dd dir="ltr">{new Date(t.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</dd></div>
        </dl>
        <p className="mt-4 rounded-xl bg-white/70 p-2 text-center text-base font-extrabold">{STATUS_AR[t.status] || t.status}</p>
        {t.payout_hash && <a className="mt-2 block text-center text-xs text-sky-700 underline" href={`https://tronscan.org/#/transaction/${t.payout_hash}`} target="_blank" rel="noopener nofollow">إثبات الوصول على الشبكة</a>}
      </div>
      <p className="mt-3 text-center text-[11px] text-slate-400">نُفِّذت عبر خدمة تبديل غير احتجازية. المنصة لا تستلم الأموال ولا تحتفظ بها.</p>
    </main>
  );
}
