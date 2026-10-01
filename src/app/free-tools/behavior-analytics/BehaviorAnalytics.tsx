"use client";

import { useMemo, useState } from "react";

type Row = { t: number; event: string; user: string };

function parseInput(raw: string): Row[] {
  const text = raw.trim();
  if (!text) return [];
  // JSON array
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text) as any[];
      return arr
        .map((o) => {
          const event = String(o.event || o.action || o.type || o.name || "").slice(0, 64);
          const user = String(o.user_id || o.user || o.uid || o.id || "anon").slice(0, 64);
          let t = 0;
          const ts = o.at || o.time || o.timestamp || o.created_at || o.ts;
          if (typeof ts === "number") t = ts > 1e12 ? Math.floor(ts / 1000) : ts;
          else if (ts) t = Math.floor(new Date(ts).getTime() / 1000) || 0;
          return event ? { t, event, user } : null;
        })
        .filter(Boolean) as Row[];
    } catch {
      /* fall through */
    }
  }
  // CSV / TSV / lines: time,event,user
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: Row[] = [];
  for (const line of lines) {
    if (/^(time|timestamp|at|created)/i.test(line) && /event/i.test(line)) continue;
    const parts = line.includes("\t") ? line.split("\t") : line.split(/,|;/);
    if (parts.length < 2) continue;
    let t = 0;
    let event = "";
    let user = "anon";
    if (parts.length >= 3) {
      const a = parts[0].trim();
      const b = parts[1].trim();
      const c = parts[2].trim();
      const n = Number(a);
      if (!Number.isNaN(n) && n > 100000) {
        t = n > 1e12 ? Math.floor(n / 1000) : n;
        event = b;
        user = c || "anon";
      } else if (!Number.isNaN(Date.parse(a))) {
        t = Math.floor(new Date(a).getTime() / 1000);
        event = b;
        user = c || "anon";
      } else {
        event = a;
        user = b;
        t = Number(c) || 0;
      }
    } else {
      event = parts[0].trim();
      user = parts[1].trim() || "anon";
    }
    if (event) out.push({ t, event: event.slice(0, 64), user: user.slice(0, 64) });
  }
  return out;
}

function barWidth(n: number, max: number) {
  if (max <= 0) return "0%";
  return `${Math.max(4, Math.round((n / max) * 100))}%`;
}

const SAMPLE = `[
  {"event":"open","user_id":"u1","at":1710000000},
  {"event":"tab","user_id":"u1","at":1710000010},
  {"event":"play","user_id":"u1","at":1710000020},
  {"event":"view","user_id":"u2","at":1710000030},
  {"event":"like","user_id":"u2","at":1710000040},
  {"event":"open","user_id":"u3","at":1710000100},
  {"event":"play","user_id":"u3","at":1710000120}
]`;

export default function BehaviorAnalytics() {
  const [raw, setRaw] = useState("");
  const rows = useMemo(() => parseInput(raw), [raw]);

  const analysis = useMemo(() => {
    if (!rows.length) return null;
    const byEvent: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const hours = new Array(24).fill(0);
    for (const r of rows) {
      byEvent[r.event] = (byEvent[r.event] || 0) + 1;
      byUser[r.user] = (byUser[r.user] || 0) + 1;
      if (r.t > 0) {
        const h = new Date(r.t * 1000).getHours();
        hours[h]++;
      }
    }
    const eventsSorted = Object.entries(byEvent).sort((a, b) => b[1] - a[1]);
    const usersSorted = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxE = eventsSorted[0]?.[1] || 1;
    const maxU = usersSorted[0]?.[1] || 1;
    const maxH = Math.max(1, ...hours);
    // simple funnel if common names present
    const funnelKeys = ["open", "play", "view", "like", "share", "clone"];
    const funnel = funnelKeys
      .map((k) => ({ k, n: byEvent[k] || 0 }))
      .filter((x) => x.n > 0);
    return { eventsSorted, usersSorted, hours, maxE, maxU, maxH, funnel, uniqueUsers: Object.keys(byUser).length };
  }, [rows]);

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setRaw(SAMPLE)}
          className="rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 ring-1 ring-violet-100"
        >
          مثال تجريبي
        </button>
        <button
          type="button"
          onClick={() => setRaw("")}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
        >
          مسح
        </button>
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        dir="ltr"
        placeholder={'JSON: [{"event":"open","user_id":"1","at":1710000000}]\nأو CSV: time,event,user_id'}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-xs outline-none ring-violet-200 focus:ring-2"
      />
      {!analysis ? (
        <p className="text-center text-xs text-slate-400">الصق البيانات لعرض التحليل</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-sky-50 p-2 text-center ring-1 ring-sky-100">
              <p className="text-lg font-black text-sky-700">{rows.length}</p>
              <p className="text-[10px] font-bold text-sky-600">أحداث</p>
            </div>
            <div className="rounded-2xl bg-violet-50 p-2 text-center ring-1 ring-violet-100">
              <p className="text-lg font-black text-violet-700">{analysis.uniqueUsers}</p>
              <p className="text-[10px] font-bold text-violet-600">مستخدمون</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-2 text-center ring-1 ring-emerald-100">
              <p className="text-lg font-black text-emerald-700">{analysis.eventsSorted.length}</p>
              <p className="text-[10px] font-bold text-emerald-600">أنواع</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">توزيع الأحداث</p>
            <ul className="space-y-1.5">
              {analysis.eventsSorted.map(([k, n]) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 truncate font-bold text-slate-600">{k}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: barWidth(n, analysis.maxE) }} />
                  </div>
                  <span className="w-8 text-left font-black text-slate-700">{n}</span>
                </li>
              ))}
            </ul>
          </div>

          {analysis.funnel.length >= 2 && (
            <div>
              <p className="mb-2 text-xs font-black text-slate-700">قمع تقريبي</p>
              <div className="flex flex-wrap items-end gap-2">
                {analysis.funnel.map((f, i) => {
                  const prev = i === 0 ? f.n : analysis.funnel[i - 1].n || 1;
                  const rate = i === 0 ? 100 : Math.round((f.n / prev) * 100);
                  return (
                    <div key={f.k} className="min-w-[4.5rem] flex-1 rounded-xl bg-indigo-50 p-2 text-center ring-1 ring-indigo-100">
                      <p className="text-[10px] font-bold text-indigo-500">{f.k}</p>
                      <p className="text-base font-black text-indigo-800">{f.n}</p>
                      <p className="text-[9px] text-indigo-500">{rate}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">أكثر المستخدمين نشاطاً</p>
            <ul className="space-y-1.5">
              {analysis.usersSorted.map(([k, n]) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate font-bold text-slate-600" dir="ltr">
                    {k}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: barWidth(n, analysis.maxU) }} />
                  </div>
                  <span className="w-8 text-left font-black text-slate-700">{n}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">النشاط حسب ساعة اليوم</p>
            <div className="flex h-16 items-end gap-0.5">
              {analysis.hours.map((n, h) => (
                <div key={h} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                  <div
                    className="w-full max-w-[10px] rounded-t bg-emerald-400"
                    style={{ height: `${Math.max(n ? 8 : 2, Math.round((n / analysis.maxH) * 56))}px` }}
                    title={`${h}:00 — ${n}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-slate-400">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </div>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-slate-400">
        المعالجة محلية بالكامل في متصفحك. الصق تصدير أحداث من تطبيقك أو الميني‑آب (JSON/CSV). لا تُرفع
        البيانات إلى خوادمنا.
      </p>
    </div>
  );
}
