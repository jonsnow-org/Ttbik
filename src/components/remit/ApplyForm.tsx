"use client";
import { useState } from "react";

export default function ApplyForm({ plans }: { plans: { key: string; price: number; days: number; title: string; what: string }[] }) {
  const [f, setF] = useState({ name: "", country: "", license: "", corridors: "", url: "", contact: "", plan: "BASIC", agree: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ link: string; status: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await fetch("/api/remit/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).then((x) => x.json()).catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
    setBusy(false);
    if (r.ok) setDone({ link: r.link, status: r.status }); else setMsg(r.error || "تعذّر");
  };
  if (done) return (
    <div className="space-y-2 rounded-xl bg-emerald-50 p-4 text-sm leading-7">
      <p>✅ وصل طلبك. {done.status === "APPROVED" ? "تمت الموافقة: ادفع من صفحة المتابعة ليظهر إدراجك فوراً." : "يُراجع خلال وقت قصير، وبعد الموافقة تدفع من صفحة المتابعة ويظهر إدراجك فوراً."}</p>
      <p>احفظ رابط المتابعة الخاص (لا تشاركه):</p>
      <a className="block break-all font-bold text-sky-700 underline" dir="ltr" href={done.link}>{done.link}</a>
    </div>
  );
  const input = "w-full rounded-lg border p-2";
  return (
    <form onSubmit={submit} className="space-y-2 text-sm">
      <input required className={input} maxLength={60} placeholder="اسم الشركة أو المكتب" value={f.name} onChange={set("name")} />
      <input required className={input} maxLength={40} placeholder="بلد الترخيص (تركيا، سوريا، الإمارات…)" value={f.country} onChange={set("country")} />
      <input required className={input} maxLength={120} placeholder="جهة الترخيص ورقمه (مثال: مصرف سوريا المركزي، ترخيص رقم …)" value={f.license} onChange={set("license")} />
      <input className={input} maxLength={120} placeholder="التحويل من وإلى (مثال: تركيا ⇄ سوريا، السعودية → سوريا)" value={f.corridors} onChange={set("corridors")} />
      <input className={input} dir="ltr" placeholder="https://موقعكم (اختياري)" value={f.url} onChange={set("url")} />
      <input required className={input} dir="ltr" placeholder="@telegram_username" value={f.contact} onChange={set("contact")} />
      <select className={input} value={f.plan} onChange={set("plan")}>
        {plans.map((p) => <option key={p.key} value={p.key}>{p.title} · ${p.price} / {p.days} يوماً</option>)}
      </select>
      <label className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" checked={f.agree} onChange={set("agree")} /> أقرّ بأن الشركة مرخّصة لتحويل الأموال في بلدها، وأن المعلومات صحيحة، وأن المنصة تعرض معلوماتنا فقط ولا تستلم أموال العملاء ولا تضمن التحويل.</label>
      {msg && <p className="text-rose-700">{msg}</p>}
      <button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">أرسل الطلب</button>
    </form>
  );
}
