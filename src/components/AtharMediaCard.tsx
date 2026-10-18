"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Athar in the media mini app (light theme). Two uses: a native in-feed card tied to a post's own day ("the day this clip was shared"), and a
// fuller card with a date picker on the profile. It only reads Athar's public look at a day (/api/media-athar) and opens Athar's own page;
// payment stays inside Athar. Gift / memory wording only: no prices, no returns. If Athar does not answer, `fallback` (the usual ad) shows.
type Day = { index: number; label: string; link: string; img: string; known: boolean; kinds: { name: string; free: boolean | null }[]; anyFree: boolean | null };
type Resp = { ok: boolean; day?: Day; bot?: string; home?: string };
const memo = new Map<string, Resp>();

const ymd = (ts?: number) => { const d = ts ? new Date(ts * 1000) : new Date(); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); };

function useDay(date: string, active: boolean) {
  const [r, setR] = useState<Resp | null>(() => memo.get(date) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const hit = memo.get(date);
    if (hit) { setR(hit); setFailed(!hit.ok); return; }
    let live = true;
    fetch(`/api/media-athar?date=${encodeURIComponent(date)}`).then((x) => x.json()).then((j: Resp) => {
      if (!live) return;
      memo.set(date, j); setR(j); setFailed(!j.ok);
    }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [date, active]);
  return { r, failed };
}

function Token({ day, size }: { day?: Day; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [day?.img]);
  return (
    <span style={{ width: size, height: size }} className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 ring-1 ring-amber-300/60">
      {day && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={day.img} alt={day.label} width={size} height={size} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        : <span className="text-2xl">💎</span>}
    </span>
  );
}
function Chips({ day }: { day: Day }) {
  return (
    <span className="flex flex-wrap gap-1">
      {day.kinds.map((k) => (
        <span key={k.name} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${k.free === false ? "bg-slate-100 text-slate-400 line-through" : k.free ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-500"}`}>
          {k.free === false ? "🔒" : k.free ? "✓" : "•"} {k.name}
        </span>
      ))}
    </span>
  );
}
const statusOf = (day?: Day) => !day ? "…" : day.anyFree === null ? "ذكرى لهذا اليوم" : day.anyFree ? "✨ متاح للإهداء الآن" : "🔒 لهذا اليوم مالك — جرّب يوماً آخر";

/** In-feed card for one post: the day it was shared. Mounts its request only when it scrolls near the screen. */
export function AtharFeedCard({ createdAt, onOpen, fallback }: { createdAt?: number; onOpen: (url: string, where: string) => void; fallback: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const date = ymd(createdAt);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); o.disconnect(); } }, { rootMargin: "400px" });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  const { r, failed } = useDay(date, near && !!date);
  if (failed || !date) return <>{fallback}</>;
  const day = r?.day;
  return (
    <div ref={ref} data-testid="athar-feed-card" className="overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50 via-white to-sky-50 shadow-sm ring-1 ring-amber-200">
      <button type="button" onClick={() => day && onOpen(day.link, "feed")} disabled={!day} className="flex w-full items-center gap-3 p-3 text-right">
        <Token day={day} size={72} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold text-amber-700">🕰 أثر · رمز لكل يوم على TON</span>
          <span className="mt-0.5 block text-sm font-black text-slate-800">يوم هذا المقطع في أثر</span>
          <span className="block text-xs text-slate-600">{day ? `${day.label} · ${statusOf(day)}` : "…"}</span>
        </span>
        <span className="text-slate-300">‹</span>
      </button>
      {day && <div className="border-t border-amber-100 px-3 py-2"><Chips day={day} /></div>}
    </div>
  );
}

/** Profile card: today's day (or a picked one) with the date picker; opens the day in Athar. */
export function AtharProfileCard({ onOpen }: { onOpen: (url: string, where: string) => void }) {
  const [date, setDate] = useState("");
  const [picking, setPicking] = useState(false);
  const today = ymd();
  const { r, failed } = useDay(date || today, true);
  if (failed) return null;
  const day = r?.day;
  return (
    <div data-testid="athar-profile-card" className="mb-4 overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white">
      <div className="flex items-center gap-3 p-4">
        <Token day={day} size={80} />
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] font-bold text-amber-700">🕰 أثر · رمز لكل يوم على TON</p>
          <p className="mt-0.5 text-sm font-black text-slate-800">{date ? "يومك في أثر" : "يوم اليوم في أثر"}</p>
          <p className="text-xs text-slate-600">{day ? day.label : "…"}</p>
          <p className="mt-1 text-[11px] text-slate-500">{statusOf(day)}</p>
        </div>
      </div>
      {day && <div className="px-4 pb-3"><Chips day={day} /></div>}
      <div className="flex gap-2 border-t border-amber-100 bg-white/60 p-3">
        <button type="button" disabled={!day} onClick={() => day && onOpen(day.link, "profile")} className="flex-1 rounded-2xl bg-gradient-to-l from-amber-500 to-orange-500 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">افتح هذا اليوم ←</button>
        <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="rounded-2xl bg-white px-3 py-2.5 text-xs font-bold text-slate-700 ring-1 ring-amber-200">📅 اختر يومك</button>
      </div>
      {picking && (
        <div className="border-t border-amber-100 p-3">
          <p className="mb-2 text-[11px] text-slate-500">ميلادك، ذكرى زواجكما، أو أي يوم تحبه (1950–2049). لا يُحفظ شيء.</p>
          <input type="date" min="1950-01-01" max="2049-12-31" value={date} onChange={(e) => setDate(e.target.value)} aria-label="اختر يوماً" className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none" />
          {r?.bot && <button type="button" onClick={() => onOpen(r.bot!, "profile_promo")} className="mt-2 text-[11px] font-bold text-amber-700 underline">🕰 تعرّف على «أثر»</button>}
        </div>
      )}
    </div>
  );
}
