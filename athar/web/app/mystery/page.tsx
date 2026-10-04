"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, Top, ton, useApi, useSend } from "@/components/ui";
import { ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { claimMsg, ticketMsg } from "@/lib/tx";

type Season = { configured: boolean; deployed?: boolean; status?: number; minter?: string; prices?: { ticket: number }; mystery?: { poolSize: number; ticketsSold: number; revealed: boolean; revealAt: number }; pool: { mythic: number; rare: number; common: number } };
type Tickets = { tickets: { ticket: number; claimed: boolean; date: number | null }[] };

function useCountdown(to: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor(to - now / 1000));
  return { s, text: `${Math.floor(s / 86400)}d ${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` };
}

export default function Mystery() {
  const { t, dateLabel } = useI18n();
  const { data: s, reload } = useApi<Season>("/api/season", 10000);
  const { send, busy, address } = useSend();
  const { data: tk } = useApi<Tickets>(address ? `/api/tickets?address=${encodeURIComponent(address)}` : null, 15000);
  const my = s?.mystery;
  const cd = useCountdown(my?.revealAt ?? 0);
  const total = s ? s.pool.mythic + s.pool.rare + s.pool.common : 0;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(n / total < 0.02 ? 1 : 0) : "0");
  const open = !!s?.deployed && s.status === 1 && !!my && my.poolSize > 0 && !my.revealed && cd.s > 0 && my.ticketsSold < my.poolSize;
  return (
    <>
      <Top />
      <div className="card hero">
        <h1>{t("mys.title")}</h1>
        <p className="muted">{t("mys.sub")}</p>
        <div className="big">{ton(s?.prices?.ticket)}</div>
        <p className="muted">{t("mys.pnote")}</p>
        <button className="btn gold" disabled={!open || busy} onClick={async () => { if (s?.minter && s.prices && (await send([ticketMsg(s.minter, s.prices.ticket)], t("mys.sentT")))) reload(); }}>{open ? t("mys.buy") : my?.revealed ? t("mys.revealed") : t("mys.na")}</button>
        {my && my.poolSize > 0 && <div style={{ marginTop: 14 }}><Bar value={my.ticketsSold / my.poolSize} /><p className="muted">{t("mys.tickets", { a: my.ticketsSold, b: my.poolSize })}</p></div>}
        {my && my.poolSize > 0 && !my.revealed && <p className="note">{t("mys.revealIn")} <b>{cd.text}</b></p>}
      </div>

      <div className="card">
        <h3>{t("mys.odds")}</h3>
        <div className="kv"><span>{t("tier.2")}</span><span>{s?.pool.mythic ?? 0} ({pct(s?.pool.mythic ?? 0)}%)</span></div>
        <div className="kv"><span>{t("tier.1")}</span><span>{s?.pool.rare ?? 0} ({pct(s?.pool.rare ?? 0)}%)</span></div>
        <div className="kv"><span>{t("tier.0")}</span><span>{s?.pool.common ?? 0} ({pct(s?.pool.common ?? 0)}%)</span></div>
        <p className="muted">{t("mys.note1")} <a href="/api/pool" target="_blank" style={{ color: "var(--gold)" }}>{t("mys.noteLink")}</a>. {t("mys.note2")}</p>
        <p className="muted">{t("mys.disc")}</p>
      </div>

      <div className="card">
        <h3>{t("mys.mine")}</h3>
        {!address && <p className="muted">{t("mys.connect")}</p>}
        {address && tk && tk.tickets.length === 0 && <p className="muted">{t("mys.noTickets")}</p>}
        {tk?.tickets.map((x) => {
          const lbl = x.date == null ? "" : (() => { const { y, m, d } = ymd(x.date!); return dateLabel(y, m, d); })();
          return (
            <div key={x.ticket} className="kv" style={{ alignItems: "center" }}>
              <span>{t("mys.ticket", { n: x.ticket + 1 })}</span>
              {x.date == null ? <span className="badge">{t("mys.sealed")}</span> : x.claimed ? <Link href={`/token/${x.date}`} style={{ color: "var(--gold)" }}>{lbl}</Link> :
                <button className="btn sm gold" disabled={busy} onClick={async () => { if (s?.minter && (await send([claimMsg(s.minter, x.ticket)], t("mys.sentC")))) reload(); }}>{t("mys.claim", { d: lbl })}</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
