"use client";

import { useMemo, useState } from "react";

const PLANS = [
  { days: 7, price: 15, label: "7 أيام" },
  { days: 15, price: 25, label: "15 يوماً" },
  { days: 30, price: 40, label: "30 يوماً" },
];

export default function AdvertiseForm({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  const [kind, setKind] = useState<"image" | "video" | "code">("image");
  const [days, setDays] = useState(7);
  const [bannerUrl, setBannerUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [method, setMethod] = useState<"nowpayments" | "usdt">("nowpayments");
  const [msg, setMsg] = useState("");
  const price = useMemo(() => PLANS.find((p) => p.days === days)?.price || 0, [days]);

  async function upload(file: File) {
    setMsg("");
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/ads/upload", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "تعذر الرفع");
    setBannerUrl(data.url);
    setKind(data.kind);
    setMsg(ar ? "تم رفع الملف." : "File uploaded.");
  }

  async function save() {
    setMsg("");
    const res = await fetch("/api/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bannerUrl, targetUrl, altText, days, kind }),
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
      body: JSON.stringify({ code, method }),
    });
    const data = await res.json();
    if (data.invoiceUrl) window.location.href = data.invoiceUrl;
    else setMsg(data.note ? `${data.note} ${data.amount}$ عبر ${data.network}: ${data.usdt}` : data.error || "تعذر الدفع");
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
      <div className="flex flex-wrap gap-2">
        {([["image", ar ? "صورة" : "Image"], ["video", ar ? "فيديو قصير" : "Short video"], ["code", ar ? "نص وكود" : "Text"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setKind(id)} className={`rounded-full px-3 py-1 text-sm font-bold ${kind === id ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{label}</button>
        ))}
      </div>
      {kind === "code" ? (
        <label className="block text-sm font-bold">{ar ? "نص البنر" : "Banner text"}
          <textarea className="mt-1 w-full rounded-xl border px-3 py-2" value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} maxLength={240} />
        </label>
      ) : (
        <label className="block text-sm font-bold">{ar ? "ارفع الملف" : "Upload file"}
          <input className="mt-1 block w-full text-sm" type="file" accept={kind === "video" ? "video/mp4,video/webm" : "image/*"} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
      {bannerUrl && kind !== "code" && <p className="break-all text-xs text-slate-500" dir="ltr">{bannerUrl}</p>}
      <label className="block text-sm font-bold">{ar ? "الرابط المستهدف" : "Target URL"}
        <input dir="ltr" className="mt-1 w-full rounded-xl border px-3 py-2 text-left" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://" />
      </label>
      <label className="block text-sm font-bold">{ar ? "عنوان الإعلان" : "Title"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={altText} onChange={(e) => setAltText(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {PLANS.map((p) => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)} className={`rounded-full px-3 py-1 text-sm font-bold ${days === p.days ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{p.label} · ${p.price}</button>
        ))}
      </div>
      <p className="text-sm">{ar ? "المجموع" : "Total"}: ${price}</p>
      <button type="button" onClick={save} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-extrabold text-white">{ar ? "حفظ وتوليد الكود" : "Save"}</button>
      {code && (
        <div className="rounded-2xl border bg-white p-4">
          <p className="font-extrabold">{code}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setMethod("nowpayments")} className={`rounded-full px-3 py-1 text-sm font-bold ${method === "nowpayments" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{ar ? "عملات رقمية" : "Crypto"}</button>
            <button type="button" onClick={() => setMethod("usdt")} className={`rounded-full px-3 py-1 text-sm font-bold ${method === "usdt" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>USDT</button>
          </div>
          <button type="button" onClick={pay} className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">{ar ? "متابعة الدفع" : "Continue"}</button>
        </div>
      )}
      <label className="block text-sm font-bold">{ar ? "بعد الدفع: أدخل الكود" : "After payment: code"}
        <input className="mt-1 w-full rounded-xl border px-3 py-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button type="button" onClick={sendCode} className="rounded-full border px-4 py-2 text-sm font-bold">{ar ? "إرسال للموافقة" : "Submit"}</button>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
