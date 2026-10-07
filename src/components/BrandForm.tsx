"use client";

import { useState } from "react";

export default function BrandForm() {
  const [placement, setPlacement] = useState("qr-generator");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0f766e");
  const [url, setUrl] = useState("https://ttbik.vercel.app");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    const res = await fetch("/api/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "embed", placement, altText: name, bannerUrl: color, targetUrl: url, days: 365 }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "تعذر الحفظ");
    setCode(data.code);
  }

  async function pay() {
    const res = await fetch("/api/ads/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, method: "nowpayments" }) });
    const data = await res.json();
    if (data.invoiceUrl) window.location.href = data.invoiceUrl;
    else setMsg(data.error || "تعذر الدفع");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setPlacement("qr-generator")} className={`rounded-full px-3 py-1 text-sm font-bold ${placement === "qr-generator" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>الرمز</button>
        <button type="button" onClick={() => setPlacement("bmi-calculator")} className={`rounded-full px-3 py-1 text-sm font-bold ${placement === "bmi-calculator" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>الوزن</button>
      </div>
      <input className="w-full rounded-xl border px-3 py-2" placeholder="اسم موقعك" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-xl border px-3 py-2" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <input dir="ltr" className="w-full rounded-xl border px-3 py-2 text-left" placeholder="https://موقعك" value={url} onChange={(e) => setUrl(e.target.value)} />
      <p className="text-sm">10$ دفعة واحدة، الرابط يبقى سنة.</p>
      <button type="button" onClick={save} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-extrabold text-white">توليد الرابط</button>
      {code && <button type="button" onClick={pay} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">ادفع ويصير الرابط /t/{code}</button>}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
