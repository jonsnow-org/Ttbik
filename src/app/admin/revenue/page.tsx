"use client";
import { useEffect, useState } from "react";
import type { RevenueReport } from "@/lib/revenue";

export default function AdminRevenuePage() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<RevenueReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/revenue?days=${days}`, { cache: "no-store" })
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then((j) => { if (alive) { setR(j); setError(""); } })
      .catch((e) => { if (alive) setError(`تعذّر التحميل (${e.message})`); });
    return () => { alive = false; };
  }, [days]);
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-4xl rounded-2xl bg-slate-950 p-6 text-white">
      <h1 className="mb-1 text-2xl font-bold">💵 الإيرادات الحقيقية مقابل الرصيد الداخلي</h1>
      <p className="mb-4 text-sm text-white/60">«حقيقي» تعني أن مزوّد دفع أكّد العملية: NOWPayments، أو نجوم تيليجرام، أو TON/USDT على السلسلة، أو بنر مدفوع، أو اشتراك أو شراء معتمد. أما «داخلي» فهو صرف من الرصيد ومكافآت، وهذه ليست إيراداً.</p>
      <div className="mb-4 flex gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1 text-sm ${d === days ? "bg-emerald-500 text-black" : "bg-white/10"}`}>{d} يوم</button>
        ))}
      </div>
      {error && <p className="text-red-400">{error}</p>}
      {r && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-500/15 p-4"><p className="text-sm text-white/60">مال حقيقي</p><p className="text-3xl font-bold">${r.realUsd}</p><p className="text-xs text-white/50">{r.realCount} عملية · آخرها {r.lastRealAt ? new Date(r.lastRealAt).toLocaleString("ar") : "—"}</p></div>
            <div className="rounded-xl bg-white/5 p-4"><p className="text-sm text-white/60">رصيد داخلي (ليس إيراداً)</p><p className="text-3xl font-bold">${r.internalUsd}</p><p className="text-xs text-white/50">{r.internalCount} عملية</p></div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-white/50"><th className="text-right">المصدر</th><th>العملة</th><th>العدد</th><th>المبلغ $</th><th>النوع</th></tr></thead>
            <tbody>
              {r.bySource.map((x) => (
                <tr key={`${x.real}|${x.source}|${x.currency}`} className="border-t border-white/10">
                  <td className="py-1">{x.source}</td><td className="text-center">{x.currency}</td><td className="text-center">{x.count}</td><td className="text-center">{x.amount}</td>
                  <td className="text-center">{x.real ? "✅ حقيقي" : "داخلي"}</td>
                </tr>
              ))}
              {r.bySource.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-white/50">لا عمليات في هذه الفترة</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
