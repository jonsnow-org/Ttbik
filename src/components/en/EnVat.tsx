"use client";

import { useState } from "react";
import { Card, Field, Result, Seg, num, fmt } from "./EnUi";

export default function EnVat() {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("100");
  const [rate, setRate] = useState("15");
  const a = num(amount);
  const r = num(rate) / 100;
  const ok = a >= 0 && r >= 0;
  const net = mode === "add" ? a : a / (1 + r);
  const vat = mode === "add" ? a * r : a - a / (1 + r);
  const gross = mode === "add" ? a + a * r : a;
  return (
    <Card>
      <Seg value={mode} set={setMode} options={[["add", "Add VAT"], ["remove", "Remove VAT"]]} />
      <Field label={mode === "add" ? "Price before VAT" : "Price including VAT"} value={amount} set={setAmount} />
      <Field label="VAT rate (%)" value={rate} set={setRate} hint="Examples: UK 20, Germany 19, Saudi Arabia 15, UAE 5, Canada GST 5." />
      {ok && (
        <div className="space-y-2">
          <Result label="Net (before VAT)" value={fmt(net)} tone="slate" />
          <Result label="VAT amount" value={fmt(vat)} tone="pink" />
          <Result label="Gross (including VAT)" value={fmt(gross)} />
        </div>
      )}
    </Card>
  );
}
