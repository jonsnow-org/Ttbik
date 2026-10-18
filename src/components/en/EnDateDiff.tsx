"use client";

import { useMemo, useState } from "react";
import { Card, Field, Result } from "./EnUi";

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function EnDateDiff() {
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date(Date.now() + 30 * DAY)));
  const [add, setAdd] = useState("90");
  const diff = useMemo(() => {
    const a = new Date(from + "T00:00:00Z");
    const b = new Date(to + "T00:00:00Z");
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const [s, e] = a <= b ? [a, b] : [b, a];
    let y = e.getUTCFullYear() - s.getUTCFullYear();
    let m = e.getUTCMonth() - s.getUTCMonth();
    let d = e.getUTCDate() - s.getUTCDate();
    if (d < 0) {
      m--;
      d += new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate();
    }
    if (m < 0) {
      y--;
      m += 12;
    }
    const days = Math.round((e.getTime() - s.getTime()) / DAY);
    return { y, m, d, days };
  }, [from, to]);
  const added = useMemo(() => {
    const a = new Date(from + "T00:00:00Z");
    const n = parseInt(add, 10);
    if (Number.isNaN(a.getTime()) || !Number.isFinite(n)) return "";
    return new Date(a.getTime() + n * DAY).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }, [from, add]);
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-extrabold">Days between two dates</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" value={from} set={setFrom} type="date" />
          <Field label="To" value={to} set={setTo} type="date" />
        </div>
        {diff && <Result label={`${diff.days.toLocaleString("en-US")} days · ${Math.floor(diff.days / 7)} weeks`} value={`${diff.y} years, ${diff.m} months, ${diff.d} days`} />}
      </Card>
      <Card>
        <h2 className="font-extrabold">Add or subtract days</h2>
        <Field label="Days to add (use a negative number to go back) from the date above" value={add} set={setAdd} />
        {added && <Result label="Resulting date" value={added} />}
      </Card>
    </div>
  );
}
