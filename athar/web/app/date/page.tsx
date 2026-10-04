"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Address } from "@ton/core";
import { Top, TierBadge, ton, useApi, useSend } from "@/components/ui";
import { indexOf, TOTAL_DATES, ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { buyMsg, short } from "@/lib/tx";

type Info = { index: number; tier: number; inSeason: boolean; reserved: boolean; taken: boolean; owner: string | null; price: number | null; auction: null | { live: boolean; endAt: number; highBid: number; reserve: number } };
type Season = { configured: boolean; minter?: string; deployed?: boolean; status?: number };

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export default function DatePage() {
  const { t, dateLabel, monthNames } = useI18n();
  const [y, setY] = useState(2003), [m, setM] = useState(3), [d, setD] = useState(14);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("i");
    if (q) { const i = Number(q); if (i >= 0 && i < TOTAL_DATES) { const t = ymd(i); setY(t.y); setM(t.m); setD(t.d); } }
  }, []);
  const maxD = daysIn(y, m);
  const dd = Math.min(d, maxD);
  const index = indexOf(y, m, dd);
  const { data: info, reload } = useApi<Info>(`/api/date/${index}`, 12000);
  const { data: season } = useApi<Season>("/api/season", 20000);
  const { send, busy } = useSend();
  const [gift, setGift] = useState(false);
  const [to, setTo] = useState("");
  const toOk = useMemo(() => { try { Address.parse(to.trim()); return true; } catch { return false; } }, [to]);
  const years = useMemo(() => Array.from({ length: 100 }, (_, i) => 2049 - i), []);
  const fresh = info && info.index === index;

  async function buy() {
    if (!season?.minter || info?.price == null) return;
    if (await send([buyMsg(season.minter, index, info.price, gift && toOk ? to.trim() : undefined)], t("date.sent"))) reload();
  }

  return (
    <>
      <Top />
      <div className="card">
        <h3>{t("date.title")}</h3>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={dd} onChange={(e) => setD(Number(e.target.value))}>{Array.from({ length: maxD }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
          <select value={m} onChange={(e) => setM(Number(e.target.value))}>{monthNames.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
          <select value={y} onChange={(e) => setY(Number(e.target.value))}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <img src={`/api/img/${index}.svg${fresh ? `?t=${info!.tier}` : ""}`} alt="" style={{ width: "70%", maxWidth: 280, borderRadius: 24 }} />
        <h2 style={{ margin: "12px 0 6px" }}>{dateLabel(y, m, dd)}</h2>
        {fresh && <TierBadge tier={info!.tier} />}
        {!fresh && <p className="muted">…</p>}
        {fresh && (
          <div style={{ marginTop: 14 }}>
            {!info!.inSeason && <p className="muted">{t("date.notSeason")}</p>}
            {info!.inSeason && info!.reserved && !info!.taken && <p className="muted">{t("date.inBox")}</p>}
            {info!.taken && (
              <>
                <p className="bad"><b>{t("date.taken")}</b></p>
                <p className="muted">{t("date.owner")}: <span className="mono">{info!.owner ? short(info!.owner) : "—"}</span></p>
                <Link className="btn ghost" href={`/token/${index}`}>{t("date.view")}</Link>
              </>
            )}
            {info!.inSeason && !info!.taken && !info!.reserved && info!.tier < 2 && (
              <>
                <div className="big">{ton(info!.price)}</div>
                <p className="muted">{t("date.fees")}</p>
                <div className="gap" style={{ textAlign: "start" }}>
                  <label className="muted"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> {t("gift.toggle")}</label>
                  {gift && <input type="text" dir="ltr" placeholder={t("gift.ph")} value={to} onChange={(e) => setTo(e.target.value)} />}
                  {gift && to && !toOk && <span className="bad">{t("gift.bad")}</span>}
                  <button className="btn gold" disabled={busy || !season?.deployed || season.status !== 1 || (gift && !toOk)} onClick={buy}>{season?.status !== 1 ? t("date.notStarted") : gift ? t("gift.buy") : t("date.buy")}</button>
                </div>
              </>
            )}
            {info!.inSeason && !info!.taken && !info!.reserved && info!.tier === 2 && (
              <>
                <p className="muted">{t("date.mythic")}</p>
                <Link className="btn gold" href="/auctions">{t("date.toAuctions")}</Link>
              </>
            )}
          </div>
        )}
      </div>
      <p className="muted" style={{ textAlign: "center" }}>{t("date.cant")} <Link href="/mystery" style={{ color: "var(--gold)" }}>{t("home.mbtn")}</Link>.</p>
    </>
  );
}
