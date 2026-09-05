"use client";

import { useState } from "react";

// NOVA_BOT's own subscription payment page — a separate component from
// every other bot's pay client so it always posts to
// /api/payments/nova-create-invoice, never another bot's route. Fixed
// price (subscription, not a wallet top-up), so there's no amount input
// like AD_BOT/MARRIAGE_BOT/JOBS_BOT's deposit pages.
export default function NovaPayClient({ uid, justPaid }: { uid: string; justPaid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/payments/nova-create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
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
      <h1 className="text-2xl font-extrabold text-slate-900">اشتراك Nova AI PRO</h1>
      {justPaid && (
        <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          تم استلام دفعتك. سيُفعَّل اشتراكك خلال دقيقة لتأكيد الشبكة — عد لمحادثة Nova على تيليجرام وأرسل أي رسالة للتحقق.
        </p>
      )}
      <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-600">اشتراك شهري — رسائل غير محدودة</span>
          <span className="text-xl font-extrabold text-slate-900">$5</span>
        </div>
        <p className="text-xs text-slate-500">
          ادفع بعملة رقمية (USDT, TRX, TON, LTC, SOL...) — يُفعَّل اشتراكك تلقائياً فور تأكيد الدفع، بلا انتظار موافقة يدوية.
        </p>
        <button
          onClick={pay}
          disabled={busy || !uid}
          className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "جارٍ التحويل..." : "اشترك الآن بعملة رقمية →"}
        </button>
        {!uid && <p className="text-xs text-red-700">رابط غير صالح — افتح هذه الصفحة من زر «/ترقية» داخل بوت Nova.</p>}
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}
