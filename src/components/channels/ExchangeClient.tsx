"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type ListingView = { username: string; title: string; price: number; verifiedUntil: string | null; subscribers: number | null; medianViews: number; reachPct: number | null; grade: string; gradeLabel: string };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
}

export function OrderForm({ listing }: { listing: ListingView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adText, setAdText] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://");
  const [contact, setContact] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-bold text-white">اطلب إعلاناً · ${listing.price}</button>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await post("/api/channels/deal", { action: "create", channel: listing.username, adText, targetUrl, contact });
    setBusy(false);
    if (r.ok) router.push(`/channels/deal/${r.code}`); else setMsg(r.error || "تعذّر الطلب");
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
      <textarea required value={adText} onChange={(e) => setAdText(e.target.value)} rows={4} maxLength={1500} placeholder="نص الإعلان كما تريد نشره (20 حرفاً على الأقل)" className="w-full rounded-lg border p-2 text-sm" />
      <input required dir="ltr" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://…" className="w-full rounded-lg border p-2 text-sm" aria-label="رابط الإعلان" />
      <input required dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@your_username" className="w-full rounded-lg border p-2 text-sm" aria-label="معرّفك على تيليجرام" />
      <p className="text-xs text-slate-500">تدفع ${listing.price}. يبقى المبلغ لدى المنصة حتى يُنشر إعلانك ونتحقق منه، وإن لم يُنشر يُعاد إليك.</p>
      {msg && <p className="text-sm text-rose-700">{msg}</p>}
      <button disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "…" : "متابعة للدفع"}</button>
    </form>
  );
}

export function JoinForm() {
  const [channel, setChannel] = useState("");
  const [ownerContact, setOwner] = useState("");
  const [payoutAddress, setPayout] = useState("");
  const [price, setPrice] = useState("20");
  const [msg, setMsg] = useState("");
  const [res, setRes] = useState<{ verifyCode: string; manageUrl: string; username: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await post("/api/channels/listing", { action: "request", channel, ownerContact, payoutAddress, price: Number(price) });
    setBusy(false);
    if (r.ok) setRes(r); else setMsg(r.error || "تعذّر الحفظ");
  };
  if (res) {
    return (
      <div className="space-y-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
        <p className="font-bold">خطوة أخيرة لإثبات أنك صاحب @{res.username}:</p>
        <p>ضع هذا الكود في وصف القناة أو في منشور: <code className="rounded bg-white px-2 py-0.5 font-bold" dir="ltr">{res.verifyCode}</code></p>
        <p>ثم افتح رابط الإدارة الخاص بك واضغط «تحقق». <b>احفظ هذا الرابط ولا تشاركه</b>: منه تستلم الطلبات وتسجّل المنشورات.</p>
        <a className="block break-all font-bold text-emerald-800 underline" dir="ltr" href={res.manageUrl}>{res.manageUrl}</a>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <input required dir="ltr" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="@your_channel" className="w-full rounded-lg border p-2 text-sm" aria-label="معرّف القناة" />
      <input required dir="ltr" value={ownerContact} onChange={(e) => setOwner(e.target.value)} placeholder="@your_username (للتواصل)" className="w-full rounded-lg border p-2 text-sm" aria-label="معرّفك" />
      <input required dir="ltr" value={payoutAddress} onChange={(e) => setPayout(e.target.value)} placeholder="عنوان محفظة USDT-TRC20 أو TON العام لاستلام أرباحك" className="w-full rounded-lg border p-2 text-sm" aria-label="عنوان الاستلام" />
      <label className="flex items-center gap-2 text-sm">سعر المنشور بالدولار <input required type="number" min={5} max={2000} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} className="w-28 rounded-lg border p-2" /></label>
      <p className="text-xs text-slate-500">تستلم 85% من كل صفقة بعد التحقق من النشر؛ عمولة المنصة 15%. لا رسوم للعرض.</p>
      {msg && <p className="text-sm text-rose-700">{msg}</p>}
      <button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "…" : "اعرض قناتي"}</button>
    </form>
  );
}

export function PayButtons({ code, price, done }: { code: string; price: number; done?: boolean }) {
  const [msg, setMsg] = useState("");
  const [usdt, setUsdt] = useState<{ usdt: string; network: string; note: string; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (done) return null;
  const pay = async (method: "stars" | "nowpayments" | "usdt") => {
    setBusy(true); setMsg("");
    const r = await post("/api/channels/deal", { action: "pay", code, method });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "تعذّر");
    if (r.invoiceUrl) window.location.href = r.invoiceUrl;
    else if (r.manual) setUsdt(r);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => pay("stars")} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">⭐ نجوم تيليجرام</button>
        <button disabled={busy} onClick={() => pay("nowpayments")} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">💎 عملات رقمية</button>
        <button disabled={busy} onClick={() => pay("usdt")} className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50">تحويل USDT يدوي</button>
      </div>
      <p className="text-xs text-slate-500">المبلغ: ${price}</p>
      {usdt && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          {usdt.usdt ? <p>حوّل <b>{usdt.amount}$</b> USDT ({usdt.network}) إلى: <code dir="ltr" className="break-all">{usdt.usdt}</code></p> : <p>التحويل اليدوي غير مفعّل حالياً، اختر طريقة أخرى.</p>}
          <p className="mt-1 text-xs text-slate-600">{usdt.note}</p>
        </div>
      )}
      {msg && <p className="text-sm text-rose-700">{msg}</p>}
    </div>
  );
}

