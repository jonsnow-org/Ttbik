"use client";
import Link from "next/link";
import { useTonAddress } from "@tonconnect/ui-react";
import { Top, useApi } from "@/components/ui";
import { ruleTier, ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";
import { PERKS } from "@/lib/perks";

export default function Mine() {
  const { t, dateLabel, lang } = useI18n();
  const address = useTonAddress();
  const { data } = useApi<{ tokens: number[] }>(address ? `/api/me?address=${encodeURIComponent(address)}` : null, 20000);
  const rare = (data?.tokens ?? []).filter((i) => ruleTier(i) === 1).length, mythic = (data?.tokens ?? []).filter((i) => ruleTier(i) === 2).length;
  const h = { count: data?.tokens.length ?? 0, rare, mythic };
  const unlocked = PERKS.filter((p) => p.need(h));
  return (
    <>
      <Top />
      <h2 style={{ margin: "6px 0" }}>{t("mine.title")}</h2>
      {!address && <div className="card"><p className="muted">{t("mine.connect")}</p></div>}
      {address && data && data.tokens.length === 0 && <div className="card"><p className="muted">{t("mine.none")}</p><Link className="btn gold" href="/date">{t("home.cta")}</Link></div>}
      {data?.tokens.filter((i) => { const x = ymd(i); const n = new Date(); return x.m === n.getMonth() + 1 && x.d === n.getDate(); }).map((i) => { const x = ymd(i); return <div className="card" key={`a${i}`} style={{ borderColor: "var(--gold)" }}><b>{t("mine.anniv", { d: dateLabel(x.y, x.m, x.d) })}</b></div>; })}
      {unlocked.length > 0 && <div className="card"><h3>{t("perks.title")}</h3>{unlocked.map((p) => <div className="kv" key={p.id}><span>✓ {lang === "ar" ? p.ar : p.en}</span></div>)}</div>}
      <div className="grid">
        {data?.tokens.map((i) => { const { y, m, d } = ymd(i); return (
          <Link key={i} href={`/token/${i}`} className="card tok"><img src={`/api/live/${i}.svg`} alt="" /><div>{dateLabel(y, m, d)}</div></Link>
        ); })}
      </div>
    </>
  );
}
