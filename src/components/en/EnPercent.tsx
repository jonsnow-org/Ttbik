"use client";

import { useState } from "react";
import { Card, Result, num, fmt } from "./EnUi";

function In({ v, s, l }: { v: string; s: (x: string) => void; l: string }) {
  return <input aria-label={l} value={v} onChange={(e) => s(e.target.value)} inputMode="decimal" className="mx-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-center" />;
}
export default function EnPercent() {
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
      <Card>
        <p className="font-bold">What is <In v={a1} s={setA1} l="percent" />% of <In v={b1} s={setB1} l="number" />?</p>
        <Result label="Answer" value={fmt((num(a1) / 100) * num(b1), 4)} />
      </Card>
      <Card>
        <p className="font-bold"><In v={a2} s={setA2} l="part" /> is what % of <In v={b2} s={setB2} l="whole" />?</p>
        <Result label="Answer" value={`${fmt((num(a2) / num(b2)) * 100, 4)}%`} />
      </Card>
      <Card>
        <p className="font-bold">Percent change from <In v={a3} s={setA3} l="old" /> to <In v={b3} s={setB3} l="new" /></p>
        <Result label={num(b3) >= num(a3) ? "Increase" : "Decrease"} value={`${fmt(Math.abs(((num(b3) - num(a3)) / Math.abs(num(a3))) * 100), 4)}%`} />
      </Card>
      <Card>
        <p className="font-bold">Price <In v={a4} s={setA4} l="price" /> after <In v={b4} s={setB4} l="discount" />% off</p>
        <Result label="Sale price" value={`${fmt(num(a4) * (1 - num(b4) / 100))} (you save ${fmt((num(a4) * num(b4)) / 100)})`} />
      </Card>
    </div>
  );
}
