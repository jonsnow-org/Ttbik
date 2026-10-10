"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Top, KindBadge, useApi } from "@/components/ui";
import { indexOf, ymd } from "@/lib/dates";
import { dateOf, idOf, kindOf, KIND_COUNT } from "@/lib/kinds";
import { useI18n } from "@/lib/i18n";

// The calendar board: one cell per date of a decade (10 years x 366 days). A date lights up in the colour of the highest kind taken on it.
const CELL = 4;
const COL = ["#7aa2ff", "#d5dcec", "#ffd36a", "#e08a4a", "#5ff0cf", "#c78bff", "#bfe9ff", "#ffe07a"];
const DIM = "#16213f";
const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030, 2040];

export default function Board() {
  const { t, dateLabel } = useI18n();
  const { data } = useApi<{ taken: number[] }>("/api/board", 30000);
  const [from, setFrom] = useState(2020);
  const [pick, setPick] = useState<number | null>(null);
  const YEARS = Array.from({ length: 10 }, (_, k) => from + k);
  const W = 366 * CELL, H = YEARS.length * (CELL + 1);
  // date -> the kinds taken on it
  const byDate = useMemo(() => { const m = new Map<number, number[]>(); for (const id of data?.taken ?? []) { const d = dateOf(id); (m.get(d) ?? m.set(d, []).get(d)!).push(kindOf(id)); } return m; }, [data]);
  const cells = useMemo(() => YEARS.flatMap((y, r) => Array.from({ length: 366 }, (_, c) => {
    const d = new Date(Date.UTC(y, 0, 1 + c));
    if (d.getUTCFullYear() !== y) return null;                    // day 366 of a normal year
    const i = indexOf(y, d.getUTCMonth() + 1, d.getUTCDate());
    return { i, r, c };
  }).filter(Boolean) as { i: number; r: number; c: number }[]), [from]);   // eslint-disable-line react-hooks/exhaustive-deps
  const count = cells.filter((x) => byDate.has(x.i)).length;
  const top = (i: number) => Math.max(...(byDate.get(i) ?? [0]));
  return (
    <>
      <Top />
      <div className="card">
        <h3>{t("board.title")}</h3>
        <p className="muted">{t("board.sub", { n: count, m: cells.length })}</p>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {DECADES.map((v) => <button key={v} type="button" className={`btn sm ${from === v ? "" : "ghost"}`} onClick={() => { setFrom(v); setPick(null); }}>{v}s</button>)}
        </div>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}
            onClick={(e) => {
              const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const c = Math.floor(((e.clientX - b.left) / b.width) * 366), r = Math.floor(((e.clientY - b.top) / b.height) * YEARS.length);
              const hit = cells.find((x) => x.c === c && x.r === r);
              setPick(hit ? hit.i : null);
            }}>
            {cells.map((x) => <rect key={x.i} x={x.c * CELL} y={x.r * (CELL + 1)} width={CELL - 0.6} height={CELL} fill={byDate.has(x.i) ? COL[top(x.i)] : DIM} />)}
          </svg>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 12 }}><span className="muted">{from} ↓ {from + 9}</span></div>
        {pick != null && (() => { const q = ymd(pick); const ks = byDate.get(pick) ?? []; return (
          <div style={{ marginTop: 10 }}>
            <p><b>{dateLabel(q.y, q.m, q.d)}</b> · <Link href={`/date?i=${pick}`} style={{ color: "var(--gold)" }}>{t("board.free")}</Link></p>
            {Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => ks.includes(k)).map((k) => <p key={k}><KindBadge kind={k} /> <Link href={`/token/${idOf(k, pick)}`} style={{ color: "var(--gold)" }}>{t("board.open")}</Link></p>)}
          </div>
        ); })()}
      </div>
    </>
  );
}
