"use client";

import { useMemo, useState } from "react";
import { Card, Field, Result } from "./EnUi";

const DAY = 86400000;
const f = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export default function EnPregnancy() {
  const [lmp, setLmp] = useState("");
  const [cycle, setCycle] = useState("28");
  const r = useMemo(() => {
    if (!lmp) return null;
    const s = new Date(lmp + "T00:00:00");
    if (Number.isNaN(s.getTime())) return null;
    const adj = (Math.min(45, Math.max(21, parseInt(cycle, 10) || 28)) - 28) * DAY;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - s.getTime() - adj) / DAY);
    return { due: new Date(s.getTime() + 280 * DAY + adj), days, weeks: Math.floor(days / 7), rem: days % 7, conc: new Date(s.getTime() + 14 * DAY + adj), t2: new Date(s.getTime() + 91 * DAY + adj), t3: new Date(s.getTime() + 189 * DAY + adj) };
  }, [lmp, cycle]);
  return (
    <Card>
      <Field label="First day of your last period" value={lmp} set={setLmp} type="date" />
      <Field label="Average cycle length (days)" value={cycle} set={setCycle} hint="Default 28." />
      {r && (
        <div className="space-y-2">
          <Result label="Estimated due date" value={f(r.due)} tone="pink" />
          {r.days >= 0 && r.days <= 300 && <Result label="Pregnancy age today" value={`${r.weeks} weeks, ${r.rem} days`} />}
          <Result label="Estimated conception" value={f(r.conc)} tone="slate" />
          <Result label="Second trimester starts (week 14)" value={f(r.t2)} tone="slate" />
          <Result label="Third trimester starts (week 28)" value={f(r.t3)} tone="slate" />
        </div>
      )}
      <p className="text-xs text-slate-500">Estimate using Naegele&apos;s rule (280 days from the last period). An ultrasound and your doctor give the most accurate date.</p>
    </Card>
  );
}
