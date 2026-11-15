"use client";

import { useEffect, useState } from "react";
import type { RevenueReport, RevenueRow } from "@/lib/revenue";

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const date = (s: string | null) => s ? new Date(s).toLocaleString("ar") : "—";
const CATEGORY: Record<string, string> = {
  platform_sale: "مبيعات المنصة", platform_fee: "عمولة المنصة", customer_topup: "شحن رصيد عميل",
  customer_spend: "استهلاك من رصيد داخلي", seller_volume: "قيمة مستحقة للبائع", seller_payable: "مستحقات أصحاب البوتات", escrow: "أموال محجوزة",
  pending_sale: "طلب بيع غير محصّل", pending_fee: "عمولة بانتظار التسوية", internal: "حركة دفترية أخرى",
};
const EVIDENCE: Record<string, string> = {
  provider_reference: "مرجع دفع مسجل", system_recorded: "حالة مسجلة بالنظام",
  admin_approved: "اعتماد إداري", internal_ledger: "دفتر داخلي", unverified: "غير محصّل / غير مؤكد",
};
function amount(row: RevenueRow) {
  if (row.unit === "USD") return money(row.amount);
  if (row.unit === "USD_EQ") return `${money(row.amount)} قيمة مكافئة`;
  return `${row.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${row.currency}`;
}

