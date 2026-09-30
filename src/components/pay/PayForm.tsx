"use client";

import { useState } from "react";

const PRESETS = [5, 10, 25, 50];

/**
 * One deposit screen for every bot. Each bot's page passes ITS OWN
 * invoice endpoint, so the ledgers stay separate (AD / MARRIAGE / JOBS /
 * CONFESSION each credit only their own table) -- only the look and the
 * wording are shared, so users see the same clear steps everywhere.
 */
export default function PayForm({
  uid,
  justPaid,
  endpoint,
  botName,
  defaultAmount = 10,
}: {
  uid: string;
  justPaid: boolean;
  endpoint: string;
  botName: string;
  defaultAmount?: number;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const validUid = /^\d{3,20}$/.test(uid);
  const n = Number(amount);
  const amountOk = Number.isFinite(n) && n >= 1 && n <= 100000;

  async function pay() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, amount: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.invoiceUrl) {
        window.location.href = data.invoiceUrl;
        return;
      }
      setMsg(data.error || "فشل إنشاء فاتورة الدفع، حاول مرة أخرى.");
    } catch {
      setMsg("تعذّر الاتصال. تحقق من الإنترنت وحاول مجدداً.");
    }
    setBusy(false);
  }

  return (
    <div dir="rtl" className="mx-auto max-w-lg px-4 py-10">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-indigo-700 p-6 text-white shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/payment.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="relative">
        <p className="text-xs font-bold opacity-80">إيداع رصيد</p>
        <h1 className="mt-1 text-2xl font-extrabold">{botName}</h1>
        {validUid && <p className="mt-2 text-xs opacity-80">الحساب: <span dir="ltr" className="font-mono">{uid}</span></p>}
        </div>
      </div>

      {justPaid && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">
          ✅ تم استلام دفعتك. يُضاف الرصيد تلقائياً داخل البوت فور تأكيد الشبكة (عادةً خلال دقائق) — عُد إلى تليجرام وافتح البوت.
        </p>
      )}

      <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <p className="text-sm font-bold text-slate-800">1) اختر المبلغ (بالدولار)</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className={`rounded-xl py-2 text-sm font-bold ring-1 ${n === p ? "bg-brand-700 text-white ring-brand-700" : "bg-slate-50 text-slate-700 ring-slate-200"}`}
              >
                ${p}
              </button>
            ))}
          </div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            type="number"
            min={1}
            max={100000}
            inputMode="decimal"
            aria-label="المبلغ بالدولار"
          />
          <p className="mt-1 text-[11px] text-slate-500">الحد الأدنى $1.</p>
        </div>

        <div>
          <p className="text-sm font-bold text-slate-800">2) ادفع بعملة رقمية</p>
          <p className="mt-1 text-xs leading-6 text-slate-600">
            ستفتح صفحة دفع آمنة تختار فيها العملة (USDT, TON, TRX, LTC, SOL...). لا نحتفظ بأي مفاتيح خاصة.
          </p>
        </div>

        <button
          onClick={pay}
          disabled={busy || !validUid || !amountOk}
          className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "جارٍ تجهيز الفاتورة..." : `ادفع $${amountOk ? n : "—"} →`}
        </button>

        <p className="text-xs text-slate-500">3) يُضاف الرصيد تلقائياً — لا حاجة لإرسال إثبات دفع.</p>

        {!validUid && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            رابط غير صالح — افتح هذه الصفحة من زر «إيداع» داخل البوت حتى يُحدَّد حسابك تلقائياً.
          </p>
        )}
        {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}
