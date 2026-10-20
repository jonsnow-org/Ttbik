"use client";

import { useMemo, useState } from "react";
import { storeNetProfit } from "@/lib/storeProfit";

const parseNum = (v: string) => {
  const n = parseFloat(v.replace(/,/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });

const FIELDS = [
  { k: "price", label: "سعر البيع للطلب", ph: "100" },
  { k: "cost", label: "تكلفة المنتج", ph: "40" },
  { k: "shipping", label: "الشحن الذي يدفعه المتجر", ph: "10" },
  { k: "gatewayPct", label: "نسبة بوابة الدفع %", ph: "2.5" },
  { k: "gatewayFixed", label: "رسم ثابت للدفع لكل طلب", ph: "1" },
  { k: "platformPct", label: "عمولة منصة المتجر %", ph: "0" },
  { k: "adPerOrder", label: "تكلفة الإعلان لكل طلب", ph: "15" },
  { k: "returnPct", label: "نسبة المرتجعات %", ph: "10" },
  { k: "orders", label: "عدد الطلبات شهرياً", ph: "100" },
] as const;

export default function StoreNetProfitCalculator() {
  const [v, setV] = useState<Record<string, string>>({ price: "100", cost: "40", shipping: "10", gatewayPct: "2.5", gatewayFixed: "1", platformPct: "0", adPerOrder: "15", returnPct: "10", orders: "100" });
  const [copied, setCopied] = useState(false);
  const r = useMemo(
    () => storeNetProfit({ price: parseNum(v.price), cost: parseNum(v.cost), shipping: parseNum(v.shipping), gatewayPct: parseNum(v.gatewayPct), gatewayFixed: parseNum(v.gatewayFixed), platformPct: parseNum(v.platformPct), adPerOrder: parseNum(v.adPerOrder), returnPct: parseNum(v.returnPct), orders: parseNum(v.orders) }),
    [v],
  );
  const bad = parseNum(v.price) <= 0;
  const tone = r.expectedPerOrder >= 0 ? "text-emerald-700" : "text-red-600";

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.k}>
            <label className="mb-1 block text-sm font-semibold text-slate-700">{f.label}</label>
            <input value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} inputMode="decimal" dir="ltr" placeholder={f.ph} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none" />
          </div>
        ))}
      </div>

      {bad ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">أدخل سعر البيع (رقماً أكبر من صفر) لتظهر النتيجة.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-4 text-center">
              <p className="mb-1 text-xs text-slate-500">متوسط صافي الربح للطلب</p>
              <p className={`text-2xl font-extrabold ${tone}`} dir="ltr">{fmt(r.expectedPerOrder)}</p>
              <p className="mt-1 text-[11px] text-slate-400">بعد الرسوم والشحن والإعلان والمرتجعات</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="mb-1 text-xs text-slate-500">هامش الربح الصافي</p>
              <p className={`text-2xl font-extrabold ${tone}`} dir="ltr">{fmt(r.netMarginPct, 1)}%</p>
              <p className="mt-1 text-[11px] text-slate-400">من سعر البيع</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <Row label="رسوم الدفع والمنصة للطلب" value={fmt(r.feesPerOrder)} />
            <Row label="ربح طلب سُلِّم" value={fmt(r.profitDelivered)} tone={r.profitDelivered >= 0 ? "text-emerald-700" : "text-red-600"} />
            <Row label="نتيجة طلب مُرتجع" value={fmt(r.lossReturned)} tone="text-red-600" />
            <Row label="صافي الربح الشهري المتوقع" value={fmt(r.monthly)} tone={r.monthly >= 0 ? "text-emerald-700" : "text-red-600"} />
            <Row label="أقصى إعلان للطلب دون خسارة" value={r.maxAdPerOrder > 0 ? fmt(r.maxAdPerOrder) : "لا يوجد"} />
            <Row label="عائد الإعلان عند التعادل (ROAS)" value={r.breakEvenRoas ? `${fmt(r.breakEvenRoas, 2)}×` : "غير ممكن"} />
            <button
              type="button"
              onClick={async () => {
                const t = [`متوسط صافي الربح للطلب: ${fmt(r.expectedPerOrder)}`, `هامش الربح الصافي: ${fmt(r.netMarginPct, 1)}%`, `صافي الربح الشهري المتوقع: ${fmt(r.monthly)}`, `أقصى إعلان للطلب دون خسارة: ${r.maxAdPerOrder > 0 ? fmt(r.maxAdPerOrder) : "لا يوجد"}`].join("\n");
                try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
              }}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {copied ? "تم النسخ ✓" : "نسخ النتيجة"}
            </button>
          </div>
          {r.expectedPerOrder < 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">متوسط الطلب يخسر. راجع سعر البيع أو تكلفة الإعلان أو الشحن أو نسبة المرتجعات.</p>}
        </div>
      )}
      <p className="text-center text-[11px] leading-relaxed text-slate-400">
        الطلب المُرتجع: يعود المنتج للمخزون، ويدفع المتجر الشحن في الاتجاهين، ويخسر الرسم الثابت والإعلان. أرقام تقريبية لا تغني عن محاسبة مهنية.
        <br />تعمل بالكامل داخل المتصفح — بلا تسجيل وبلا تخزين. اكتب رسوم بوابتك ومنصتك الفعلية؛ الأرقام الافتراضية أمثلة فقط.
      </p>
    </div>
  );
}

function Row({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className={`font-bold ${tone}`} dir="ltr">{value}</span>
    </div>
  );
}
