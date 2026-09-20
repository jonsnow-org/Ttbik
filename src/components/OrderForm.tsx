"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@/types";
import { getCategoryTheme } from "@/lib/categoryTheme";

interface PaymentInfo {
  bank: {
    holder: string;
    account: string;
    routing: string;
    type: string;
    name: string;
    address: string;
  };
  usdt: {
    address: string;
    network: string;
  };
}

function maskDigits(value: string): string {
  if (!value || value.length <= 4) return value;
  return "•".repeat(Math.max(value.length - 4, 4)) + value.slice(-4);
}

export default function OrderForm({
  serviceId,
  priceUsd,
  categorySlug,
}: {
  serviceId: string;
  priceUsd: number;
  categorySlug?: string | null;
}) {
  const theme = getCategoryTheme(categorySlug);
  const router = useRouter();
  const [step, setStep] = useState<"payment" | "form">("payment");
  const [method, setMethod] = useState<PaymentMethod>("crypto_auto");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/payment-info")
      .then((res) => res.json())
      .then(setPayment)
      .catch(() => setPayment(null));
  }, []);

  async function submit() {
    if (!name.trim() || !contact.trim()) {
      setError("الرجاء تعبئة كل الحقول");
      return;
    }
    if ((method === "bank" || method === "usdt") && !reference.trim()) {
      setError("الرجاء تعبئة كل الحقول");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (method === "crypto_auto") {
        const res = await fetch("/api/orders/create-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceId, customerName: name, customerContact: contact }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "تعذّر إنشاء فاتورة الدفع");
        window.location.href = data.invoiceUrl;
        return;
      }
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          customerName: name,
          customerContact: contact,
          paymentMethod: method,
          transferReference: reference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "تعذّر إرسال الطلب");
      router.push(`/order/${data.orderCode}`);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع");
      setLoading(false);
    }
  }

  const bank = payment?.bank;
  const usdt = payment?.usdt;
  function copyUsdtAddress() {
    if (!usdt?.address) return;
    navigator.clipboard?.writeText(usdt.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 font-bold text-slate-900">اطلب الآن — {priceUsd}$</h3>

      {step === "payment" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMethod("crypto_auto")}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                method === "crypto_auto" ? `${theme.border} ${theme.badgeBg} ${theme.badgeText}` : "border-slate-300"
              }`}
            >
              ⚡ دفع فوري (عملات رقمية)
            </button>
            <button
              onClick={() => setMethod("bank")}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                method === "bank" ? `${theme.border} ${theme.badgeBg} ${theme.badgeText}` : "border-slate-300"
              }`}
            >
              تحويل بنكي (ACH/USD)
            </button>
            {/* Was returned by /api/payment-info the whole time (usdt.address/
                network) and already accepted end-to-end by /api/orders
                (paymentMethod validated against exactly ["bank", "usdt"]) --
                there was just no button anywhere that ever set method to it. */}
            <button
              onClick={() => setMethod("usdt")}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                method === "usdt" ? `${theme.border} ${theme.badgeBg} ${theme.badgeText}` : "border-slate-300"
              }`}
            >
              🅤 USDT (تحويل يدوي)
            </button>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            {method === "crypto_auto" ? (
              <>
                <p className="font-semibold text-slate-700">دفع فوري وتلقائي — بدون انتظار مراجعة الإدارة.</p>
                <p className="mt-1 text-slate-500">
                  اختر أي عملة رقمية تفضلها (USDT، TON، TRX، LTC، SOL وغيرها) في صفحة الدفع التالية. بمجرد
                  تأكيد الدفع على الشبكة، تُسلَّم لك الخدمة تلقائياً خلال دقائق دون تدخل بشري.
                </p>
              </>
            ) : method === "usdt" ? (
              <>
                <p className="mb-2 font-semibold text-slate-700">
                  حوّل مبلغ {priceUsd}$ (USDT) يدوياً إلى العنوان التالي، ثم أرسل رقم عملية التحويل (Hash):
                </p>
                <dl className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">الشبكة</dt>
                    <dd className={`font-mono ${theme.badgeText}`}>{usdt?.network || "TRC20"}</dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-slate-500">العنوان</dt>
                    <dd className={`break-all rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs ${theme.badgeText}`}>
                      {usdt?.address || "سيتم تزويده قريباً"}
                    </dd>
                  </div>
                </dl>
                {usdt?.address && (
                  <button
                    onClick={copyUsdtAddress}
                    className={`mt-3 text-xs font-semibold underline ${theme.badgeText}`}
                  >
                    {copied ? "✅ تم النسخ" : "📋 نسخ العنوان"}
                  </button>
                )}
                <p className="mt-2 text-xs text-amber-600">
                  ⚠️ تأكد من إرسال المبلغ عبر شبكة {usdt?.network || "TRC20"} فقط تجنباً لفقدان التحويل.
                </p>
                <p className="mt-2 text-xs text-emerald-600">
                  ✅ يتم التحقق من عملية الدفع تلقائياً على الشبكة خلال دقائق من رقم العملية — دون انتظار مراجعة يدوية.
                </p>
              </>
            ) : (
              <>
                <p className="mb-2 font-semibold text-slate-700">حوّل مبلغ {priceUsd}$ إلى الحساب البنكي التالي:</p>
                <dl className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">صاحب الحساب</dt>
                    <dd className={`font-mono ${theme.badgeText}`}>{bank?.holder || "سيتم تزويده قريباً"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">رقم الحساب</dt>
                    <dd className={`font-mono ${theme.badgeText}`}>
                      {bank?.account ? (revealed ? bank.account : maskDigits(bank.account)) : "-"}
                    </dd>
                  </div>
                  {bank?.routing && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Routing Number</dt>
                      <dd className={`font-mono ${theme.badgeText}`}>
                        {revealed ? bank.routing : maskDigits(bank.routing)}
                      </dd>
                    </div>
                  )}
                  {bank?.type && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">نوع الحساب</dt>
                      <dd className="text-slate-700">{bank.type}</dd>
                    </div>
                  )}
                  {bank?.name && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">اسم البنك</dt>
                      <dd className="text-slate-700">{bank.name}</dd>
                    </div>
                  )}
                  {bank?.address && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">عنوان البنك</dt>
                      <dd className="text-left text-slate-700">{bank.address}</dd>
                    </div>
                  )}
                </dl>
                {!revealed && bank?.account && (
                  <button
                    onClick={() => setRevealed(true)}
                    className={`mt-3 text-xs font-semibold underline ${theme.badgeText}`}
                  >
                    👁️ إظهار الرقم كاملاً
                  </button>
                )}
              </>
            )}
          </div>

          <button
            onClick={() => setStep("form")}
            className={`w-full rounded-xl px-5 py-2.5 text-sm font-bold text-white ${theme.button}`}
          >
            {method === "crypto_auto" ? "متابعة إلى الدفع ⚡" : "تم الدفع ✅ — متابعة"}
          </button>
        </div>
      )}

      {step === "form" && (
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسمك الكامل"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="طريقة التواصل معك (تليجرام / واتساب / إيميل)"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          {(method === "bank" || method === "usdt") && (
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                method === "usdt"
                  ? "رقم عملية التحويل (Transaction Hash)"
                  : "اسم المُحوِّل أو رقم عملية التحويل"
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep("payment")}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              رجوع
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className={`flex-1 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${theme.button}`}
            >
              {loading
                ? "جارٍ التحويل..."
                : method === "crypto_auto"
                  ? "الانتقال لصفحة الدفع ⚡"
                  : method === "usdt"
                    ? "إرسال الطلب — تحقق تلقائي ⚡"
                    : "إرسال الطلب للمراجعة"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
