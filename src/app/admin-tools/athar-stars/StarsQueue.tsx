"use client";
import { useCallback, useEffect, useState } from "react";

type O = { id: string; tg_user_id: string; date_index: number; tier: string; stars_amount: number; recipient_address: string; status: string; paid_at: string | null; mint_claimed_at: string | null; last_error: string | null; needs_review: boolean };
const KIND: Record<string, number> = { normal: 0, silver: 1, gold: 2 };
const ymd = (i: number) => { const d = new Date(Date.UTC(1950, 0, 1) + i * 86400000); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`; };
const LS = "athar-admin-url";

export default function StarsQueue() {
  const [orders, setOrders] = useState<O[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  useEffect(() => { try { setAdminUrl(localStorage.getItem(LS) || ""); } catch { /* optional */ } }, []);
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/athar-stars", { cache: "no-store" });
    if (!r.ok) { setMsg("تعذّر التحميل"); return; }
    const j = await r.json(); setOrders(j.orders || []); setEnabled(!!j.enabled);
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (id: string, action: string, extra: object = {}) => {
    setMsg("...");
    const r = await fetch("/api/admin/athar-stars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "تم" : j.error || "فشل");
    await load();
    return r.ok ? j : null;
  };
  const open = async (o: O) => {
    if (!adminUrl) { setMsg("ضع رابط لوحة أثر أولاً"); return; }
    const j = o.status === "paid" ? await act(o.id, "claim") : {};
    if (!j) return;
    const u = new URL(adminUrl);
    u.searchParams.set("mint", `${KIND[o.tier]}:${o.date_index}:${o.recipient_address}`);
    window.open(u.toString(), "_blank", "noopener");
  };
  return (
    <div className="mt-6 space-y-4">
      {!enabled && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">الدفع بالنجوم مطفأ (ATHAR_ENABLE_STARS ليس 1). الطلبات القديمة تظهر هنا فقط.</p>}
      <label className="block text-sm text-slate-600">رابط لوحة أثر (يُحفظ في متصفحك فقط)
        <input dir="ltr" className="mt-1 w-full rounded-lg border p-2 text-sm" value={adminUrl} placeholder="https://.../your-admin-path"
          onChange={(e) => { setAdminUrl(e.target.value.trim()); try { localStorage.setItem(LS, e.target.value.trim()); } catch { /* optional */ } }} />
      </label>
      {msg && <p className="text-sm text-slate-500">{msg}</p>}
      {orders.length === 0 && <p className="text-slate-500">لا طلبات.</p>}
      {orders.map((o) => (
        <div key={o.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 font-bold">
            <span>{ymd(o.date_index)}</span><span>{o.tier}</span><span>{o.stars_amount} ⭐</span>
            <span className="rounded bg-slate-100 px-2 py-0.5">{o.status}</span>
            {o.needs_review && <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">بحاجة مراجعة (أكثر من 30 دقيقة بلا إرسال)</span>}
          </div>
          <div dir="ltr" className="mt-1 break-all font-mono text-xs text-slate-500">{o.recipient_address}</div>
          {o.last_error && <div className="mt-1 text-xs text-red-600">{o.last_error}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(o.status === "paid" || o.status === "minting") && <button className="rounded bg-violet-600 px-3 py-1 text-white" onClick={() => open(o)}>{o.status === "paid" ? "تجهيز للسك" : "فتح لوحة أثر"}</button>}
            {o.status === "minting" && <button className="rounded border px-3 py-1" onClick={() => act(o.id, "retry")}>إعادة إلى «مدفوع»</button>}
            {["paid", "minting", "refund_pending"].includes(o.status) && <button className="rounded border border-red-300 px-3 py-1 text-red-700" onClick={() => confirm("استرداد النجوم للمشتري؟") && act(o.id, "refund")}>استرداد</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
