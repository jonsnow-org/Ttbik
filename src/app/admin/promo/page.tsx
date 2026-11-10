"use client";
import { useCallback, useEffect, useState } from "react";

type Row = {
  code: string; kind: string; placement: string; title: string; targetUrl: string; bannerUrl: string; price: number; days: number;
  paymentStatus: string; adStatus: string; createdAt: string; endsAt: string | null; waitingHours: number | null; late: boolean;
  views: number; clicks: number; ctr: number; reportUrl: string;
};
type Data = { slaHours: number; stats: { queue: number; late: number; active: number; awaitingPayment: number; paidUsd: number }; ads: Row[] };
const TABS = [["PENDING_APPROVAL", "🕒 بانتظار المراجعة"], ["ACTIVE", "✅ نشط"], ["PENDING_PAYMENT", "💳 بانتظار الدفع"], ["ALL", "الكل"]] as const;

export default function PromoModeration() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<string>("PENDING_APPROVAL");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    fetch("/api/admin/ads", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => setMsg("تعذّر التحميل"));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function act(code: string, action: string) {
    if (!window.confirm(`${action} ${code}?`)) return;
    const r = await fetch("/api/admin/ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, action }) });
    const j = await r.json().catch(() => ({}));
    setMsg(j.error || "تم");
    load();
  }
  const rows = (d?.ads || []).filter((r) => tab === "ALL" || r.adStatus === tab);
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-5xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">📣 قسم الترويج: طابور المراجعة والتقارير</h1>
      {d && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[["بانتظار المراجعة", d.stats.queue], [`متأخر (>${d.slaHours}س)`, d.stats.late], ["نشط", d.stats.active], ["بانتظار الدفع", d.stats.awaitingPayment], ["مدفوع $", d.stats.paidUsd]].map(([k, v]) => (
            <div key={String(k)} className={`rounded-xl p-3 ${k === `متأخر (>${d.slaHours}س)` && Number(v) > 0 ? "bg-red-100" : "bg-slate-100"}`}><p className="text-xs text-slate-500">{k}</p><p className="text-xl font-bold">{v}</p></div>
          ))}
        </div>
      )}
      <div className="flex gap-2">{TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-full px-3 py-1 text-sm ${tab === id ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{label}</button>)}</div>
      {msg && <p className="text-sm">{msg}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.code} className={`rounded-xl border p-3 text-sm ${r.late ? "border-red-400" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{r.code} · {r.title} <span className="text-slate-500">({r.kind}/{r.placement})</span></p>
              <p>${r.price} · {r.days} يوم · {r.paymentStatus} / {r.adStatus}{r.waitingHours !== null ? ` · ينتظر ${r.waitingHours}س` : ""}</p>
            </div>
            <p className="break-all text-xs text-slate-500" dir="ltr">{r.targetUrl}{r.bannerUrl && r.bannerUrl.startsWith("https") ? ` · ${r.bannerUrl}` : ""}</p>
            {(r.adStatus === "ACTIVE" || r.adStatus === "EXPIRED") && <p className="text-xs">👁 {r.views} · 🖱 {r.clicks} · {r.ctr}%{r.endsAt ? ` · ينتهي ${r.endsAt.slice(0, 10)}` : ""}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {r.paymentStatus !== "PAID" && <button onClick={() => act(r.code, "confirm_paid")} className="rounded-full bg-amber-100 px-3 py-1">💵 وصل الدفع يدوياً</button>}
              {r.paymentStatus === "PAID" && r.adStatus !== "ACTIVE" && <button onClick={() => act(r.code, "activate")} className="rounded-full bg-emerald-100 px-3 py-1">✅ موافقة وتفعيل</button>}
              {r.adStatus !== "REJECTED" && <button onClick={() => act(r.code, "reject")} className="rounded-full bg-red-100 px-3 py-1">❌ رفض</button>}
              {r.reportUrl && <button onClick={() => navigator.clipboard.writeText(r.reportUrl).then(() => setMsg("نُسخ رابط تقرير المعلن"))} className="rounded-full bg-slate-100 px-3 py-1">📊 نسخ رابط التقرير</button>}
            </div>
          </div>
        ))}
        {d && rows.length === 0 && <p className="text-slate-500">لا شيء هنا.</p>}
      </div>
    </main>
  );
}
