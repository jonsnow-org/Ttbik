"use client";

import type { ReactNode } from "react";

export const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
export const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—");

export function Card({ children }: { children: ReactNode }) {
  return <div dir="ltr" lang="en" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-left">{children}</div>;
}
export function Field({ label, value, set, type = "text", hint }: { label: string; value: string; set: (v: string) => void; type?: string; hint?: string }) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input type={type} value={value} onChange={(e) => set(e.target.value)} inputMode={type === "text" ? "decimal" : undefined} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base font-normal" />
      {hint && <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}
export function Result({ label, value, tone = "emerald" }: { label: string; value: string; tone?: "emerald" | "pink" | "slate" }) {
  const c = tone === "pink" ? "bg-pink-50 text-pink-900" : tone === "slate" ? "bg-slate-50 text-slate-900" : "bg-emerald-50 text-emerald-900";
  return (
    <div className={`rounded-xl px-4 py-3 ${c}`}>
      <div className="text-xs font-semibold opacity-75">{label}</div>
      <div className="text-xl font-extrabold">{value}</div>
    </div>
  );
}
export function Seg<T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => set(k)} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${value === k ? "bg-white shadow text-emerald-700" : "text-slate-600"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