type ManageDeal = { code: string; ad_text: string | null; target_url: string | null; price: number; payout: number; status: string; post_link: string | null };
export function ManagePanel({ token, initial }: { token: string; initial: { listing: { username: string; title: string; status: string; price: number; verifyCode: string | null; verified_until: string | null }; deals: ManageDeal[] } }) {
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [badge, setBadge] = useState<string | null>(null);
  const reload = async () => {
    const r = await fetch(`/api/channels/post?token=${encodeURIComponent(token)}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) setData({ listing: r.listing, deals: r.deals });
  };
  const verify = async () => {
    setMsg("…");
    const r = await post("/api/channels/listing", { action: "verify", token });
    setMsg(r.ok ? "✅ تم التوثيق. قناتك الآن معروضة في البورصة." : r.error);
    if (r.ok) reload();
  };
  const submit = async (code: string) => {
    setMsg("…");
    const r = await post("/api/channels/post", { token, code, link: links[code] || "" });
    setMsg(r.ok ? (r.verified ? "✅ تحققنا من المنشور. سيُحوَّل نصيبك بعد مراجعة سريعة." : "سجّلنا الرابط، وسيراجعه الأدمن يدوياً لأننا لم نجد رابط المعلن فيه.") : r.error);
    reload();
  };
  const buyBadge = async () => {
    const r = await post("/api/channels/badge", { token });
    if (r.ok) setBadge(r.code); else setMsg(r.error);
  };
  const l = data.listing;
  const STATUS: Record<string, string> = { PAID: "مدفوع، بانتظار نشرك", POSTED: "منشور، قيد المراجعة", VERIFIED: "تم التحقق، بانتظار التحويل", RELEASED: "حُوّل نصيبك", REFUNDED: "أُعيد للمعلن" };
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-white p-4">
        <p className="font-extrabold">{l.title} <span dir="ltr" className="text-slate-500">@{l.username}</span></p>
        <p className="mt-1 text-sm">الحالة: {l.status === "LISTED" ? "✅ معروضة" : "بانتظار إثبات الملكية"} · السعر ${l.price}{l.verified_until && new Date(l.verified_until) > new Date() ? " · ☑️ موثّقة" : ""}</p>
        {l.verifyCode && (
          <div className="mt-2 text-sm">
            <p>ضع الكود <code dir="ltr" className="rounded bg-slate-100 px-2 font-bold">{l.verifyCode}</code> في وصف القناة أو منشور، ثم:</p>
            <button onClick={verify} className="mt-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white">تحقق</button>
          </div>
        )}
        {l.status === "LISTED" && !(l.verified_until && new Date(l.verified_until) > new Date()) && (
          <div className="mt-3 text-sm">
            {!badge ? <button onClick={buyBadge} className="rounded-xl border px-3 py-1.5 font-bold">☑️ شارة «قناة موثّقة» لسنة · $10</button> : <><p className="mb-2">ادفع لتفعيل الشارة:</p><PayButtons code={badge} price={10} /></>}
            <p className="mt-1 text-xs text-slate-500">القنوات الموثّقة تظهر أولاً في البورصة.</p>
          </div>
        )}
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <div>
        <p className="mb-2 font-bold">طلبات الإعلان</p>
        {data.deals.length === 0 && <p className="text-sm text-slate-500">لا توجد طلبات مدفوعة بعد.</p>}
        <div className="space-y-3">
          {data.deals.map((d) => (
            <div key={d.code} className="rounded-2xl border bg-white p-3 text-sm">
              <p className="font-bold">{d.code} · نصيبك ${d.payout} · {STATUS[d.status] || d.status}</p>
              {d.ad_text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2">{d.ad_text}</p>}
              {d.target_url && <p className="mt-1 break-all" dir="ltr">{d.target_url}</p>}
              {(d.status === "PAID" || d.status === "POSTED") && (
                <div className="mt-2 flex gap-2">
                  <input dir="ltr" value={links[d.code] || ""} onChange={(e) => setLinks({ ...links, [d.code]: e.target.value })} placeholder={`https://t.me/${l.username}/123`} className="min-w-0 flex-1 rounded-lg border p-2" aria-label="رابط المنشور" />
                  <button onClick={() => submit(d.code)} className="rounded-xl bg-amber-500 px-3 font-bold text-white">نشرته</button>
                </div>
              )}
              {d.post_link && <a className="mt-1 block text-sky-700 underline" dir="ltr" href={d.post_link}>{d.post_link}</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
