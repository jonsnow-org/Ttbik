"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Address } from "@ton/core";
import { Top, KindBadge, ton, useApi, useSend, WalletTip } from "@/components/ui";
import { indexOf, TOTAL_DATES, ymd } from "@/lib/dates";
import { eventEnOf } from "@/lib/specialNames";
import { useI18n } from "@/lib/i18n";
import { buyMsg } from "@/lib/tx";
import { persistPicture } from "@/lib/mediaFlow";
import MediaPicker, { MediaState } from "@/components/MediaPicker";
import Born from "@/components/Born";
import Features from "@/components/Features";
import { eventOf, hijriLabel, kindSupply } from "@/lib/meta";
import { useConfirmPreview } from "@/components/ConfirmPreview";
import { useToast } from "@/components/ui";
import { CLASS_KINDS, DIRECT_KINDS, idOf, ID_SHIFT } from "@/lib/kinds";
import { premiumOf } from "@/lib/seasons";

// One date in all its kinds (see lib/kinds.ts): taken[k] / auction[k] / reserved[k] by kind, and the price of the three direct kinds now.
type Info = { date: number; special: boolean; onChain: boolean; taken: boolean[]; auction: boolean[]; reserved: boolean[]; prices: (number | null)[] };
type KindRow = { kind: number; price: number | null; cap: number; issued: number; photoFee: number; specialFee: number; walletMax: number };
type Season = { specials?: number; configured: boolean; minter?: string; deployed?: boolean; status?: number; kinds?: KindRow[] };

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export default function DateClient() {
  const { t, dateLabel, monthNames, lang } = useI18n();
  const [y, setY] = useState(2003), [m, setM] = useState(3), [d, setD] = useState(14);
  const [kind, setKind] = useState<number>(0);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const i = q.get("i");
    if (i) { const n = Number(i) % ID_SHIFT; if (n >= 0 && n < TOTAL_DATES) { const x = ymd(n); setY(x.y); setM(x.m); setD(x.d); } }
    const k = Number(q.get("k")); if (Number.isInteger(k) && k >= 0 && k <= 2) setKind(k);
  }, []);
  const maxD = daysIn(y, m);
  const dd = Math.min(d, maxD);
  const date = indexOf(y, m, dd);
  const id = idOf(kind, date);
  const { data: info, reload } = useApi<Info>(`/api/date/${date}`, 12000);
  const { data: season } = useApi<Season>("/api/season", 20000);
  const { send, busy } = useSend();
  const toast = useToast();
  const { confirm, node: previewNode } = useConfirmPreview();
  const [media, setMedia] = useState<MediaState>({ occasion: 0, photo: null });
  const [showMedia, setShowMedia] = useState(false);
  const [storing, setStoring] = useState(false);
  const [gift, setGift] = useState(false);
  const [to, setTo] = useState("");
  const toOk = useMemo(() => { try { Address.parse(to.trim()); return true; } catch { return false; } }, [to]);
  const years = useMemo(() => Array.from({ length: 100 }, (_, i) => 2049 - i), []);
  const fresh = !!info && info.date === date;
  const row = season?.kinds?.[kind];
  const price = fresh ? info!.prices[kind] : null;
  const takenHere = fresh && info!.taken[kind];
  const soldOut = !!row && row.cap > 0 && row.issued >= row.cap;
  const extra = media.photo ? row?.photoFee ?? 0 : 0;
  const premium = premiumOf(date)[0] > premiumOf(date)[1];

  const shareDate = () => {
    const url = `${location.origin}/date?i=${date}`;
    const tg = (window as any).Telegram?.WebApp;
    const msg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t("date.shareText", { d: dateLabel(y, m, dd) }))}`;
    tg?.openTelegramLink ? tg.openTelegramLink(msg) : window.open(msg, "_blank");
  };

  async function buy() {
    if (!season?.minter || price == null) return;
    // The picture is made safe BEFORE the purchase, so the token is born holding its final id (see lib/mediaFlow).
    //   stored  -> normal purchase
    //   queued  -> purchase as usual, fees included: the token shows its default picture until the file is confirmed, by itself
    //   failed  -> only if even our server is unreachable: nothing is bought (the picture is mandatory), nothing is charged
    let ref = 0n;
    const buyStyle = media.photo ? 1 : 0, buyExtra = extra;
    // A photo is part of the token and saved for good; the generated art is not stored at all (the token keeps drawing it live).
    setStoring(true);
    try {
      const what = media.photo ? "photo" : "snapshot";   // "snapshot" here is only the preview shown for approval; it is not stored
      const body = { id, kind: what, occasion: media.occasion, photo: media.photo };
      const pr = await fetch("/api/media/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, preview: true }) });
      const pj = await pr.json();
      if (!pr.ok) { toast(pj.error || t("media.fail")); setStoring(false); return; }
      if (!(await confirm(pj.svg, pj.notes || [], !media.photo))) { setStoring(false); return; }      // the user must approve the exact final picture
      if (media.photo) {   // only a picture the buyer brought is stored; generated art is never frozen: it stays live (motion, ageing, colours) everywhere
        toast(t("media.saving"));
        const p = await persistPicture(pj.svg);
        if (p.state === "failed") { toast(t("media.mustSave")); setStoring(false); return; }   // nothing is bought without its picture saved
        ref = p.ref; if (p.state === "queued") toast(t("media.queued"));
      }
    } catch { toast(t("media.fail")); setStoring(false); return; }
    setStoring(false);
    if (await send([buyMsg(season.minter, id, price, gift && toOk ? to.trim() : undefined, media.occasion, ref, buyStyle, buyExtra)], t("date.sent"))) reload();
  }

  return (
    <>
      <Top />
      <div className="card">
        <h3>{t("date.title")}</h3>
        <div className="row" style={{ marginTop: 10 }}>
          <select value={dd} onChange={(e) => setD(Number(e.target.value))}>{Array.from({ length: maxD }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
          <select value={m} onChange={(e) => setM(Number(e.target.value))}>{monthNames.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
          <select value={y} onChange={(e) => setY(Number(e.target.value))}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <img src={`/api/img/${id}.svg?live=1`} alt="" style={{ width: "70%", maxWidth: 280, borderRadius: 24 }} />
        <h2 style={{ margin: "12px 0 6px" }}>{dateLabel(y, m, dd)}</h2>
        <button className="btn ghost" onClick={shareDate}>{t("date.share")}</button>
        <div className="muted" style={{ marginBottom: 6 }}>🌙 {t("tok.hijri", { h: hijriLabel(date, lang) })}</div>
        {!fresh && <p className="muted">…</p>}
        {fresh && (
          <>
            {info!.special && <p className="muted">{t("date.special")}</p>}
            {premium && !info!.special && <p className="muted">{t("kind.premium")}</p>}
            <div className="muted" style={{ marginTop: 8 }}>{t("kind.choose")}</div>
            <div className="kinds">
              {DIRECT_KINDS.map((k) => {
                const kr = season?.kinds?.[k];
                const taken = info!.taken[k], out = !!kr && kr.cap > 0 && kr.issued >= kr.cap;
                return (
                  <div key={k} className={`kindcard ${kind === k ? "on" : ""} ${taken || out ? "off" : ""}`} onClick={() => setKind(k)}>
                    <KindBadge kind={k} />
                    <b>{taken ? t("kind.taken") : out ? t("kind.soldout") : ton(info!.prices[k])}</b>
                    {kr && kr.cap > 0 && !taken && <span>{t("kind.left", { n: Math.max(0, kr.cap - kr.issued), c: kr.cap })}</span>}
                  </div>
                );
              })}
            </div>

            {takenHere && (
              <>
                <p className="bad"><b>{t("date.taken")}</b></p>
                <Link className="btn ghost" href={`/token/${id}`}>{t("date.view")}</Link>
              </>
            )}
            {!takenHere && info!.reserved[kind] && <p className="muted">{t("date.inBox")}</p>}
            {!takenHere && !info!.reserved[kind] && (
              <>
                <div className="big">{ton((price ?? 0) + extra)}</div>
                {extra > 0 && <p className="muted">{t("date.incl", { base: ton(price), extra: ton(extra) })}</p>}
                {info!.special && row && row.specialFee > 0 && <p className="muted">{t("kind.special", { p: row.specialFee })}</p>}
                <p className="muted">{t("date.fees")}</p>
                <div className="gap" style={{ textAlign: "start" }}>
                  <label className="muted"><input type="checkbox" checked={showMedia} onChange={(e) => setShowMedia(e.target.checked)} /> {t("media.title")}</label>
                  {showMedia && <MediaPicker index={date} tier={kind} season={1} value={media} onChange={setMedia} fees={row ? { photo: row.photoFee } : undefined} />}
                  <p className="muted">🔒 {t("media.always")}</p>
                  <label className="muted"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> {t("gift.toggle")}</label>
                  {gift && <input type="text" dir="ltr" placeholder={t("gift.ph")} value={to} onChange={(e) => setTo(e.target.value)} />}
                  {gift && to && !toOk && <span className="bad">{t("gift.bad")}</span>}
                  <button className="btn gold" disabled={busy || storing || !season?.deployed || season.status !== 1 || soldOut || price == null || (gift && !toOk)} onClick={buy}>{season?.status !== 1 ? t("date.notStarted") : soldOut ? t("kind.soldout") : gift ? t("gift.buy") : t("date.buy")}</button>
                  <WalletTip />
                </div>
              </>
            )}

            <div className="muted" style={{ marginTop: 18 }}>{t("kind.classes")}</div>
            <div className="gap" style={{ textAlign: "start", marginTop: 6 }}>
              {CLASS_KINDS.map((k) => (
                <div className="kv" key={k}>
                  <span><KindBadge kind={k} /></span>
                  {info!.taken[k] ? <Link href={`/token/${idOf(k, date)}`} style={{ color: "var(--gold)" }}>{t("kind.taken")} ›</Link>
                    : info!.auction[k] ? <Link href="/auctions" style={{ color: "var(--gold)" }}>{t("kind.classAuction")} ›</Link>
                    : <span className="muted">{t("kind.classNone")}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <Features supply={kindSupply(1, kind)} event={eventOf(date)} eventEn={eventEnOf(y, m, dd)} />
      <Born index={date} />
      {previewNode}
      <p className="muted" style={{ textAlign: "center" }}>{t("date.cant")} <Link href="/auctions" style={{ color: "var(--gold)" }}>{t("home.abtn")}</Link>.</p>
    </>
  );
}
