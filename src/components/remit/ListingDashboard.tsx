"use client";
import { useCallback, useEffect, useState } from "react";

type State = { status?: string; ends_at?: string | null; clicks?: number; days?: { day: string; n: number }[] };
const AR: Record<string, string> = { PENDING_REVIEW: "قيد المراجعة", APPROVED: "مقبول: بانتظار الدفع", ACTIVE: "ظاهر الآن", EXPIRED: "منتهٍ: جدّد ليرجع", REJECTED: "مرفوض" };

export default function ListingDashboard({ code, k, price, linkBot }: { code: string; k: string; price: number; linkBot: string }) {
  const [st, setSt] = useState<State>({});
  const [usdt, setUsdt] = useState<{ address: string; amount: string; note: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const call = (body: object) => fetch("/api/remit/listing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, k, ...body }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
  const refresh = useCallback(async () => { const r = await call({ action: "check" }); if (r.ok) setSt(r); else setMsg(r.error || ""); }, [code, k]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const first = setTimeout(refresh, 0); const t = setInterval(refresh, 30_000); return () => { clearTimeout(first); clearInterval(t); }; }, [refresh]);
  const pay = async (method: string) => {
    setBusy(true); setMsg("");
    const r = await call({ action: "pay", method });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "تعذّر");
    if (r.invoiceUrl) window.open(r.invoiceUrl, "_blank", "noopener");
    else if (r.address) setUsdt(r);
  };
  const payable = st.status === "APPROVED" || st.status === "ACTIVE" || st.status === "EXPIRED";
  return (
    <div className="space-y-3 text-sm">
      <p>الحالة: <b>{AR[st.status || ""] || "…"}</b>{st.status === "ACTIVE" && st.ends_at ? ` حتى ${st.ends_at.slice(0, 10)}` : ""}</p>
      {linkBot && <a className="inline-block rounded-lg border px-3 py-1.5 text-xs font-bold" href={linkBot}>🔔 اربط تيليجرام لتصلك الموافقة وتذكير التجديد</a>}
      {payable && (
        <div className="rounded-xl border p-3">
          <p className="mb-2">{st.status === "ACTIVE" ? "جدّد الآن (تُضاف المدة لنهاية الحالية)" : "ادفع ليظهر الإدراج فوراً"}: <b>${price}</b></p>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => pay("usdt")} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">💵 USDT (TRC20)</button>
            <button disabled={busy} onClick={() => pay("nowpayments")} className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50">💎 عملات رقمية أخرى</button>
            <button disabled={busy} onClick={() => pay("stars")} className="rounded-xl bg-sky-500 px-4 py-2 font-bold text-white disabled:opacity-50">⭐ نجوم تيليجرام</button>
          </div>
          {usdt && <div className="mt-2 rounded-lg bg-slate-50 p-2"><p>حوّل <b dir="ltr">{usdt.amount}</b> USDT بالضبط إلى:</p><code dir="ltr" className="block break-all">{usdt.address}</code><p className="text-xs">{usdt.note}</p><button onClick={refresh} className="mt-1 rounded border px-2 py-0.5 text-xs">🔄 تحقّق</button></div>}
        </div>
      )}
      <div className="rounded-xl border p-3">
        <b>📈 النقرات: {st.clicks ?? 0}</b>
        <ul className="mt-1 text-xs text-slate-600">{(st.days || []).map((d) => <li key={d.day}>{d.day}: {d.n}</li>)}</ul>
      </div>
      {msg && <p className="text-rose-700">{msg}</p>}
    </div>
  );
}
