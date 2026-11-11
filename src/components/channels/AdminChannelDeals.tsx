"use client";
import { useCallback, useEffect, useState } from "react";

type Deal = { code: string; kind: string; channel: string; price: number; commission?: number; payout?: number; status: string; paid_via: string | null; post_link: string | null; target_url: string | null; advertiser_contact: string | null; payout_address: string | null; payout_network: string | null; owner_contact: string | null; payment_reference: string | null; settlement_reference: string | null; created_at: string };
type Data = { deals: Deal[]; listings: { username: string; status: string; price: number; verified_until: string | null }[]; assetListings?: any[]; assetSales?: any[]; heldUsd: number; commissionUsd: number };

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
    const botSale = d?.assetSales?.find((x) => x.code === code && x.asset_type === "BOT");
    if (action === "verify" && botSale) {
      reference = window.prompt("أدخل مرجع مراجعة BotFather وإثبات النقل بعد مراجعة هوية البائع والمشتري (8 أحرف على الأقل):")?.trim();
      if (!reference || reference.length < 8) { setMsg("⚠️ لا يعتمد نقل ملكية البوت دون مرجع مراجعة موثق."); return; }
      if (!confirm("هل تحققت يدوياً داخل BotFather من أن المشتري أصبح مالك البوت وأن البائع لم يعد المالك؟")) return;
    }
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
  const open = d.deals.filter((x) => x.kind !== "ASSET_SALE" && !["RELEASED", "REFUNDED", "CANCELLED"].includes(x.status));
  const pendingBotListings = (d.assetListings || []).filter((x) => x.asset_type === "BOT" && x.status === "PENDING_REVIEW");
  const assetSales = (d.assetSales || []).filter((x) => !["RELEASED", "REFUNDED"].includes(x.status) && (x.status !== "CANCELLED" || x.payment_late));
  const reviewAssetListing = async (id: string, approve: boolean) => {
    const reference = approve ? window.prompt("مرجع مراجعة BotFather / دليل فحص ملكية البوت (8 أحرف على الأقل):")?.trim() : (window.prompt("سبب رفض العرض (اختياري):") || "");
    if (approve && (!reference || reference.length < 8)) { setMsg("⚠️ أدخل مرجع مراجعة قبل نشر عرض البوت."); return; }
    if (!confirm(approve ? "هل تحققت من ملكية البوت في BotFather وأن البيانات مطابقة؟" : "هل تريد رفض عرض البوت؟")) return;
    const r = await fetch("/api/admin/channel-deals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: approve ? "approve_asset_listing" : "reject_asset_listing", reference }) }).then((x) => x.json()).catch(() => null);
    setMsg(r?.ok ? "✅ تمت مراجعة عرض البوت." : `❌ ${r?.error || "تعذّرت المراجعة"}`);
    load();
  };
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
      {(pendingBotListings.length > 0 || assetSales.length > 0) && (
        <div className="mt-4 border-t pt-3">
          <h3 className="font-bold">🛍️ سوق ملكية أصول تيليجرام</h3>
          {pendingBotListings.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-sm font-bold">عروض بوتات تحتاج مراجعة BotFather</p>
              {pendingBotListings.map((x) => (
                <div key={x.id} className="rounded-lg border bg-amber-50 p-3 text-sm">
                  <p className="font-bold">{x.title} · @{x.identifier} · ${Number(x.asking_price).toFixed(2)}</p>
                  <p>البائع: {x.seller_snapshot?.firstName} {x.seller_snapshot?.lastName || ""} · @{x.seller_snapshot?.username} · ID {x.seller_telegram_id}</p>
                  <p dir="ltr" className="text-xs">Phone: {x.seller_snapshot?.phoneNumber || "not verified"}</p>
                  <p className="text-xs">Listing: {x.id}</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => reviewAssetListing(x.id, true)} className="rounded-full bg-emerald-100 px-3 py-1">اعتماد العرض بعد الفحص</button>
                    <button onClick={() => reviewAssetListing(x.id, false)} className="rounded-full bg-red-100 px-3 py-1">رفض</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {assetSales.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-bold">صفقات الملكية المفتوحة</p>
              {assetSales.map((x) => (
                <div key={x.code} className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="font-bold">{x.code} · {x.asset_type} · {x.title} · ${Number(x.price).toFixed(2)} · {x.payment_late ? "دفعة وصلت بعد انتهاء الحجز — يلزم الاسترداد" : x.status}</p>
                  <p>البائع: {x.seller_snapshot?.firstName} {x.seller_snapshot?.lastName || ""} · @{x.seller_snapshot?.username} · ID {x.seller_telegram_id}</p>
                  <p dir="ltr" className="text-xs">Phone: {x.seller_snapshot?.phoneNumber}</p>
                  <p>المشتري: {x.buyer_snapshot?.firstName} {x.buyer_snapshot?.lastName || ""} · @{x.buyer_snapshot?.username} · ID {x.buyer_telegram_id}</p>
                  <p dir="ltr" className="text-xs">Phone: {x.buyer_snapshot?.phoneNumber}</p>
                  <p className="mt-1 break-all text-xs" dir="ltr">Seller payout: {x.payout_address} ({x.payout_network}) · seller due: ${Number(x.payout).toFixed(2)}</p>
                  {x.transfer_evidence && <p className="mt-1 break-all text-xs" dir="ltr">Transfer evidence: {x.transfer_evidence}</p>}
                  {x.payment_reference && <p className="mt-1 break-all text-xs text-sky-700" dir="ltr">Payment: {x.payment_reference}</p>}
                  {x.settlement_reference && <p className="mt-1 break-all text-xs text-emerald-700" dir="ltr">Settlement: {x.settlement_reference}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {x.status === "PENDING_PAYMENT" && <><button onClick={() => act(x.code, "confirm_paid")} className="rounded-full bg-amber-100 px-3 py-1">وصل USDT</button><button onClick={() => act(x.code, "cancel")} className="rounded-full bg-slate-200 px-3 py-1">إلغاء الحجز</button></>}
                    {x.status === "POSTED" && x.asset_type === "BOT" && x.seller_confirmed && x.buyer_confirmed && <button onClick={() => act(x.code, "verify")} className="rounded-full bg-sky-100 px-3 py-1">اعتماد نقل BotFather</button>}
                    {x.status === "VERIFIED" && <button onClick={() => act(x.code, "release")} className="rounded-full bg-emerald-100 px-3 py-1">حوّلت مستحق البائع</button>}
                    {(["PAID", "POSTED"].includes(x.status) || x.payment_late) && <button onClick={() => act(x.code, "refund")} className="rounded-full bg-red-100 px-3 py-1">أعدت المبلغ</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
