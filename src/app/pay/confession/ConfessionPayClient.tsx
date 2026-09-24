"use client";

import { useState } from "react";

// CONFESSION_BOT's own deposit page — a separate component from every
// other bot's pay client so it always posts to
// /api/payments/confession-create-invoice, never another bot's route.
export default function ConfessionPayClient({ uid, justPaid }: { uid: string; justPaid: boolean }) {
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/payments/confession-create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, amount: Number(amount) }),
    });
    const data = await res.json();
    if (res.ok && data.invoiceUrl) {
      window.location.href = data.invoiceUrl;
    } else {
      setMsg(data.error || "فشل إنشاء فاتورة الدفع");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-extrabold text-slate-900">إيداع رصيد</h1>
      {justPaid && (
        <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          تم استلام دفعتك. قد يستغرق ظهور الرصيد داخل البوت دقيقة لتأكيد الشبكة.
        </p>
      )}
      <p className="mt-2 text-sm text-slate-600">اختر المبلغ ثم ادفع بعملة رقمية (USDT, TRX, TON, LTC, SOL...) — الرصيد يُضاف تلقائياً فور التأكيد.</p>
      <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" type="number" min={1} />
        <button onClick={pay} disabled={busy || !uid || !Number(amount)} className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "جارٍ التحويل..." : "الدفع بعملة رقمية →"}
        </button>
        {!uid && <p className="text-xs text-red-700">رابط غير صالح — افتح هذه الصفحة من زر «إيداع» داخل البوت.</p>}
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}
