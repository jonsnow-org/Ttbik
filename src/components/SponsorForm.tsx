"use client";

import { useState } from "react";

const TOOLS = [
  { id: "bmi-calculator", label: "حاسبة الوزن" },
  { id: "qr-generator", label: "مولّد الرمز" },
  { id: "guess-word", label: "تحدي الكلمة" },
];

export default function SponsorForm({ initial }: { initial: string }) {
  const [placement, setPlacement] = useState(TOOLS.some((t) => t.id === initial) ? initial : "bmi-calculator");
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [url, setUrl] = useState("");
  const [days, setDays] = useState(30);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    const res = await fetch("/api/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "sponsor", placement, altText: name, bannerUrl: line, targetUrl: url, days }),
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
    <div className="mx-auto max-w-xl space-y-3">
      <div className="flex gap-2">{TOOLS.map((t) => <button key={t.id} type="button" onClick={() => setPlacement(t.id)} className={`rounded-full px-3 py-1 text-sm font-bold ${placement === t.id ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{t.label}</button>)}</div>
      <input className="w-full rounded-xl border px-3 py-2" placeholder="اسم الراعي" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-xl border px-3 py-2" placeholder="سطر الرعاية" value={line} onChange={(e) => setLine(e.target.value)} />
      <input dir="ltr" className="w-full rounded-xl border px-3 py-2 text-left" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex gap-2">
        {[[7, 15], [15, 25], [30, 40]].map(([d, p]) => <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full px-3 py-1 text-sm font-bold ${days === d ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{d} يوم · ${p}</button>)}
      </div>
      <button type="button" onClick={save} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-extrabold text-white">توليد الكود</button>
      {code && <button type="button" onClick={pay} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">ادفع {code}</button>}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
