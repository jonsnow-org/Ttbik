"use client";
import { useCallback, useEffect, useState } from "react";

type Deal = { code: string; kind: string; channel: string; price: number; commission?: number; payout?: number; status: string; paid_via: string | null; post_link: string | null; target_url: string | null; advertiser_contact: string | null; payout_address: string | null; payout_network: string | null; owner_contact: string | null; payment_reference: string | null; settlement_reference: string | null; created_at: string };
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
    let reference: string | undefined;
    if (action === "confirm_paid") {
      reference = window.prompt("أدخل TXID (64 خانة hex) لتحويل USDT على شبكة TRC20 للتحقق الآلي من وصول المبلغ إلى عنوان المنصة:")?.trim();
      if (!reference || !/^[a-fA-F0-9]{64}$/.test(reference)) { setMsg("⚠️ لا يمكن اعتماد الدفعة دون TXID صحيح من 64 خانة."); return; }
      if (!confirm("سيُفحص TXID آلياً على TRON للتحقق من نجاح المعاملة، وعقد USDT، والعنوان المستلم، والمبلغ الكامل، وعدم إعادة استخدام المرجع. هل تتابع؟")) return;
    }
    if (action === "release" || action === "refund") {
      reference = window.prompt(action === "release" ? "أدخل مرجع التحويل الذي يثبت إرسال مستحق القناة (8 أحرف على الأقل):" : "أدخل مرجع الاسترداد الذي يثبت إعادة المبلغ للمعلن (8 أحرف على الأقل):")?.trim();
      if (!reference || reference.length < 8) { setMsg("⚠️ لا يمكن إغلاق الصفقة دون مرجع تحويل أو استرداد."); return; }
      if (!confirm(action === "release" ? "هل نفذت تحويل مستحق القناة فعلاً وتريد تسجيل مرجعه؟" : "هل أعدت المبلغ للمعلن فعلاً وتريد تسجيل مرجعه؟")) return;
    }
    const r = await fetch("/api/admin/channel-deals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, action, reference }) }).then((x) => x.json()).catch(() => null);
    setMsg(r?.ok ? `✅ ${code}: ${action}` : `❌ ${r?.error || "خطأ"}`);
    load();
  };
  if (!d) return null;
  const open = d.deals.filter((x) => !["RELEASED", "REFUNDED", "CANCELLED"].includes(x.status));
  return (
    <section className="rounded-xl border p-3">
      <h2 className="font-bold">📣 بورصة القنوات (متابعة الصفقات) · محجوز ${d.heldUsd} · عمولة محققة ${d.commissionUsd} · قنوات {d.listings.filter((l) => l.status === "LISTED").length}/{d.listings.length}</h2>
      {msg && <p className="mt-1 text-sm">{msg}</p>}
      {open.length === 0 && <p className="mt-2 text-sm text-slate-500">لا صفقات مفتوحة.</p>}
      <div className="mt-2 space-y-2">
        {open.map((x) => (
          <div key={x.code} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p className="font-bold">{x.code} · {x.kind === "BADGE" ? "☑️ شارة" : "إعلان"} @{x.channel} · ${x.price}{x.payout ? ` (للقناة $${x.payout})` : ""} · {x.status}</p>
            <p className="break-all text-xs text-slate-600" dir="ltr">{x.advertiser_contact || ""} → {x.target_url || ""} {x.post_link ? `· ${x.post_link}` : ""}</p>
            {x.kind === "AD" && <p className="break-all text-xs text-slate-600" dir="ltr">payout ({x.payout_network || "network not set"}): {x.payout_address} · {x.owner_contact}</p>}
            {x.payment_reference && <p className="break-all text-xs text-sky-700" dir="ltr">payment reference: {x.payment_reference}</p>}
            {x.settlement_reference && <p className="break-all text-xs text-emerald-700" dir="ltr">settlement reference: {x.settlement_reference}</p>}
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
