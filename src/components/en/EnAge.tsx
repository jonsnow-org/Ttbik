"use client";

import { useMemo, useState } from "react";
import { Card, Field, Result } from "./EnUi";

export default function EnAge() {
  const [dob, setDob] = useState("");
  const r = useMemo(() => {
    if (!dob) return null;
    const b = new Date(dob + "T00:00:00");
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    if (Number.isNaN(b.getTime()) || b > t) return null;
    let y = t.getFullYear() - b.getFullYear();
    let m = t.getMonth() - b.getMonth();
    let d = t.getDate() - b.getDate();
    if (d < 0) {
      m--;
      d += new Date(t.getFullYear(), t.getMonth(), 0).getDate();
    }
    if (m < 0) {
      y--;
      m += 12;
    }
    const days = Math.round((t.getTime() - b.getTime()) / 86400000);
    const next = new Date(t.getFullYear(), b.getMonth(), b.getDate());
    if (next <= t) next.setFullYear(t.getFullYear() + 1);
    return { y, m, d, days, next: Math.round((next.getTime() - t.getTime()) / 86400000), dow: b.toLocaleDateString("en-US", { weekday: "long" }) };
  }, [dob]);
  return (
    <Card>
      <Field label="Date of birth" value={dob} set={setDob} type="date" />
      {r && (
        <div className="space-y-2">
          <Result label="Your age" value={`${r.y} years, ${r.m} months, ${r.d} days`} />
          <Result label="Total days lived" value={r.days.toLocaleString("en-US")} tone="slate" />
          <Result label="Days until your next birthday" value={r.next === 0 ? "Today!" : String(r.next)} tone="pink" />
          <Result label="You were born on a" value={r.dow} tone="slate" />
        </div>
      )}
    </Card>
  );
}
