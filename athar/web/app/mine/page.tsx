"use client";
import Link from "next/link";
import { useTonAddress } from "@tonconnect/ui-react";
import { Top, useApi } from "@/components/ui";
import { ymd } from "@/lib/dates";
import { useI18n } from "@/lib/i18n";

export default function Mine() {
  const { t, dateLabel } = useI18n();
  const address = useTonAddress();
  const { data } = useApi<{ tokens: number[] }>(address ? `/api/me?address=${encodeURIComponent(address)}` : null, 20000);
  return (
    <>
      <Top />
      <h2 style={{ margin: "6px 0" }}>{t("mine.title")}</h2>
      {!address && <div className="card"><p className="muted">{t("mine.connect")}</p></div>}
      {address && data && data.tokens.length === 0 && <div className="card"><p className="muted">{t("mine.none")}</p><Link className="btn gold" href="/date">{t("home.cta")}</Link></div>}
      <div className="grid">
        {data?.tokens.map((i) => { const { y, m, d } = ymd(i); return (
          <Link key={i} href={`/token/${i}`} className="card tok"><img src={`/api/img/${i}.svg?live=1`} alt="" /><div>{dateLabel(y, m, d)}</div></Link>
        ); })}
      </div>
    </>
  );
}
