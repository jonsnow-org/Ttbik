"use client";

import { useState } from "react";

type Item = { desc: string; qty: string; price: string };
const inp = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const n = (v: string) => { const x = parseFloat(v.replace(/,/g, "")); return Number.isFinite(x) ? x : 0; };
const money = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EnInvoice() {
  const [kind, setKind] = useState<"Invoice" | "Service agreement">("Invoice");
  const [no, setNo] = useState("INV-001");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cur, setCur] = useState("USD");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tax, setTax] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([{ desc: "", qty: "1", price: "0" }]);
  const sub = items.reduce((s, i) => s + n(i.qty) * n(i.price), 0);
  const taxAmt = (sub * n(tax)) / 100;
  const total = sub + taxAmt;
  const set = (i: number, k: keyof Item, v: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div dir="ltr" lang="en" className="space-y-5 text-left">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 print:hidden">
        <div className="grid gap-3 sm:grid-cols-4">
          <select className={inp} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option>Invoice</option><option>Service agreement</option></select>
          <input className={inp} placeholder="Number" value={no} onChange={(e) => setNo(e.target.value)} />
          <input className={inp} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input className={inp} placeholder="Currency (USD, EUR…)" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <textarea className={inp} rows={3} placeholder="From (your name, business, address)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <textarea className={inp} rows={3} placeholder="Bill to (client name, address)" value={to} onChange={(e) => setTo(e.target.value)} />
        <div>
          <div className="mb-1 flex items-center justify-between text-sm font-bold"><span>Line items</span><button type="button" className="text-emerald-700" onClick={() => setItems([...items, { desc: "", qty: "1", price: "0" }])}>+ Add</button></div>
          {items.map((it, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_70px_90px] gap-2">
              <input className={inp} placeholder="Description" value={it.desc} onChange={(e) => set(i, "desc", e.target.value)} />
              <input className={inp} placeholder="Qty" value={it.qty} onChange={(e) => set(i, "qty", e.target.value)} />
              <input className={inp} placeholder="Price" value={it.price} onChange={(e) => set(i, "price", e.target.value)} />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inp} placeholder="Tax / VAT %" value={tax} onChange={(e) => setTax(e.target.value)} />
          <input className={inp} placeholder="Notes / payment terms" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="button" onClick={() => window.print()} className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white">🖨️ Print / Save as PDF</button>
        <p className="text-xs text-slate-500">Everything stays in your browser. In the print dialog choose “Save as PDF”.</p>
      </div>
      <div id="invoice-print-area" className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between">
          <h2 className="text-2xl font-extrabold uppercase">{kind}</h2>
          <div className="text-right text-sm"><p className="font-bold">{no}</p><p className="text-slate-500">{date}</p></div>
        </div>
        <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div><p className="text-xs font-bold uppercase text-slate-500">From</p><p className="whitespace-pre-line">{from || "—"}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-500">Bill to</p><p className="whitespace-pre-line">{to || "—"}</p></div>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b-2 border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {items.filter((i) => i.desc || n(i.price)).map((it, i) => (
              <tr key={i} className="border-b border-slate-100"><td className="py-2">{it.desc}</td><td className="py-2 text-right">{it.qty}</td><td className="py-2 text-right">{money(n(it.price))}</td><td className="py-2 text-right">{money(n(it.qty) * n(it.price))}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-56 space-y-1 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span>{money(sub)} {cur}</span></p>
          {n(tax) > 0 && <p className="flex justify-between"><span>Tax ({n(tax)}%)</span><span>{money(taxAmt)} {cur}</span></p>}
          <p className="flex justify-between border-t border-slate-300 pt-1 text-base font-extrabold"><span>Total</span><span>{money(total)} {cur}</span></p>
        </div>
        {notes && <p className="mt-6 text-sm text-slate-600">{notes}</p>}
        {kind === "Service agreement" && (
          <div className="mt-8 grid grid-cols-2 gap-8 text-sm"><div className="border-t border-slate-400 pt-1">Service provider signature</div><div className="border-t border-slate-400 pt-1">Client signature</div></div>
        )}
      </div>
      <style>{`@media print{body *{visibility:hidden}#invoice-print-area,#invoice-print-area *{visibility:visible}#invoice-print-area{position:absolute;left:0;top:0;width:100%}}`}</style>
    </div>
  );
}
