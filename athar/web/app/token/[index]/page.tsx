"use client";
import { useState } from "react";
import { Top, TierBadge, useApi, useSend } from "@/components/ui";
import { stageOf, ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { engraveMsg, eq, short } from "@/lib/tx";

type Tok = { index: number; address: string; owner: string; season: number; tier: number; paid: number; mintedAt: number; lastTransferAt: number; hands: number; locked: boolean; engravings: { owner: string; at: number; text: string }[] };

export default function Token({ params }: { params: { index: string } }) {
  const index = Number(params.index);
  const { data: t, reload } = useApi<Tok & { error?: string }>(`/api/token/${index}`, 15000);
  const { t: tr, dateLabel, lang } = useI18n();
  const { send, busy, address } = useSend();
  const [text, setText] = useState("");
  const { y, m, d } = ymd(index);
  if (!t) return <><Top /><p className="muted">…</p></>;
  if (t.error) return <><Top /><div className="card"><h3>{dateLabel(y, m, d)}</h3><p className="muted">{tr("tok.notMinted")}</p></div></>;
  const mine = !!address && eq(address, t.owner);
  const stage = stageOf(t.lastTransferAt);
  const q = `?s=${t.season}&g=${stage}&h=${t.hands}&e=${t.engravings.length}&t=${t.tier}`;
  const share = () => {
    const url = `${location.origin}/token/${index}`;
    const tg = (window as any).Telegram?.WebApp;
    const msg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(tr("tok.shareText", { d: dateLabel(y, m, d) }))}`;
    tg?.openTelegramLink ? tg.openTelegramLink(msg) : window.open(msg, "_blank");
  };
  return (
    <>
      <Top />
      <div className="card" style={{ textAlign: "center" }}>
        <img src={`/api/img/${index}.svg${q}`} alt="" style={{ width: "78%", maxWidth: 300, borderRadius: 26 }} />
        <h2 style={{ margin: "12px 0 6px" }}>{dateLabel(y, m, d)}</h2>
        <TierBadge tier={t.tier} /> <span className="badge">{tr(`stage.${stage}` as "stage.0")}</span>
        <div className="row" style={{ marginTop: 14 }}><button className="btn ghost" onClick={share}>{tr("tok.share")}</button>{mine && <span className="badge t1">{tr("tok.yours")}</span>}</div>
      </div>
      <div className="card">
        <div className="kv"><span>{tr("tok.owner")}</span><span className="mono">{short(t.owner)}</span></div>
        <div className="kv"><span>{tr("tok.hands")}</span><span>{t.hands}</span></div>
        <div className="kv"><span>{tr("tok.season")}</span><span>{t.season}</span></div>
        <div className="kv"><span>{tr("tok.paid")}</span><span>{t.paid.toFixed(2)} TON</span></div>
        <div className="kv"><span>{tr("tok.minted")}</span><span>{new Date(t.mintedAt * 1000).toLocaleDateString(lang)}</span></div>
        <div className="kv"><span>{tr("tok.since")}</span><span>{tr("tok.days", { n: Math.floor((Date.now() / 1000 - t.lastTransferAt) / 86400) })}</span></div>
      </div>
      <div className="card">
        <h3>{tr("tok.memory")}</h3>
        {t.engravings.length === 0 && <p className="muted">{tr("tok.noEngr")}</p>}
        {t.engravings.map((n, i) => (
          <div className="note" key={i}><div>{n.text}</div><div className="muted mono">{short(n.owner)} · {new Date(n.at * 1000).toLocaleDateString(lang)}</div></div>
        ))}
        {mine && (
          <div className="gap" style={{ marginTop: 10 }}>
            <input type="text" maxLength={32} placeholder={tr("tok.engrPh")} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" disabled={busy || !text.trim() || new TextEncoder().encode(text).length > 32} onClick={async () => { if (await send([engraveMsg(t.address, text.trim())], tr("tok.engrSent"))) { setText(""); reload(); } }}>{tr("tok.engrBtn")}</button>
            <p className="muted">{tr("tok.engrHelp")}</p>
          </div>
        )}
      </div>
    </>
  );
}
