"use client";
import { useEffect, useState } from "react";

async function post(body: unknown) {
  const r = await fetch("/api/khatma/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
}
type Usdt = { usdt: string; network: string; note: string; amount: string | number; auto?: boolean };
type Status = { status: string; starts_at?: string; ends_at?: string; settled?: boolean; winners?: { rank: number; name: string | null; points: number; status: string }[] };
const STATUS_AR: Record<string, string> = { SENT: "وصلت تلقائياً", CLAIMED: "استلمها", CLAIMABLE: "بانتظار ضغطه زر الاستلام", FAILED_FUNDS: "محجوزة، تُرسل تلقائياً قريباً", EXPIRED: "لم تُستلم" };

export default function SponsorForm({ price, days, product = "khatma" }: { price: number; days: number; product?: "khatma" | "contest" }) {
  const [mode, setMode] = useState<"VOUCHER" | "TG">("VOUCHER");
  const [prize, setPrize] = useState("");
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [usdt, setUsdt] = useState<Usdt | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("sponsor");
    const t = q && /^KSP-[0-9A-F]{8}$/i.test(q) ? setTimeout(() => setCode(q.toUpperCase()), 0) : null;
    return () => { if (t) clearTimeout(t); };
  }, []);
  const check = async () => {
    if (!code) return;
    const r = await post({ action: "check", code });
    if (r.ok) setSt(r);
  };
  useEffect(() => {
    if (!code) return;
    const first = setTimeout(check, 0);
    const t = setInterval(() => { if (!st || st.status === "PENDING_PAYMENT") void check(); }, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, st?.status]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await post({ action: "create", name, url, contact, product, prize, prizeMode: mode, prizeSecret: secret });
    setBusy(false);
    if (r.ok) setCode(r.code); else setMsg(r.error || "تعذّر");
  };
  const pay = async (method: string) => {
    setBusy(true); setMsg("");
    const r = await post({ action: "pay", code, method });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "تعذّر");
    if (r.invoiceUrl) window.open(r.invoiceUrl, "_blank", "noopener");
    else if (r.usdt) setUsdt(r);
  };
  if (code) {
    const active = st && st.status === "ACTIVE";
    return (
      <div className="space-y-2 text-sm">
        <p>طلبك: <b dir="ltr">{code}</b> · ${price} لـ {days} أيام. احفظ هذا الرابط لمتابعة الطلب والفائزين: <code dir="ltr" className="break-all text-xs">{typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?sponsor=${code}` : ""}</code></p>
        {active ? (
          <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">✅ رعايتك مفعّلة من {st.starts_at?.slice(0, 10)} إلى {st.ends_at?.slice(0, 10)}.{product === "contest" ? " بعد نهاية المدة يُختار الفائزون وتصلهم الجوائز تلقائياً." : ""}</p>
        ) : st && st.status !== "PENDING_PAYMENT" ? <p className="rounded-xl bg-slate-50 p-3">الحالة: {st.status}</p> : (
          <>
            <p>ادفع بإحدى الطرق، ويتفعّل الطلب تلقائياً عند وصول الدفع:</p>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => pay("usdt")} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">💵 USDT (TRC20) مباشر</button>
              <button disabled={busy} onClick={() => pay("nowpayments")} className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50">💎 عملات رقمية أخرى</button>
              <button disabled={busy} onClick={() => pay("stars")} className="rounded-xl bg-sky-500 px-4 py-2 font-bold text-white disabled:opacity-50">⭐ نجوم تيليجرام</button>
            </div>
          </>
        )}
        {usdt && !active && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p>حوّل <b dir="ltr">{usdt.amount}</b> USDT بالضبط (شبكة {usdt.network}) إلى:</p>
            <code dir="ltr" className="block break-all">{usdt.usdt}</code>
            <p className="mt-1 text-xs">{usdt.note}</p>
            <button disabled={busy} onClick={check} className="mt-2 rounded-lg border px-3 py-1 text-xs font-bold">🔄 تحقّق من وصول الدفع</button>
          </div>
        )}
        {st?.winners && st.winners.length > 0 && (
          <div className="rounded-xl border p-3">
            <b>🏆 الفائزون</b>
            <ul className="mt-1 space-y-1">{st.winners.map((w) => <li key={w.rank}>{w.rank}. {w.name} · {w.points} نقطة · {STATUS_AR[w.status] || w.status}</li>)}</ul>
          </div>
        )}
        {msg && <p className="text-rose-700">{msg}</p>}
      </div>
    );
  }
  return (
    <form onSubmit={create} className="space-y-2 text-sm">
      <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="اسم الجهة الراعية (متجر، مؤسسة خيرية…)" className="w-full rounded-lg border p-2" aria-label="اسم الراعي" />
      {product === "contest" && (
        <fieldset className="space-y-2 rounded-xl border p-3">
          <legend className="px-1 font-bold">الجائزة (تُسلَّم تلقائياً بعد نهاية الأسبوع)</legend>
          <label className="flex items-start gap-2"><input type="radio" checked={mode === "VOUCHER"} onChange={() => setMode("VOUCHER")} /> <span><b>جائزتك الخاصة</b>: كوبون، منتج، رصيد… نرسل طريقة الاستلام للفائزين الثلاثة تلقائياً. أي طريقة دفع.</span></label>
          <label className="flex items-start gap-2"><input type="radio" checked={mode === "TG"} onChange={() => setMode("TG")} /> <span><b>جائزة تيليجرام جاهزة</b>: بريميوم 3 أشهر للأول وهدية تيليجرام للثاني والثالث، يرسلها البوت بنفسه. الدفع بالنجوم فقط.</span></label>
          {mode === "VOUCHER" && (
            <>
              <input required value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={80} placeholder="الجائزة كما تظهر للجميع (مثال: كوبون خصم 50٪)" className="w-full rounded-lg border p-2" aria-label="الجائزة" />
              <textarea required value={secret} onChange={(e) => setSecret(e.target.value)} maxLength={300} placeholder="ما يصل للفائز فقط: كود الخصم، رابط الاستلام، أو «راسلنا على @shop بهذه الرسالة»" className="w-full rounded-lg border p-2" aria-label="طريقة الاستلام" />
            </>
          )}
        </fieldset>
      )}
      <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (اختياري)" className="w-full rounded-lg border p-2" aria-label="الرابط" />
      <input required dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@your_username" className="w-full rounded-lg border p-2" aria-label="معرّفك" />
      {msg && <p className="text-rose-700">{msg}</p>}
      <button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">احجز الرعاية · ${price}</button>
    </form>
  );
}
