"use client";

import { useMemo, useState } from "react";

const PLANS = [
  { days: 7, price: 15, label: "7 أيام" },
  { days: 15, price: 25, label: "15 يوماً" },
  { days: 30, price: 40, label: "30 يوماً" },
];

export default function AdvertiseForm({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  const [days, setDays] = useState(7);
  const [bannerUrl, setBannerUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const price = useMemo(() => PLANS.find((p) => p.days === days)?.price || 0, [days]);

  async function save() {
    setMsg("");
    const res = await fetch("/api/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bannerUrl, targetUrl, altText, days }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "تعذر الحفظ");
    setCode(data.code);
    setConfirm(data.code);
  }

  async function pay() {
    setMsg("");
    const res = await fetch("/api/ads/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.invoiceUrl) window.location.href = data.invoiceUrl;
    else setMsg(data.error || data.manual ? `${data.error || ""} ${data.usdt || ""}` : "تعذر فتح الدفع");
  }

  async function sendCode() {
    setMsg("");
    const res = await fetch("/api/ads/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: confirm }),
    });
    const data = await res.json();
    setMsg(data.status || data.error || "أُرسل");
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <label className="block text-sm font-bold">{ar ? "رابط صورة البنر" : "Banner image URL"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://" />
      </label>
      <label className="block text-sm font-bold">{ar ? "الرابط المستهدف" : "Target URL"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://" />
      </label>
      <label className="block text-sm font-bold">{ar ? "عنوان الإعلان" : "Alt text"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={altText} onChange={(e) => setAltText(e.target.value)} />
      </label>
      <div className="flex gap-2">
        {PLANS.map((p) => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)} className={`rounded-full px-3 py-1 text-sm font-bold ${days === p.days ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
            {p.label} · ${p.price}
          </button>
        ))}
      </div>
      <p className="text-sm">{ar ? "المجموع" : "Total"}: ${price}</p>
      <button type="button" onClick={save} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-extrabold text-white">{ar ? "حفظ وتوليد الكود" : "Save and get code"}</button>
      {code && (
        <div className="rounded-2xl border bg-white p-4">
          <p className="font-extrabold">{code}</p>
          <button type="button" onClick={pay} className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">{ar ? "ادفع الآن" : "Pay now"}</button>
        </div>
      )}
      <label className="block text-sm font-bold">{ar ? "بعد الدفع: أدخل الكود" : "After payment: enter code"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button type="button" onClick={sendCode} className="rounded-full border px-4 py-2 text-sm font-bold">{ar ? "إرسال للموافقة" : "Submit for approval"}</button>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
