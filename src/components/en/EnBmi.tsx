"use client";

import { useState } from "react";
import { Card, Field, Result, Seg, num, fmt } from "./EnUi";

export default function EnBmi() {
  const [unit, setUnit] = useState<"metric" | "imperial">("metric");
  const [w, setW] = useState("70");
  const [h, setH] = useState("175");
  const [ft, setFt] = useState("5");
  const [inch, setInch] = useState("9");

  const kg = unit === "metric" ? num(w) : num(w) * 0.45359237;
  const m = unit === "metric" ? num(h) / 100 : (num(ft) * 12 + num(inch)) * 0.0254;
  const bmi = kg / (m * m);
  const ok = Number.isFinite(bmi) && kg > 0 && m > 0.5 && m < 2.8;
  const cat = !ok ? "" : bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy weight" : bmi < 30 ? "Overweight" : "Obesity";
  const lo = 18.5 * m * m;
  const hi = 24.9 * m * m;
  const toLb = (x: number) => x / 0.45359237;

  return (
    <Card>
      <Seg value={unit} set={setUnit} options={[["metric", "Metric (kg, cm)"], ["imperial", "Imperial (lb, ft/in)"]]} />
      <Field label={unit === "metric" ? "Weight (kg)" : "Weight (lb)"} value={w} set={setW} />
      {unit === "metric" ? (
        <Field label="Height (cm)" value={h} set={setH} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Feet" value={ft} set={setFt} />
          <Field label="Inches" value={inch} set={setInch} />
        </div>
      )}
      {ok && (
        <div className="space-y-2">
          <Result label="Your BMI" value={fmt(bmi, 1)} />
          <Result label="Category (WHO adult ranges)" value={cat} tone="slate" />
          <Result
            label="Healthy weight range for your height (BMI 18.5–24.9)"
            value={unit === "metric" ? `${fmt(lo, 1)}–${fmt(hi, 1)} kg` : `${fmt(toLb(lo), 1)}–${fmt(toLb(hi), 1)} lb`}
            tone="slate"
          />
        </div>
      )}
      <p className="text-xs text-slate-500">BMI is a screening number for adults, not a diagnosis. It does not distinguish muscle from fat.</p>
    </Card>
  );
}
