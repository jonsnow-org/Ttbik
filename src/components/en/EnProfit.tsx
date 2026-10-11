"use client";

import { useState } from "react";
import { Card, Field, Result, num, fmt } from "./EnUi";

export default function EnProfit() {
  const [cost, setCost] = useState("40");
  const [price, setPrice] = useState("100");
  const [fixed, setFixed] = useState("1000");
  const c = num(cost);
  const p = num(price);
  const f = num(fixed) || 0;
  const ok = c >= 0 && p > 0;
  const profit = p - c;
  return (
    <Card>
      <Field label="Cost per unit" value={cost} set={setCost} />
      <Field label="Selling price per unit" value={price} set={setPrice} />
      <Field label="Fixed costs (optional, for break-even)" value={fixed} set={setFixed} />
      {ok && (
        <div className="space-y-2">
          <Result label="Profit per unit" value={fmt(profit)} />
          <Result label="Profit margin (profit ÷ price)" value={`${fmt((profit / p) * 100, 1)}%`} tone="slate" />
          <Result label="Markup (profit ÷ cost)" value={c > 0 ? `${fmt((profit / c) * 100, 1)}%` : "—"} tone="slate" />
          <Result label="Break-even units" value={profit > 0 ? `${fmt(Math.ceil(f / profit), 0)} units` : "Price must exceed cost"} tone="pink" />
        </div>
      )}
      <p className="text-xs text-slate-500">Margin and markup are different: a 100% markup is only a 50% margin.</p>
    </Card>
  );
}
