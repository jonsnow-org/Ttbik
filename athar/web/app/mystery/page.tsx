"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, Top, ton, useApi, useSend } from "@/components/ui";
import { dateLabelAr, ymd } from "@/lib/dates";
import { claimMsg, ticketMsg } from "@/lib/tx";

type Season = { configured: boolean; deployed?: boolean; status?: number; minter?: string; prices?: { ticket: number }; mystery?: { poolSize: number; ticketsSold: number; revealed: boolean; revealAt: number }; pool: { mythic: number; rare: number; common: number } };
type Tickets = { tickets: { ticket: number; claimed: boolean; date: number | null }[] };

function useCountdown(to: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor(to - now / 1000));
  return { s, text: `${Math.floor(s / 86400)}ي ${Math.floor((s % 86400) / 3600)}س ${Math.floor((s % 3600) / 60)}د ${s % 60}ث` };
}

export default function Mystery() {
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
        <h1>صندوق الغموض</h1>
        <p className="muted">تدفع الآن ويُكشف تاريخك لاحقاً في لحظة معلنة. قد يكون عادياً أو نادراً أو أسطورياً.</p>
        <div className="big">{ton(s?.prices?.ticket)}</div>
        <p className="muted">السعر يرتفع مع كل تذكرة ويهبط عندما يهدأ الطلب</p>
        <button className="btn gold" disabled={!open || busy} onClick={async () => { if (s?.minter && s.prices && (await send([ticketMsg(s.minter, s.prices.ticket)], "تم إرسال طلب التذكرة."))) reload(); }}>{open ? "اشترِ تذكرة" : my?.revealed ? "تم الكشف" : "غير متاح الآن"}</button>
        {my && my.poolSize > 0 && <div style={{ marginTop: 14 }}><Bar value={my.ticketsSold / my.poolSize} /><p className="muted">{my.ticketsSold} من {my.poolSize} تذكرة</p></div>}
        {my && my.poolSize > 0 && !my.revealed && <p className="note">الكشف بعد: <b>{cd.text}</b></p>}
      </div>

      <div className="card">
        <h3>الاحتمالات (علنية)</h3>
        <div className="kv"><span>أسطوري</span><span>{s?.pool.mythic ?? 0} ({pct(s?.pool.mythic ?? 0)}%)</span></div>
        <div className="kv"><span>نادر</span><span>{s?.pool.rare ?? 0} ({pct(s?.pool.rare ?? 0)}%)</span></div>
        <div className="kv"><span>عادي</span><span>{s?.pool.common ?? 0} ({pct(s?.pool.common ?? 0)}%)</span></div>
        <p className="muted">قائمة التواريخ المخصصة للصناديق منشورة. <a href="/api/pool" target="_blank" style={{ color: "var(--gold)" }}>اطّلع عليها</a>. عند الكشف تُخلط بعشوائية لا يعرفها أحد مسبقاً، بما في ذلك نحن. وإن تأخرنا في الكشف، يستطيع أي شخص إجراءه بعد 3 أيام.</p>
        <p className="muted">ملاحظة: تذكرة الغموض ليست ضماناً لقيمة معينة. اشترِ فقط ما أنت مستعد لخسارة قيمته.</p>
      </div>

      <div className="card">
        <h3>تذاكري</h3>
        {!address && <p className="muted">اربط محفظتك لعرض تذاكرك.</p>}
        {address && tk && tk.tickets.length === 0 && <p className="muted">لا تذاكر بعد.</p>}
        {tk?.tickets.map((t) => (
          <div key={t.ticket} className="kv" style={{ alignItems: "center" }}>
            <span>تذكرة #{t.ticket + 1}</span>
            {t.date == null ? <span className="badge">مختومة</span> : t.claimed ? <Link href={`/token/${t.date}`} style={{ color: "var(--gold)" }}>{(() => { const { y, m, d } = ymd(t.date); return dateLabelAr(y, m, d); })()}</Link> :
              <button className="btn sm gold" disabled={busy} onClick={async () => { if (s?.minter && (await send([claimMsg(s.minter, t.ticket)], "تم إرسال طلب الاستلام."))) reload(); }}>استلم {(() => { const { y, m, d } = ymd(t.date!); return dateLabelAr(y, m, d); })()}</button>}
          </div>
        ))}
      </div>
    </>
  );
}
