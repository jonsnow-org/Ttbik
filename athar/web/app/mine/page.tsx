"use client";
import Link from "next/link";
import { useTonAddress } from "@tonconnect/ui-react";
import { Top, useApi } from "@/components/ui";
import { dateLabelAr, ymd } from "@/lib/dates";

export default function Mine() {
  const address = useTonAddress();
  const { data } = useApi<{ tokens: number[] }>(address ? `/api/me?address=${encodeURIComponent(address)}` : null, 20000);
  return (
    <>
      <Top />
      <h2 style={{ margin: "6px 0" }}>رموزي</h2>
      {!address && <div className="card"><p className="muted">اربط محفظتك من الزر في الأعلى لتظهر رموزك.</p></div>}
      {address && data && data.tokens.length === 0 && <div className="card"><p className="muted">لا تملك رموزاً بعد.</p><Link className="btn gold" href="/date">ابحث عن تاريخك</Link></div>}
      <div className="grid">
        {data?.tokens.map((i) => { const { y, m, d } = ymd(i); return (
          <Link key={i} href={`/token/${i}`} className="card tok"><img src={`/api/img/${i}.svg`} alt="" /><div>{dateLabelAr(y, m, d)}</div></Link>
        ); })}
      </div>
    </>
  );
}
