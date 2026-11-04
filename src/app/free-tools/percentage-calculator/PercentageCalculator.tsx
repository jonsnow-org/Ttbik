"use client";

import { useState } from "react";
import { parseLocalizedNumber } from "@/lib/numberInput";
import { calculatePercentageChange } from "@/lib/percentageChange";

const num = (v: string) => parseLocalizedNumber(v, { fallback: NaN });
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ar-SA", { maximumFractionDigits: 4 }) : "—");

function Row({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">{children}</div>;
}
function In({ value, set, label }: { value: string; set: (v: string) => void; label: string }) {
  return (
    <input value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" dir="ltr" aria-label={label} className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-center" />
  );
}
const Out = ({ v }: { v: string }) => <div className="rounded-xl bg-emerald-50 px-4 py-2 text-lg font-extrabold text-emerald-900">{v}</div>;

function changeLabel(oldValue: number, newValue: number): string {
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return "—";
  if (oldValue === 0) return "لا يمكن حساب نسبة التغيير من صفر";
  const pct = calculatePercentageChange(oldValue, newValue);
  if (pct === null) return "لا يمكن حساب نسبة التغيير من صفر";
  return `${fmt(pct)}٪ ${newValue >= oldValue ? "زيادة" : "نقصان"}`;
}

export default function PercentageCalculator() {
  const [a1, setA1] = useState("15");
  const [b1, setB1] = useState("200");
  const [a2, setA2] = useState("30");
  const [b2, setB2] = useState("120");
  const [a3, setA3] = useState("100");
  const [b3, setB3] = useState("130");
  const [a4, setA4] = useState("250");
  const [b4, setB4] = useState("20");

  return (
    <div className="space-y-4">
      <Row>
        <p className="font-bold text-slate-800">كم يساوي <In value={a1} set={setA1} label="النسبة" />٪ من <In value={b1} set={setB1} label="العدد" /> ؟</p>
        <Out v={fmt((num(a1) / 100) * num(b1))} />
      </Row>
      <Row>
        <p className="font-bold text-slate-800"><In value={a2} set={setA2} label="الجزء" /> هو كم ٪ من <In value={b2} set={setB2} label="الكل" /> ؟</p>
        <Out v={`${fmt((num(a2) / num(b2)) * 100)}٪`} />
      </Row>
      <Row>
        <p className="font-bold text-slate-800">نسبة التغيير من <In value={a3} set={setA3} label="القيمة القديمة" /> إلى <In value={b3} set={setB3} label="القيمة الجديدة" /></p>
        <Out v={changeLabel(num(a3), num(b3))} />
      </Row>
      <Row>
        <p className="font-bold text-slate-800">سعر <In value={a4} set={setA4} label="السعر" /> بعد خصم <In value={b4} set={setB4} label="الخصم" />٪</p>
        <Out v={`${fmt(num(a4) * (1 - num(b4) / 100))}  (وفّرت ${fmt((num(a4) * num(b4)) / 100)})`} />
      </Row>
    </div>
  );
}
