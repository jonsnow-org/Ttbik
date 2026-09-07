"use client";

import { useState } from "react";

type Plan = {
  label: string;
  daily_text: number;
  daily_image: number;
  weekly_text: number;
  weekly_image: number;
  price_usd: number;
};

// NOVA_BOT's own subscription payment page — a separate component from
// every other bot's pay client so it always posts to
// /api/payments/nova-create-invoice, never another bot's route.
//
// Owner spec, 2026-09-08: replaced the old single flat $5/"unlimited"
// plan with real tiers (see ai-system/app/quota.py's PLANS dict, the
// single source of truth this page's `plans` prop is fetched from
// server-side in page.tsx) — every tier keeps every feature, they only
// scale how much of it you get per day/week.
export default function NovaPayClient({ uid, justPaid, plans }: { uid: string; justPaid: boolean; plans: Record<string, Plan> }) {
  const paidPlans = Object.entries(plans).filter(([key]) => key !== "FREE");
  const [selected, setSelected] = useState<string | null>(paidPlans[0]?.[0] || null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    if (!selected) return;
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/payments/nova-create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, plan: selected }),
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
      <h1 className="text-2xl font-extrabold text-slate-900">اشتراك Nova AI</h1>
      {justPaid && (
        <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          تم استلام دفعتك. سيُفعَّل اشتراكك خلال دقيقة لتأكيد الشبكة — عد لمحادثة Nova على تيليجرام وأرسل أي رسالة للتحقق.
        </p>
      )}

      {paidPlans.length === 0 ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          تعذر تحميل خطط الاشتراك حالياً — حاول مرة أخرى بعد قليل.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {paidPlans.map(([key, p]) => (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={`w-full rounded-2xl border p-4 text-right transition ${
                selected === key ? "border-brand-700 bg-brand-50 ring-2 ring-brand-700" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-slate-900">{p.label}</span>
                <span className="text-xl font-extrabold text-slate-900">${p.price_usd}/شهرياً</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {p.daily_text.toLocaleString("ar")} رسالة/يوم، {p.daily_image.toLocaleString("ar")} صورة/يوم — وحد أسبوعي إضافي فوق ذلك
              </p>
            </button>
          ))}

          <p className="text-xs text-slate-500">
            ادفع بعملة رقمية (USDT, TRX, TON, LTC, SOL...) — يُفعَّل اشتراكك تلقائياً فور تأكيد الدفع، بلا انتظار موافقة يدوية.
          </p>
          <button
            onClick={pay}
            disabled={busy || !uid || !selected}
            className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "جارٍ التحويل..." : "اشترك الآن بعملة رقمية →"}
          </button>
        </div>
      )}
      {!uid && <p className="mt-3 text-xs text-red-700">رابط غير صالح — افتح هذه الصفحة من زر «/ترقية» داخل بوت Nova.</p>}
      {msg && <p className="mt-3 text-sm text-red-700">{msg}</p>}
    </div>
  );
}
