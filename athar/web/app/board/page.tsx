"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Top, useApi } from "@/components/ui";
import { indexOf, ruleTier, ymd } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
import { useI18n } from "@/lib/i18n";

// The calendar board: one cell per date of the season (8 years x 366 days). Taken dates light up in their rarity colour.
const YEARS = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007];
const CELL = 4, W = 366 * CELL, H = YEARS.length * (CELL + 1);
const COL = ["#7aa2ff", "#c78bff", "#ffd36a"];
const DIM = "#16213f";

export default function Board() {
  const { t, dateLabel } = useI18n();
  const { data } = useApi<{ taken: number[] }>("/api/board", 30000);
  const [pick, setPick] = useState<number | null>(null);
  const taken = useMemo(() => new Set(data?.taken ?? []), [data]);
  const cells = useMemo(() => YEARS.flatMap((y, r) => Array.from({ length: 366 }, (_, c) => {
    const d = new Date(Date.UTC(y, 0, 1 + c));
    if (d.getUTCFullYear() !== y) return null;                    // day 366 of a normal year
    const i = indexOf(y, d.getUTCMonth() + 1, d.getUTCDate());
    return { i, r, c };
  }).filter(Boolean) as { i: number; r: number; c: number }[]), []);
  const count = cells.filter((x) => taken.has(x.i)).length;
  return (
    <>
      <Top />
      <div className="card">
        <h3>{t("board.title")}</h3>
        <p className="muted">{t("board.sub", { n: count, m: cells.length })}</p>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}
            onClick={(e) => {
              const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const c = Math.floor(((e.clientX - b.left) / b.width) * 366), r = Math.floor(((e.clientY - b.top) / b.height) * YEARS.length);
              const hit = cells.find((x) => x.c === c && x.r === r);
              setPick(hit ? hit.i : null);
            }}>
            {cells.map((x) => <rect key={x.i} x={x.c * CELL} y={x.r * (CELL + 1)} width={CELL - 0.6} height={CELL} fill={taken.has(x.i) ? COL[seasonTier(SEASON_1, x.i)] : DIM} />)}
          </svg>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 12 }}><span className="muted">2000 ↓ 2007</span></div>
        {pick != null && (() => { const q = ymd(pick); return <p style={{ marginTop: 10 }}><b>{dateLabel(q.y, q.m, q.d)}</b> · {t(`tier.${ruleTier(pick)}` as "tier.0")} · {taken.has(pick) ? <Link href={`/token/${pick}`} style={{ color: "var(--gold)" }}>{t("board.open")}</Link> : <Link href={`/date?i=${pick}`} style={{ color: "var(--gold)" }}>{t("board.free")}</Link>}</p>; })()}
      </div>
    </>
  );
}
