"use client";
import { useCallback, useEffect, useState } from "react";

type Deal = { code: string; kind: string; channel: string; price: number; commission?: number; payout?: number; status: string; paid_via: string | null; post_link: string | null; target_url: string | null; advertiser_contact: string | null; payout_address: string | null; owner_contact: string | null; created_at: string };
type Data = { deals: Deal[]; listings: { username: string; status: string; price: number; verified_until: string | null }[]; heldUsd: number; commissionUsd: number };

// 📣 Channel exchange escrow: the admin pays the channel (85%) to its public payout address, then presses "release".
export default function AdminChannelDeals() {
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/channel-deals").then((x) => x.json()).catch(() => null);
    if (r?.deals) setD(r);
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (code: string, action: string) => {
    if ((action === "release" || action === "refund") && !confirm(action === "release" ? "هل حوّلت نصيب القناة إلى عنوانها؟" : "هل أعدت المبلغ للمعلن؟")) return;
    const r = await fetch("/api/admin/channel-deals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, action }) }).then((x) => x.json()).catch(() => null);
    setMsg(r?.ok ? `✅ ${code}: ${action}` : `❌ ${r?.error || "خطأ"}`);
    load();
  };
  if (!d) return null;
  const open = d.deals.filter((x) => !["RELEASED", "REFUNDED", "CANCELLED"].includes(x.status));
  return (
    <section className="rounded-xl border p-3">
      <h2 className="font-bold">📣 بورصة القنوات (ضمان) · محجوز ${d.heldUsd} · عمولة محققة ${d.commissionUsd} · قنوات {d.listings.filter((l) => l.status === "LISTED").length}/{d.listings.length}</h2>
      {msg && <p className="mt-1 text-sm">{msg}</p>}
      {open.length === 0 && <p className="mt-2 text-sm text-slate-500">لا صفقات مفتوحة.</p>}
      <div className="mt-2 space-y-2">
        {open.map((x) => (
          <div key={x.code} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p className="font-bold">{x.code} · {x.kind === "BADGE" ? "☑️ شارة" : "إعلان"} @{x.channel} · ${x.price}{x.payout ? ` (للقناة $${x.payout})` : ""} · {x.status}</p>
            <p className="break-all text-xs text-slate-600" dir="ltr">{x.advertiser_contact || ""} → {x.target_url || ""} {x.post_link ? `· ${x.post_link}` : ""}</p>
            {x.kind === "AD" && <p className="break-all text-xs text-slate-600" dir="ltr">payout: {x.payout_address} · {x.owner_contact}</p>}
            <div className="mt-1 flex flex-wrap gap-2">
              {x.status === "PENDING_PAYMENT" && <><button onClick={() => act(x.code, "confirm_paid")} className="rounded-full bg-amber-100 px-3 py-1">💵 وصل USDT</button><button onClick={() => act(x.code, "cancel")} className="rounded-full bg-slate-200 px-3 py-1">إلغاء</button></>}
              {x.status === "POSTED" && <button onClick={() => act(x.code, "verify")} className="rounded-full bg-sky-100 px-3 py-1">✔️ تحقق يدوي</button>}
              {x.status === "VERIFIED" && <button onClick={() => act(x.code, "release")} className="rounded-full bg-emerald-100 px-3 py-1">💸 حوّلت للقناة</button>}
              {["PAID", "POSTED", "VERIFIED"].includes(x.status) && <button onClick={() => act(x.code, "refund")} className="rounded-full bg-red-100 px-3 py-1">↩️ أعدت للمعلن</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
