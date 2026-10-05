"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Address } from "@ton/core";
import { Top, TierBadge, ton, useApi, useSend } from "@/components/ui";
import { indexOf, TOTAL_DATES, ymd } from "@/lib/dates";
import { eventEnOf } from "@/lib/specialNames";
import { useI18n } from "@/lib/i18n";
import { buyMsg, short } from "@/lib/tx";
import { arweaveId } from "@/lib/ids";
import { persistPicture } from "@/lib/mediaFlow";
import MediaPicker, { MediaState } from "@/components/MediaPicker";
import Born from "@/components/Born";
import Features from "@/components/Features";
import { eventOf, hijriLabel, tierSupply } from "@/lib/meta";
import { useConfirmPreview } from "@/components/ConfirmPreview";
import { useToast } from "@/components/ui";

type Info = { index: number; tier: number; inSeason: boolean; reserved: boolean; taken: boolean; owner: string | null; price: number | null; special?: boolean; auction: null | { live: boolean; endAt: number; highBid: number; reserve: number; mediaRef?: string } };
type Season = { fromYear?: number; toYear?: number; specials?: number; configured: boolean; minter?: string; deployed?: boolean; status?: number; fees?: { photo: number; silver: number } };

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export default function DatePage() {
  const { t, dateLabel, monthNames, lang } = useI18n();
  const [y, setY] = useState(2003), [m, setM] = useState(3), [d, setD] = useState(14);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("i");
    if (q) { const i = Number(q); if (i >= 0 && i < TOTAL_DATES) { const t = ymd(i); setY(t.y); setM(t.m); setD(t.d); } }
  }, []);
  const maxD = daysIn(y, m);
  const dd = Math.min(d, maxD);
  const index = indexOf(y, m, dd);
  const { data: info, reload } = useApi<Info>(`/api/date/${index}`, 12000);
  const { data: season } = useApi<Season>("/api/season", 20000);
  const { send, busy } = useSend();
  const toast = useToast();
  const { confirm, node: previewNode } = useConfirmPreview();
  const [media, setMedia] = useState<MediaState>({ occasion: 0, photo: null });
  const [showMedia, setShowMedia] = useState(false);
  const [storing, setStoring] = useState(false);
  const [gift, setGift] = useState(false);
  const [wantN, setWantN] = useState<number | null>(null), [wantTg, setWantTg] = useState(""), [wantDone, setWantDone] = useState(false);
  const [to, setTo] = useState("");
  const toOk = useMemo(() => { try { Address.parse(to.trim()); return true; } catch { return false; } }, [to]);
  const years = useMemo(() => Array.from({ length: 100 }, (_, i) => 2049 - i), []);
  const fresh = info && info.index === index;
  const outside = !!fresh && !info!.inSeason;
  useEffect(() => {
    setWantDone(false); setWantN(null);
    if (!outside) return;
    try { if (JSON.parse(localStorage.getItem("athar_want") || "[]").includes(index)) setWantDone(true); } catch { /* private mode */ }
    fetch(`/api/waitlist?index=${index}`).then((r) => r.json()).then((j) => setWantN(typeof j.n === "number" ? j.n : null)).catch(() => undefined);
  }, [outside, index]);
  async function want() {
    try {
      const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ index, contact: wantTg }) });
      const j = await r.json(); if (!r.ok) return;
      setWantN(j.n); setWantDone(true); toast(t("date.wantDone"));
      try { const a = JSON.parse(localStorage.getItem("athar_want") || "[]"); a.push(index); localStorage.setItem("athar_want", JSON.stringify(a)); } catch { /* private mode */ }
    } catch { /* offline: the button stays */ }
  }

  const style = media.photo ? (media.style === "silver" ? 2 : 1) : 0;
  const extra = style === 1 ? season?.fees?.photo ?? 0 : style === 2 ? season?.fees?.silver ?? 0 : 0;

  async function buy() {
    if (!season?.minter || info?.price == null) return;
    // The picture is made safe BEFORE the purchase, so the token is born holding its final id (see lib/mediaFlow).
    //   stored  -> normal purchase
    //   queued  -> purchase as usual, fees included: the token shows its default picture until the file is confirmed, by itself
    //   failed  -> only if even our server is unreachable: nothing is bought (the picture is mandatory), nothing is charged
    let ref = 0n;
    const buyStyle = style, buyExtra = extra;
    // The picture is part of the token: saving it for good is always done, never optional.
    setStoring(true);
    try {
      const kind = media.photo ? "photo" : "snapshot";
      const body = { index, kind, occasion: media.occasion, photo: media.photo };
      const pr = await fetch("/api/media/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, preview: true }) });
      const pj = await pr.json();
      if (!pr.ok) { toast(pj.error || t("media.fail")); setStoring(false); return; }
      if (!(await confirm(pj.svg, pj.notes || []))) { setStoring(false); return; }      // the user must approve the exact final picture
      toast(t("media.saving"));
      const p = await persistPicture(pj.svg);
      if (p.state === "failed") { toast(t("media.mustSave")); setStoring(false); return; }   // nothing is bought without its picture saved
      ref = p.ref; if (p.state === "queued") toast(t("media.queued"));
    } catch { toast(t("media.fail")); setStoring(false); return; }
    setStoring(false);
    if (await send([buyMsg(season.minter, index, info.price, gift && toOk ? to.trim() : undefined, media.occasion, ref, buyStyle, buyExtra)], t("date.sent"))) reload();
  }

  return (
    <>
      <Top />
      <div className="card">
        <h3>{t("date.title")}</h3>
        {season?.fromYear && <p className="muted" style={{ margin: "6px 0 0" }}>{t("date.coverage", { a: season.fromYear, b: season.toYear ?? 0, s: season.specials ?? 0 })}</p>}
        {season?.fromYear && (
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
            {Array.from({ length: (season.toYear ?? 0) - season.fromYear + 1 }, (_, k) => season.fromYear! + k).map((v) => (
              <button key={v} type="button" className={`btn sm ${y === v ? "" : "ghost"}`} onClick={() => setY(v)}>{v}</button>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <select value={dd} onChange={(e) => setD(Number(e.target.value))}>{Array.from({ length: maxD }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
          <select value={m} onChange={(e) => setM(Number(e.target.value))}>{monthNames.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
          <select value={y} onChange={(e) => setY(Number(e.target.value))}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <img src={`/api/img/${index}.svg?live=1${fresh ? `&t=${info!.tier}` : ""}`} alt="" style={{ width: "70%", maxWidth: 280, borderRadius: 24 }} />
        <h2 style={{ margin: "12px 0 6px" }}>{dateLabel(y, m, dd)}</h2>
        <div className="muted" style={{ marginBottom: 6 }}>🌙 {t("tok.hijri", { h: hijriLabel(index, lang) })}</div>
        {fresh && <TierBadge tier={info!.tier} />}
        {!fresh && <p className="muted">…</p>}
        {fresh && (
          <div style={{ marginTop: 14 }}>
            {!info!.inSeason && (
              <>
                <p className="muted">{t("date.notSeason")}</p>
                <p className="muted" style={{ fontSize: 13 }}>{t("date.wantHint")}</p>
                {!wantDone && <input type="text" dir="ltr" placeholder={t("date.wantTg")} value={wantTg} onChange={(e) => setWantTg(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />}
                <button className="btn gold" disabled={wantDone} onClick={want}>{wantDone ? `✓ ${t("date.wantDone")}` : t("date.want")}</button>
                {wantN != null && wantN > 0 && <p className="muted" style={{ marginTop: 8 }}>{t("date.wantCount", { n: wantN })}</p>}
              </>
            )}
            {info!.inSeason && info!.reserved && !info!.taken && <p className="muted">{t("date.inBox")}</p>}
            {info!.taken && (
              <>
                <p className="bad"><b>{t("date.taken")}</b></p>
                <p className="muted">{t("date.owner")}: <span className="mono">{info!.owner ? short(info!.owner) : "—"}</span></p>
                <Link className="btn ghost" href={`/token/${index}`}>{t("date.view")}</Link>
              </>
            )}
            {info!.inSeason && !info!.taken && !info!.reserved && info!.tier < 2 && !info!.special && (
              <>
                <div className="big">{ton((info!.price ?? 0) + extra)}</div>
                {extra > 0 && <p className="muted">{t("date.incl", { base: ton(info!.price), extra: ton(extra) })}</p>}
                <p className="muted">{t("date.fees")}</p>
                <div className="gap" style={{ textAlign: "start" }}>
                  <label className="muted"><input type="checkbox" checked={showMedia} onChange={(e) => setShowMedia(e.target.checked)} /> {t("media.title")}</label>
                  {showMedia && <MediaPicker index={index} tier={info!.tier} season={1} value={media} onChange={setMedia} fees={season?.fees} />}
                  <p className="muted">🔒 {t("media.always")}</p>
                  <label className="muted"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> {t("gift.toggle")}</label>
                  {gift && <input type="text" dir="ltr" placeholder={t("gift.ph")} value={to} onChange={(e) => setTo(e.target.value)} />}
                  {gift && to && !toOk && <span className="bad">{t("gift.bad")}</span>}
                  <button className="btn gold" disabled={busy || storing || !season?.deployed || season.status !== 1 || (gift && !toOk)} onClick={buy}>{season?.status !== 1 ? t("date.notStarted") : gift ? t("gift.buy") : t("date.buy")}</button>
                </div>
              </>
            )}
            {info!.inSeason && !info!.taken && !info!.reserved && (info!.tier === 2 || info!.special) && (
              <>
                {info!.auction?.mediaRef && info!.auction.mediaRef !== "0" && <img src={`https://turbo-gateway.com/${arweaveId(BigInt(info!.auction.mediaRef))}`} alt="" style={{ width: "100%", maxWidth: 300, borderRadius: 24, margin: "0 auto 10px", display: "block" }} />}
                <p className="muted">{info!.special ? t("date.special") : t("date.mythic")}</p>
                <Link className="btn gold" href="/auctions">{t("date.toAuctions")}</Link>
              </>
            )}
          </div>
        )}
      </div>
      <Features supply={info?.tier != null ? tierSupply(1)[info.tier] : undefined} event={eventOf(index)} eventEn={eventEnOf(y, m, dd)} />
      <Born index={index} />
      {previewNode}
      <p className="muted" style={{ textAlign: "center" }}>{t("date.cant")} <Link href="/mystery" style={{ color: "var(--gold)" }}>{t("home.mbtn")}</Link>.</p>
    </>
  );
}
