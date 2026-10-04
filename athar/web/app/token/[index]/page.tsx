"use client";
import { useState } from "react";
import { Top, TierBadge, useApi, useSend } from "@/components/ui";
import { dateLabelAr, stageOf, STAGE_NAME_AR, ymd } from "@/lib/dates";
import { engraveMsg, eq, short } from "@/lib/tx";

type Tok = { index: number; address: string; owner: string; season: number; tier: number; paid: number; mintedAt: number; lastTransferAt: number; hands: number; locked: boolean; engravings: { owner: string; at: number; text: string }[] };

export default function Token({ params }: { params: { index: string } }) {
  const index = Number(params.index);
  const { data: t, reload } = useApi<Tok & { error?: string }>(`/api/token/${index}`, 15000);
  const { send, busy, address } = useSend();
  const [text, setText] = useState("");
  const { y, m, d } = ymd(index);
  if (!t) return <><Top /><p className="muted">…</p></>;
  if (t.error) return <><Top /><div className="card"><h3>{dateLabelAr(y, m, d)}</h3><p className="muted">هذا الرمز لم يُصكّ بعد.</p></div></>;
  const mine = !!address && eq(address, t.owner);
  const stage = stageOf(t.lastTransferAt);
  const q = `?s=${t.season}&g=${stage}&h=${t.hands}&e=${t.engravings.length}&t=${t.tier}`;
  const share = () => {
    const url = `${location.origin}/token/${index}`;
    const tg = (window as any).Telegram?.WebApp;
    const msg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`أثري: ${dateLabelAr(y, m, d)}`)}`;
    tg?.openTelegramLink ? tg.openTelegramLink(msg) : window.open(msg, "_blank");
  };
  return (
    <>
      <Top />
      <div className="card" style={{ textAlign: "center" }}>
        <img src={`/api/img/${index}.svg${q}`} alt="" style={{ width: "78%", maxWidth: 300, borderRadius: 26 }} />
        <h2 style={{ margin: "12px 0 6px" }}>{dateLabelAr(y, m, d)}</h2>
        <TierBadge tier={t.tier} /> <span className="badge">{STAGE_NAME_AR[stage]}</span>
        <div className="row" style={{ marginTop: 14 }}><button className="btn ghost" onClick={share}>شارك</button>{mine && <span className="badge t1">هذا رمزك</span>}</div>
      </div>
      <div className="card">
        <div className="kv"><span>المالك الحالي</span><span className="mono">{short(t.owner)}</span></div>
        <div className="kv"><span>عدد الأيادي</span><span>{t.hands}</span></div>
        <div className="kv"><span>الموسم</span><span>{t.season}</span></div>
        <div className="kv"><span>سعر الصك الأول</span><span>{t.paid.toFixed(2)} TON</span></div>
        <div className="kv"><span>صُكّ في</span><span>{new Date(t.mintedAt * 1000).toLocaleDateString("ar")}</span></div>
        <div className="kv"><span>منذ آخر نقل</span><span>{Math.floor((Date.now() / 1000 - t.lastTransferAt) / 86400)} يوماً</span></div>
      </div>
      <div className="card">
        <h3>ذاكرة الرمز</h3>
        {t.engravings.length === 0 && <p className="muted">لا نقوش بعد. أول من يكتب يترك أثره الأول.</p>}
        {t.engravings.map((n, i) => (
          <div className="note" key={i}><div>{n.text}</div><div className="muted mono">{short(n.owner)} · {new Date(n.at * 1000).toLocaleDateString("ar")}</div></div>
        ))}
        {mine && (
          <div className="gap" style={{ marginTop: 10 }}>
            <input type="text" maxLength={32} placeholder="اكتب سطراً (حتى 32 حرفاً إنجليزياً أو 16 عربياً)" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" disabled={busy || !text.trim() || new TextEncoder().encode(text).length > 32} onClick={async () => { if (await send([engraveMsg(t.address, text.trim())], "تم إرسال النقش.")) { setText(""); reload(); } }}>انقش (0.1 TON)</button>
            <p className="muted">الحد 32 بايتاً: نحو 16 حرفاً عربياً أو 32 حرفاً لاتينياً. النقش يبقى للأبد ويقرؤه كل من يملك الرمز بعدك.</p>
          </div>
        )}
      </div>
    </>
  );
}
