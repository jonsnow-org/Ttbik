"use client";

import { useMemo, useState } from "react";

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

// Default nisab approximations (owner can edit). Gold ~85g pure, silver ~595g.
const DEFAULT_GOLD_NISAB_G = 85;
const DEFAULT_SILVER_NISAB_G = 595;
const ZAKAT_RATE = 0.025;

const KARAT_FACTOR: Record<string, number> = {
  "24": 1,
  "22": 22 / 24,
  "21": 21 / 24,
  "18": 18 / 24,
};

export default function ZakatCalculator() {
  const [cash, setCash] = useState("");
  const [goldGrams, setGoldGrams] = useState("");
  const [goldKarat, setGoldKarat] = useState("24");
  const [goldPricePerG, setGoldPricePerG] = useState(""); // optional; if empty treat gold as weight-only vs nisab
  const [silverGrams, setSilverGrams] = useState("");
  const [silverPricePerG, setSilverPricePerG] = useState("");
  const [stocks, setStocks] = useState("");
  const [tradeGoods, setTradeGoods] = useState("");
  const [debts, setDebts] = useState("");
  const [nisabGoldG, setNisabGoldG] = useState(String(DEFAULT_GOLD_NISAB_G));
  const [nisabSilverG, setNisabSilverG] = useState(String(DEFAULT_SILVER_NISAB_G));
  const [useGoldNisab, setUseGoldNisab] = useState(true);

  const result = useMemo(() => {
    const cashV = parseNum(cash);
    const goldG = parseNum(goldGrams);
    const factor = KARAT_FACTOR[goldKarat] ?? 1;
    const pureGoldG = goldG * factor;
    const goldPrice = parseNum(goldPricePerG);
    const goldValue = pureGoldG * goldPrice;

    const silverG = parseNum(silverGrams);
    const silverPrice = parseNum(silverPricePerG);
    const silverValue = silverG * silverPrice;

    const stocksV = parseNum(stocks);
    const tradeV = parseNum(tradeGoods);
    const debtsV = parseNum(debts);

    // Monetary total for zakat base (cash + valued metals + stocks + trade)
    const assetsValue =
      cashV + goldValue + silverValue + stocksV + tradeV;
    const net = Math.max(0, assetsValue - debtsV);

    const nisabGold = parseNum(nisabGoldG) || DEFAULT_GOLD_NISAB_G;
    const nisabSilver = parseNum(nisabSilverG) || DEFAULT_SILVER_NISVER_G;

    // If prices provided, convert nisab to currency; else fall back to weight comparison for metals only.
    let nisabThreshold = 0;
    let metByWeight = false;

    if (useGoldNisab) {
      if (goldPrice > 0) {
        nisabThreshold = nisabGold * goldPrice;
      } else if (pureGoldG >= nisabGold) {
        metByWeight = true;
      }
    } else {
      if (silverPrice > 0) {
        nisabThreshold = nisabSilver * silverPrice;
      } else if (silverG >= nisabSilver) {
        metByWeight = true;
      }
    }

    // If no price at all and only cash/stocks/trade, use a soft note (user must set price for proper nisab).
    const hasPrice = goldPrice > 0 || silverPrice > 0;
    const reached =
      metByWeight || (hasPrice && net >= nisabThreshold) || (!hasPrice && net > 0 && (cashV + stocksV + tradeV) > 0 && (pureGoldG >= nisabGold || silverG >= nisabSilver));

    // Conservative: if we have currency total and a currency nisab, use it; else weight.
    const reachedFinal =
      hasPrice && nisabThreshold > 0
        ? net >= nisabThreshold
        : metByWeight || pureGoldG >= nisabGold || silverG >= nisabSilver;

    const zakatDue = reachedFinal ? net * ZAKAT_RATE : 0;

    return {
      cashV,
      pureGoldG,
      goldValue,
      silverG,
      silverValue,
      stocksV,
      tradeV,
      debtsV,
      assetsValue,
      net,
      nisabThreshold,
      reached: reachedFinal,
      zakatDue,
      hasPrice,
    };
  }, [
    cash,
    goldGrams,
    goldKarat,
    goldPricePerG,
    silverGrams,
    silverPricePerG,
    stocks,
    tradeGoods,
    debts,
    nisabGoldG,
    nisabSilverG,
    useGoldNisab,
  ]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      <div className="space-y-3">
        <Field
          label="نقد / ودائع بنكية"
          value={cash}
          onChange={setCash}
          placeholder="مثال: 10000"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="ذهب (جرام)"
            value={goldGrams}
            onChange={setGoldGrams}
            placeholder="جرام"
          />
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              عيار الذهب
            </label>
            <select
              value={goldKarat}
              onChange={(e) => setGoldKarat(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="24">24 قيراط (خالص)</option>
              <option value="22">22 قيراط</option>
              <option value="21">21 قيراط</option>
              <option value="18">18 قيراط</option>
            </select>
          </div>
        </div>
        <Field
          label="سعر جرام الذهب (اختياري — لحساب القيمة والنصاب بالمال)"
          value={goldPricePerG}
          onChange={setGoldPricePerG}
          placeholder="مثال: 280"
        />
        <Field
          label="فضة (جرام)"
          value={silverGrams}
          onChange={setSilverGrams}
          placeholder="جرام"
        />
        <Field
          label="سعر جرام الفضة (اختياري)"
          value={silverPricePerG}
          onChange={setSilverPricePerG}
          placeholder="مثال: 3.5"
        />
        <Field
          label="أسهم / صناديق (القيمة السوقية)"
          value={stocks}
          onChange={setStocks}
          placeholder="قيمة"
        />
        <Field
          label="عروض تجارة (قيمة البضاعة)"
          value={tradeGoods}
          onChange={setTradeGoods}
          placeholder="قيمة"
        />
        <Field
          label="ديون مستحقة عليك (تُخصم)"
          value={debts}
          onChange={setDebts}
          placeholder="اختياري"
        />
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-600">إعدادات النصاب (قابلة للتعديل)</p>
        <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setUseGoldNisab(true)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
              useGoldNisab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            نصاب الذهب
          </button>
          <button
            type="button"
            onClick={() => setUseGoldNisab(false)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${\n              !useGoldNisab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            نصاب الفضة
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="نصاب الذهب (جرام خالص)"
            value={nisabGoldG}
            onChange={setNisabGoldG}
            placeholder="85"
          />
          <Field
            label="نصاب الفضة (جرام)"
            value={nisabSilverG}
            onChange={setNisabSilverG}
            placeholder="595"
          />
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          القيم الافتراضية تقريبية (ذهب ≈ 85 جرام خالص، فضة ≈ 595 جرام). أدخل سعر
          الجرام الحالي لحساب أدق بالمال. لا تغني عن فتوى أو محاسب شرعي.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <Row label="إجمالي الأصول الزكوية" value={fmt(result.assetsValue)} />
        <Row label="بعد خصم الديون" value={fmt(result.net)} />
        {result.hasPrice && result.nisabThreshold > 0 && (
          <Row
            label={useGoldNisab ? "النصاب (ذهب × السعر)" : "النصاب (فضة × السعر)"}
            value={fmt(result.nisabThreshold)}
          />
        )}
        <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
          <span className="text-slate-700 font-semibold">هل بلغ النصاب؟</span>
          <span
            className={`font-extrabold ${
              result.reached ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {result.reached ? "نعم — تجب الزكاة" : "لا — لم يبلغ النصاب"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-700 font-semibold">مبلغ الزكاة (2.5%)</span>
          <span className="font-extrabold text-emerald-700 text-lg" dir="ltr">
            {fmt(result.zakatDue)}
          </span>
        </div>
        {(result.pureGoldG > 0 || result.silverG > 0) && (
          <p className="text-[11px] text-slate-400 pt-1">
            ذهب خالص محسوب: {fmt(result.pureGoldG, 2)} ج · فضة:{" "}
            {fmt(result.silverG, 2)} ج
          </p>
        )}
      </div>

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        حاسبة تقريبية للزكاة على النقد والمعادن والأسهم وعروض التجارة. لا تشمل
        الزروع والأنعام. تعمل بالكامل داخل المتصفح — بلا تسجيل وبلا تخزين.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
        placeholder={placeholder}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-bold text-slate-900" dir="ltr">
        {value}
      </span>
    </div>
  );
}
