"use client";
import { useRef, useState } from "react";
import { renderArt, renderPhotoArt } from "@/lib/art";
import { OCCASIONS } from "@/lib/occasions";
import { emblem } from "@/lib/occasions";
import { compressPhoto } from "@/lib/photo";
import { waxPhoto } from "@/lib/wax";
import { useI18n } from "@/lib/i18n";

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export type MediaState = { occasion: number; photo: string | null; w?: number; h?: number; raw?: string | null; style?: "plain" | "silver" };

/** Occasion chips + photo chooser + live preview of exactly what the token will look like. */
export default function MediaPicker({ index, tier, season, value, onChange, stage = 0, hands = 1, engravings = 0 }: {
  index: number; tier: number; season: number; value: MediaState; onChange: (v: MediaState) => void; stage?: number; hands?: number; engravings?: number;
}) {
  const { t, lang } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const base = { index, tier, season, stage, hands, engravings, occasion: value.occasion };
  const preview = value.photo ? renderPhotoArt(base, value.photo, value.w && value.h ? { w: value.w, h: value.h } : undefined) : renderArt(base);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const r = await compressPhoto(f);
      if (!r) setErr(t("media.tooBig")); else onChange({ ...value, photo: r.uri, raw: r.uri, style: "plain", w: r.w, h: r.h });
    } catch { setErr(t("media.tooBig")); }
    finally { setBusy(false); }
  }
  async function setStyle(style: "plain" | "silver") {
    if (!value.raw || busy) return;
    setBusy(true); setErr("");
    try {
      const uri = style === "plain" ? value.raw : await waxPhoto(value.raw, "silver");
      if (!uri) setErr(t("media.tooBig")); else onChange({ ...value, photo: uri, style });
    } catch { setErr(t("media.tooBig")); }
    finally { setBusy(false); }
  }
  return (
    <div className="gap">
      <div className="muted">{t("media.occasion")}</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" className={`btn sm ${value.occasion === 0 ? "" : "ghost"}`} onClick={() => onChange({ ...value, occasion: 0 })}>{t("media.none")}</button>
        {OCCASIONS.map((o) => (
          <button type="button" key={o.id} className={`btn sm ${value.occasion === o.id ? "" : "ghost"}`} onClick={() => onChange({ ...value, occasion: o.id })} style={{ flex: "none" }}>
            <svg width="22" height="22" viewBox="-50 -42 100 84" dangerouslySetInnerHTML={{ __html: emblem(o.id, "currentColor") }} /> {o.names[lang]}
          </button>
        ))}
      </div>
      <div className="muted">{t("media.photo")}</div>
      <div className="note">{t("media.warn")}</div>
      <div className="note">{t("media.legal")}</div>
      <label className="muted"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {t("media.consent")}</label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn ghost" disabled={busy || !ok} onClick={() => file.current?.click()}>{busy ? t("media.busy") : t("media.choose")}</button>
        {value.photo && <button type="button" className="btn ghost" onClick={() => onChange({ ...value, photo: null })}>{t("media.remove")}</button>}
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {value.photo && value.raw && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className={`btn sm ${value.style === "silver" ? "ghost" : ""}`} disabled={busy} onClick={() => setStyle("plain")}>{t("media.stylePlain")}</button>
          <button type="button" className={`btn sm ${value.style === "silver" ? "" : "ghost"}`} disabled={busy} onClick={() => setStyle("silver")}>{t("media.styleSilver")}</button>
        </div>
      )}
      {err && <div className="bad">{err}</div>}
      <img src={svgUri(preview)} alt="" style={{ width: "100%", maxWidth: 340, margin: "0 auto", display: "block", borderRadius: 22 }} />
    </div>
  );
}
