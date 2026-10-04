"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Top, ton, useApi, useSend } from "@/components/ui";
import { ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { bidMsg, settleMsg, short } from "@/lib/tx";

type A = { index: number; taken: boolean; auction: null | { live: boolean; endAt: number; reserve: number; highBid: number; highBidder: string | null } };
type Season = { minter?: string };

function Card({ a, minter, onDone }: { a: A; minter?: string; onDone: () => void }) {
  const { t, dateLabel } = useI18n();
  const au = a.auction!;
  const { y, m, d } = ymd(a.index);
  const min = au.highBidder ? au.highBid * 1.05 + 0.001 : au.reserve;
  const [bid, setBid] = useState(String(Math.ceil(min * 100) / 100));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, au.endAt - Math.floor(now / 1000));
  const { send, busy } = useSend();
  return (
    <div className="card">
      <div className="row between"><h3>{dateLabel(y, m, d)}</h3><span className="badge t2">{t("tier.2")}</span></div>
      <img src={`/api/img/${a.index}.svg?t=2`} alt="" style={{ width: "60%", maxWidth: 220, display: "block", margin: "8px auto", borderRadius: 20 }} />
      <div className="kv"><span>{au.highBidder ? t("auc.high") : t("auc.reserve")}</span><span>{ton(au.highBidder ? au.highBid : au.reserve)}</span></div>
      {au.highBidder && <div className="kv"><span>{t("auc.bidder")}</span><span className="mono">{short(au.highBidder)}</span></div>}
      <div className="kv"><span>{t("auc.endsIn")}</span><span>{left > 0 ? `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}` : t("auc.ended")}</span></div>
      {left > 0 ? (
        <div className="gap" style={{ marginTop: 10 }}>
          <input type="number" step="0.1" min={min} value={bid} onChange={(e) => setBid(e.target.value)} />
          <button className="btn gold" disabled={busy || Number(bid) < min} onClick={async () => { if (minter && (await send([bidMsg(minter, a.index, Number(bid))], t("auc.sentB")))) onDone(); }}>{t("auc.bid")}</button>
          <p className="muted">{t("auc.bidNote")}</p>
        </div>
      ) : (
        <button className="btn" disabled={busy} style={{ marginTop: 10 }} onClick={async () => { if (minter && (await send([settleMsg(minter, a.index)], t("auc.sentS")))) onDone(); }}>{t("auc.settle")}</button>
      )}
    </div>
  );
}

export default function Auctions() {
  const { t } = useI18n();
  const { data, reload } = useApi<{ auctions: A[]; total: number }>("/api/auctions", 15000);
  const { data: s } = useApi<Season>("/api/season", 60000);
  const live = data?.auctions.filter((a) => a.auction) ?? [];
  return (
    <>
      <Top />
      <h2 style={{ margin: "6px 0" }}>{t("auc.title")}</h2>
      <p className="muted">{t("auc.intro")}</p>
      {data && live.length === 0 && <div className="card"><p className="muted">{t("auc.none", { n: data.total })}</p><Link className="btn ghost" href="/date">{t("home.cta")}</Link></div>}
      {live.map((a) => <Card key={a.index} a={a} minter={s?.minter} onDone={reload} />)}
    </>
  );
}
