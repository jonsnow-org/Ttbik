"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WhatsappLinkGenerator() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [number, setNumber] = useState("");

  const digitsOnly = number.replace(/\D/g, "").replace(/^00/, "");
  const leadingZero = digitsOnly.startsWith("0");
  const valid = !leadingZero && digitsOnly.length >= 8 && digitsOnly.length <= 15;

  function generate() {
    if (!valid) return;
    const message = encodeURIComponent(`مرحباً، أريد أطلب: ${name || "المنتج"}${price ? ` (${price})` : ""}`);
    const link = `https://wa.me/${digitsOnly}?text=${message}`;
    // Navigate to a dedicated result page instead of showing inline — a
    // real page view for every generation, not just a state update.
    router.push(`/free-tools/whatsapp-link/result?link=${encodeURIComponent(link)}`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="grid gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم المنتج أو الخدمة"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="السعر (اختياري)"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="رقم واتساب بصيغة دولية، مثال: 9665XXXXXXXX"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          dir="ltr"
        />
      </div>

      {leadingZero && (
        <p className="mt-3 text-sm text-amber-800">احذف الصفر الأول واكتب مفتاح الدولة، مثل 963 أو 90 أو 966، وإلا لن يفتح واتساب الرقم الصحيح.</p>
      )}
      {digitsOnly.length > 15 && (
        <p className="mt-3 text-sm text-amber-800">الرقم أطول من 15 خانة. راجع مفتاح الدولة.</p>
      )}
      <button
        onClick={generate}
        disabled={!valid}
        className="mt-3 rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        إنشاء الرابط
      </button>

      <div className="mt-6 rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-4 text-sm text-slate-600">
        هذه الأداة مجانية تماماً بلا حدود استخدام — أنشئ رابطاً لكل منتج لديك بقدر ما تحتاج.
      </div>
    </div>
  );
}