export default function AdminRevenuePage() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<RevenueReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/admin/revenue?days=${days}`, { cache: "no-store" })
      .then((x) => x.ok ? x.json() : Promise.reject(new Error(String(x.status))))
      .then((j: RevenueReport) => { if (alive) { setR(j); setError(""); setLoading(false); } })
      .catch((e) => { if (alive) { setError(`تعذّر التحميل (${e.message})`); setLoading(false); } });
    return () => { alive = false; };
  }, [days]);

  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-6xl space-y-5 rounded-2xl bg-slate-950 p-4 text-white sm:p-6">
      <header>
        <h1 className="text-2xl font-black">💵 الإيرادات والتسويات</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-white/65">
          نفصل إيراد المنصة عن شحن أرصدة العملاء ومبيعات البائعين والأموال المحجوزة. لا يُحسب شحن رصيد العميل ربحاً للمنصة،
          ولا تُحسب قيمة طلب البائع عمولةً لنا. صافي الربح لا يُعرض حتى تُسجّل تكاليف التشغيل الفعلية.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-4 py-2 text-sm font-bold ${d === days ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white"}`}>{d} يوم</button>
        ))}
      </div>
      {loading && <p className="text-sm text-white/60">جارٍ تحميل السجلات…</p>}
      {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}

      {r && <>
        {!!r.incompleteSources.length && <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
          بعض المصادر لم تُقرأ؛ النتائج جزئية وليست صفراً مؤكداً لهذه المصادر:
          <p className="mt-2">{r.incompleteSources.join("، ")}</p>
        </div>}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-xs text-white/60">إيراد المنصة المسجّل بالدولار</p>
            <p className="mt-1 text-2xl font-black">{money(r.grossPlatformRevenueUsd)}</p>
            <p className="mt-1 text-[11px] text-white/45">مبيعات + عمولات بالدولار</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">مبيعات المنصة</p><p className="mt-1 text-2xl font-black">{money(r.platformSalesUsd)}</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">عمولات المنصة</p><p className="mt-1 text-2xl font-black">{money(r.platformFeesUsd)}</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">شحن أرصدة العملاء</p><p className="mt-1 text-2xl font-black">{money(r.customerTopupsUsdEq)}</p><p className="mt-1 text-[11px] text-white/45">قيمة مكافئة · ليست ربحاً</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">حجم مبيعات البائعين</p><p className="mt-1 text-2xl font-black">{money(r.sellerVolumeUsd)}</p><p className="mt-1 text-[11px] text-white/45">لا يدخل في إيراد المنصة</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">مستحقات أصحاب البوتات</p><p className="mt-1 text-2xl font-black">{money(r.creatorPayablesUsdEq)}</p><p className="mt-1 text-[11px] text-white/45">قيمة مكافئة · ليست عمولة المنصة</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">أموال في الضمان</p><p className="mt-1 text-2xl font-black">{money(r.escrowOutstandingUsd)}</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">طلبات بيع بانتظار التحصيل</p><p className="mt-1 text-2xl font-black">{money(r.pendingSalesUsd)}</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">عمولات بانتظار التسوية</p><p className="mt-1 text-2xl font-black">{money(r.pendingFeesUsd)}</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">عمولات داخلية قيد التسوية</p><p className="mt-1 text-2xl font-black">{money(r.pendingFeesUsdEq)}</p><p className="mt-1 text-[11px] text-white/45">قيمة مكافئة · ليست تحصيلاً نقدياً</p></div>
          <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-white/60">مشتريات من الرصيد الداخلي</p><p className="mt-1 text-2xl font-black">{money(r.customerSpendUsdEq)}</p><p className="mt-1 text-[11px] text-white/45">قيمة مكافئة · مصدر تمويلها غير مفصول بعد</p></div>
        </section>

        {r.platformRevenueEquivalentUsd > 0 && <p className="rounded-xl bg-white/5 p-3 text-sm text-white/70">
          توجد أيضاً {money(r.platformRevenueEquivalentUsd)} عمولات/إيرادات مكافئة مسجلة في دفاتر داخلية؛ لا تُضاف إلى الإيراد النقدي أعلاه قبل ربطها بمصدر تمويل حقيقي.
        </p>}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-bold">مصادر الإيراد والحركة</h2>
          <p className="mt-1 text-xs text-white/45">آخر إيراد مسجل: {date(r.lastPlatformReceiptAt)} · آخر شحن رصيد: {date(r.lastCustomerTopupAt)}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr className="text-white/45">
                <th className="pb-2 text-right">المصدر</th><th className="pb-2 text-right">التصنيف</th><th className="pb-2 text-right">القيمة</th><th className="pb-2 text-center">العمليات</th><th className="pb-2 text-right">دليل التسجيل</th>
              </tr></thead>
              <tbody>
                {r.bySource.map((row) => <tr key={`${row.category}|${row.source}|${row.currency}|${row.unit}|${row.evidence}`} className="border-t border-white/10">
                  <td className="py-2 pr-1">{row.source}</td><td className="py-2">{CATEGORY[row.category] || row.category}</td>
                  <td className="py-2 font-bold tabular-nums">{amount(row)}</td><td className="py-2 text-center tabular-nums">{row.count}</td>
                  <td className="py-2 text-xs text-white/55">{EVIDENCE[row.evidence] || row.evidence}</td>
                </tr>)}
                {!r.bySource.length && <tr><td colSpan={5} className="py-6 text-center text-white/45">لا توجد حركات مسجلة في هذه الفترة.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {!!r.internalByCurrency.length && <section className="rounded-2xl border border-white/10 p-4">
          <h2 className="font-bold">حركات داخلية بوحدتها الأصلية</h2>
          <p className="mb-3 mt-1 text-xs text-white/45">لا نحول هذه القيم إلى دولارات لأن الدفتر لا يثبت أنها أموال خارجية.</p>
          <div className="flex flex-wrap gap-2">{r.internalByCurrency.map((x) => <div key={x.currency} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
            <b>{x.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} {x.currency}</b><span className="mr-2 text-xs text-white/45">· {x.count} حركة</span>
          </div>)}</div>
        </section>}

        <p className="rounded-xl border border-white/10 p-3 text-xs leading-6 text-white/50">
          التقرير تجميعي للدفاتر وحالات المنتجات. الحالة «مدفوع/معتمد» ليست دائماً إثباتاً مصرفياً مستقلاً؛ وتبقى مطابقة المعاملات الخارجية وتكاليف الاستضافة والتشغيل ضرورية لحساب صافي الربح.
        </p>
      </>}
    </main>
  );
}
