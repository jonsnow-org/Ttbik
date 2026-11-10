"use client";
import { useState } from "react";

async function post(body: unknown) {
  const r = await fetch("/api/khatma/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
}

export default function SponsorForm({ price, days, product = "khatma" }: { price: number; days: number; product?: "khatma" | "contest" }) {
  const [prize, setPrize] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [usdt, setUsdt] = useState<{ usdt: string; network: string; note: string; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await post({ action: "create", name, url, contact, product, prize });
    setBusy(false);
    if (r.ok) setCode(r.code); else setMsg(r.error || "تعذّر");
  };
  const pay = async (method: string) => {
    setBusy(true); setMsg("");
    const r = await post({ action: "pay", code, method });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "تعذّر");
    if (r.invoiceUrl) window.open(r.invoiceUrl, "_blank", "noopener");
    else if (r.manual) setUsdt(r);
  };
  if (code) {
    return (
      <div className="space-y-2 text-sm">
        <p>طلبك: <b dir="ltr">{code}</b> · ${price} لـ {days} أيام. ادفع بإحدى الطرق:</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => pay("stars")} className="rounded-xl bg-sky-500 px-4 py-2 font-bold text-white disabled:opacity-50">⭐ نجوم تيليجرام</button>
          <button disabled={busy} onClick={() => pay("nowpayments")} className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50">💎 عملات رقمية</button>
          <button disabled={busy} onClick={() => pay("usdt")} className="rounded-xl border px-4 py-2 font-bold disabled:opacity-50">تحويل USDT يدوي</button>
        </div>
        {usdt && <div className="rounded-xl bg-slate-50 p-3">{usdt.usdt ? <p>حوّل <b>{usdt.amount}$</b> USDT ({usdt.network}) إلى: <code dir="ltr" className="break-all">{usdt.usdt}</code></p> : <p>التحويل اليدوي غير مفعّل حالياً.</p>}<p className="mt-1 text-xs">{usdt.note}</p></div>}
        {msg && <p className="text-rose-700">{msg}</p>}
      </div>
    );
  }
  return (
    <form onSubmit={create} className="space-y-2 text-sm">
      <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="اسم الجهة الراعية (متجر، مؤسسة خيرية…)" className="w-full rounded-lg border p-2" aria-label="اسم الراعي" />
      {product === "contest" && <input required value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={80} placeholder="الجائزة التي تموّلها (مثال: 20$ USDT للاعب الأول)" className="w-full rounded-lg border p-2" aria-label="الجائزة" />}
      <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (اختياري)" className="w-full rounded-lg border p-2" aria-label="الرابط" />
      <input required dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@your_username" className="w-full rounded-lg border p-2" aria-label="معرّفك" />
      {msg && <p className="text-rose-700">{msg}</p>}
      <button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">احجز الرعاية · ${price}</button>
    </form>
  );
}
