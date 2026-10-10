"use client";
import { useState } from "react";
import { useTonAddress } from "@tonconnect/ui-react";
import { Top, KindBadge, ton, useApi } from "@/components/ui";
import { ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { KINDS } from "@/lib/kinds";
import { NETWORK } from "@/lib/config";

type L = { id: number; kind: number; date: number; address: string; price: number | null; market: string };
type M = { partial?: boolean; collection: string; minted: number; listings: L[]; floor: (number | null)[]; counts: number[] };

const GG = NETWORK === "testnet" ? "https://testnet.getgems.io" : "https://getgems.io";

export default function MarketPage() {
  const { t, dateLabel } = useI18n();
  const { data } = useApi<M>("/api/market", 60000);
  const me = useTonAddress();
  const [kind, setKind] = useState(-1);
  const list = (data?.listings ?? []).filter((l) => kind < 0 || l.kind === kind);
  return (
    <>
      <Top />
      <h2>{t("market.title")}</h2>
      <p className="muted">{t("market.sub")}</p>

      <div className="card">
        <div className="kv"><span>{t("market.minted")}</span><b>{data ? data.minted : "…"}</b></div>
        <div className="kv"><span>{t("market.listed")}</span><b>{data ? data.listings.length : "…"}</b></div>
        {data && (
          <div className="gap" style={{ marginTop: 8 }}>
            {KINDS.filter((k) => data.counts[k.id] > 0).map((k) => (
              <div className="kv" key={k.id}><span><KindBadge kind={k.id} /></span><span>{t("market.floor")}: {ton(data.floor[k.id])} · {data.counts[k.id]}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        <button className={`btn ${kind < 0 ? "gold" : "ghost"}`} onClick={() => setKind(-1)}>{t("market.all")}</button>
        {KINDS.filter((k) => !data || data.counts[k.id] > 0).map((k) => (
          <button key={k.id} className={`btn ${kind === k.id ? "gold" : "ghost"}`} onClick={() => setKind(k.id)}>{t(`kind.${k.id}` as "kind.0")}</button>
        ))}
      </div>

      {data && list.length === 0 && <div className="card"><p className="muted">{t("market.none")}</p></div>}
      {list.map((l) => {
        const { y, m, d } = ymd(l.date);
        return (
          <div className="card" key={l.id} style={{ textAlign: "center" }}>
            <div className="row between"><h3>{dateLabel(y, m, d)}</h3><KindBadge kind={l.kind} /></div>
            <img src={`/api/img/${l.id}.svg?live=1`} alt="" style={{ width: "60%", maxWidth: 220, borderRadius: 20, margin: "8px auto", display: "block" }} />
            <div className="big">{l.price != null ? ton(l.price) : t("market.auction")}</div>
            <a className="btn gold" href={`${GG}/nft/${l.address}`} target="_blank" rel="noopener noreferrer">{l.price != null ? t("market.buy") : t("market.bid")}</a>
          </div>
        );
      })}

      <div className="card">
        <h3>{t("market.sellTitle")}</h3>
        <p className="muted">{t("market.sellDesc")}</p>
        <div className="gap">
          {me && <a className="btn gold" href={`${GG}/user/${me}`} target="_blank" rel="noopener noreferrer">{t("market.sell")}</a>}
          {data && <a className="btn ghost" href={`${GG}/collection/${data.collection}`} target="_blank" rel="noopener noreferrer">{t("market.all2")}</a>}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>{t("market.note")}</p>
      </div>
    </>
  );
}
