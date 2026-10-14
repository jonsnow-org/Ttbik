"use client";
import { useState } from "react";
import type { AppItem } from "@/lib/hub/appConfig";

export default function QuizApp({ items, color }: { items: AppItem[]; color: string }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const done = Object.keys(picked).length === items.length && items.length > 0;
  const score = items.reduce((s, it, i) => s + (picked[i] === it.answer ? 1 : 0), 0);
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="font-bold text-slate-900">{i + 1}. {it.title}</div>
          <div className="mt-3 grid gap-2">
            {(it.options || []).map((o, k) => {
              const chosen = picked[i] === k;
              const show = picked[i] !== undefined;
              const right = k === it.answer;
              return (
                <button
                  key={k}
                  disabled={show}
                  onClick={() => setPicked({ ...picked, [i]: k })}
                  className={`rounded-xl border p-2 text-right text-sm ${show && right ? "border-emerald-500 bg-emerald-50" : chosen ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {done && (
        <div className="rounded-2xl p-4 text-center font-extrabold text-white" style={{ background: color }}>
          نتيجتك: {score} من {items.length}
        </div>
      )}
    </div>
  );
}
