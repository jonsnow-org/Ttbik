"use client";
import { useMemo, useState } from "react";
import { crossRate, quoteCost, verdict, type MidRate } from "@/lib/remit/remit";

const fmt = (n: number) => n.toLocaleString("ar", { maximumFractionDigits: 2 });

export default function RemitCalculator({ rates }: { rates: MidRate[] }) {
  const has = (c: string) => rates.some((r) => r.currency === c);
  const [from, setFrom] = useState(has("USD") ? "USD" : rates[0]?.currency ?? "EUR");
  const [to, setTo] = useState(has("TRY") ? "TRY" : rates[1]?.currency ?? "EUR");
  const [manual, setManual] = useState(false);
  const [manualRate, setManualRate] = useState("");
  const [toName, setToName] = useState("");
  const [amount, setAmount] = useState("500");
  const [fee, setFee] = useState("0");
  const [received, setReceived] = useState("");

  const mid = useMemo(() => (manual ? Number(manualRate) || null : crossRate(rates, from, to)), [manual, manualRate, rates, from, to]);
  const toLabel = manual ? toName || "عملة الاستلام" : to;
  const amt = Number(amount) || 0;
  const cost = mid && received ? quoteCost(amt, Number(fee) || 0, Number(received), mid) : null;
  const v = cost ? verdict(cost.costPct) : null;
  const tone = v?.tone === "good" ? "bg-emerald-50 text-emerald-800" : v?.tone === "ok" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800";
  const input = "w-full rounded-lg border px-3 py-2 text-sm";

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">أرسل من
          <select className={input} value={from} onChange={(e) => setFrom(e.target.value)}>
            {rates.map((r) => <option key={r.currency} value={r.currency}>{r.currency} · {r.nameAr}</option>)}
          </select>
        </label>
        <label className="text-sm">يستلم بـ
          {manual ? (
            <input className={input} placeholder="مثلاً EGP" value={toName} onChange={(e) => setToName(e.target.value.toUpperCase().slice(0, 6))} />
          ) : (
            <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>
              {rates.map((r) => <option key={r.currency} value={r.currency}>{r.currency} · {r.nameAr}</option>)}
            </select>
          )}
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
        عملتي غير موجودة (جنيه مصري، ليرة سورية، دينار عراقي…): سأُدخل السعر المرجعي بنفسي
      </label>
      {manual && (
        <label className="block text-sm">سعر 1 {from} المرجعي بعملة الاستلام (من البنك المركزي أو مصدر تثق به)
          <input className={input} inputMode="decimal" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
        </label>
      )}
      {mid ? <p className="rounded-lg bg-slate-50 p-2 text-sm">السعر الوسطي: 1 {from} = <b>{fmt(mid)}</b> {toLabel}. بلا رسوم يستلم المستفيد <b>{fmt(amt * mid)}</b> {toLabel}.</p> : <p className="text-sm text-slate-500">لا يوجد سعر مرجعي لهذا الزوج بعد.</p>}
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">المبلغ ({from})<input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="text-sm">الرسوم ({from})<input className={input} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        <label className="text-sm">يستلم حسب العرض ({toLabel})<input className={input} inputMode="decimal" placeholder="من شاشة الشركة" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
      </div>
      {cost && v && (
        <div className={`rounded-xl p-3 text-sm leading-7 ${tone}`}>
          <b>{v.label}</b>: التكلفة الحقيقية {fmt(cost.costPct)}٪ (≈ {fmt(cost.lostInSource)} {from})، منها هامش سعر صرف مخفي {fmt(cost.marginPct)}٪.
          <br />يخسر المستفيد ≈ {fmt(cost.lost)} {toLabel} مقارنة بالسعر الوسطي بلا رسوم.
        </div>
      )}
    </div>
  );
}
