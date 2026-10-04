"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Top, ton, useApi, useSend } from "@/components/ui";
import { dateLabelAr, ymd } from "@/lib/dates";
import { bidMsg, settleMsg, short } from "@/lib/tx";

type A = { index: number; taken: boolean; auction: null | { live: boolean; endAt: number; reserve: number; highBid: number; highBidder: string | null } };
type Season = { minter?: string };

function Card({ a, minter, onDone }: { a: A; minter?: string; onDone: () => void }) {
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
      <div className="row between"><h3>{dateLabelAr(y, m, d)}</h3><span className="badge t2">أسطوري</span></div>
      <img src={`/api/img/${a.index}.svg?t=2`} alt="" style={{ width: "60%", maxWidth: 220, display: "block", margin: "8px auto", borderRadius: 20 }} />
      <div className="kv"><span>{au.highBidder ? "أعلى عرض" : "السعر الابتدائي"}</span><span>{ton(au.highBidder ? au.highBid : au.reserve)}</span></div>
      {au.highBidder && <div className="kv"><span>صاحب العرض</span><span className="mono">{short(au.highBidder)}</span></div>}
      <div className="kv"><span>ينتهي بعد</span><span>{left > 0 ? `${Math.floor(left / 3600)}س ${Math.floor((left % 3600) / 60)}د ${left % 60}ث` : "انتهى"}</span></div>
      {left > 0 ? (
        <div className="gap" style={{ marginTop: 10 }}>
          <input type="number" step="0.1" min={min} value={bid} onChange={(e) => setBid(e.target.value)} />
          <button className="btn gold" disabled={busy || Number(bid) < min} onClick={async () => { if (minter && (await send([bidMsg(minter, a.index, Number(bid))], "تم إرسال عرضك."))) onDone(); }}>قدّم عرضاً</button>
          <p className="muted">إن تجاوزك أحد يُعاد مبلغك تلقائياً. وأي عرض في آخر 5 دقائق يمدّد المزاد 5 دقائق.</p>
        </div>
      ) : (
        <button className="btn" disabled={busy} style={{ marginTop: 10 }} onClick={async () => { if (minter && (await send([settleMsg(minter, a.index)], "تم إرسال طلب إنهاء المزاد."))) onDone(); }}>إنهاء المزاد (يتسلم الفائز رمزه)</button>
      )}
    </div>
  );
}

export default function Auctions() {
  const { data, reload } = useApi<{ auctions: A[]; total: number }>("/api/auctions", 15000);
  const { data: s } = useApi<Season>("/api/season", 60000);
  const live = data?.auctions.filter((a) => a.auction) ?? [];
  return (
    <>
      <Top />
      <h2 style={{ margin: "6px 0" }}>المزادات الأسطورية</h2>
      <p className="muted">التواريخ الأسطورية (المتناظرة، والتواريخ التاريخية الكبرى) تُباع بالمزاد: السعر يحدده من يرغب فيها أكثر.</p>
      {data && live.length === 0 && <div className="card"><p className="muted">لا مزادات جارية الآن ({data.total} تاريخاً أسطورياً في الموسم). ستُعلن المزادات تباعاً.</p><Link className="btn ghost" href="/date">ابحث عن تاريخ</Link></div>}
      {live.map((a) => <Card key={a.index} a={a} minter={s?.minter} onDone={reload} />)}
    </>
  );
}
