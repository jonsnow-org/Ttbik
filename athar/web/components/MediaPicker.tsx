"use client";
import { useRef, useState } from "react";
import { renderArt, renderPhotoArt } from "@/lib/art";
import { OCCASIONS } from "@/lib/occasions";
import { emblem } from "@/lib/occasions";
import { compressPhoto, fillSquare } from "@/lib/photo";
import { waxPhoto } from "@/lib/wax";
import { useI18n } from "@/lib/i18n";

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// raw: the chosen photo without its empty bars (rw x rh); fit "fill" (default) cuts the square window that fills the circle (fx, fy move it), "whole" keeps the picture uncropped
export type MediaState = { occasion: number; photo: string | null; w?: number; h?: number; raw?: string | null; rw?: number; rh?: number; style?: "plain" | "silver"; fit?: "fill" | "whole"; fx?: number; fy?: number };

/** Occasion chips + photo chooser + live preview of exactly what the token will look like. */
/** tier is the token's KIND (0 normal, 1 silver, 2 gold ...): a silver token's photo gets the silver wax treatment, a gold token's the gold one, a normal token's none. */
export default function MediaPicker({ index, tier, season, value, onChange, stage = 0, hands = 1, engravings = 0, fees }: {
  index: number; tier: number; season: number; value: MediaState; onChange: (v: MediaState) => void; stage?: number; hands?: number; engravings?: number; fees?: { photo: number };
}) {
  const { t, lang } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const base = { index, tier, season, stage, hands, engravings, occasion: value.occasion };
  const preview = value.photo ? renderPhotoArt(base, value.photo, value.w && value.h ? { w: value.w, h: value.h } : undefined) : renderArt(base);

  // The picture that goes on the token is made from: the prepared photo, how it fits (fill / whole), where the window sits, and its style.
  async function compose(next: Partial<MediaState>) {
    const v = { ...value, ...next };
    if (!v.raw) return;
    setBusy(true); setErr("");
    try {
      const fit = v.fit ?? "fill", fx = v.fx ?? 0.5, fy = v.fy ?? 0.32, style = v.style ?? "plain";
      const wax = tier === 1 ? "silver" : tier === 2 ? "gold" : null;
      let base = { uri: v.raw, w: v.rw ?? 0, h: v.rh ?? 0 };
      if (fit === "fill") { const f = await fillSquare(v.raw, fx, fy); if (!f) { setErr(t("media.tooBig")); return; } base = f; }
      const uri = wax ? await waxPhoto(base.uri, wax) : base.uri;
      if (!uri) setErr(t("media.tooBig")); else onChange({ ...v, fit, fx, fy, style, photo: uri, w: base.w, h: base.h });
    } catch { setErr(t("media.tooBig")); }
    finally { setBusy(false); }
  }
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const r = await compressPhoto(f);
      if (!r) setErr(t("media.tooBig")); else { setBusy(false); await compose({ raw: r.uri, rw: r.w, rh: r.h, fit: "fill", fx: 0.5, fy: 0.32, style: "plain" }); }
    } catch { setErr(t("media.tooBig")); }
    finally { setBusy(false); }
  }
  const slide = useRef<ReturnType<typeof setTimeout> | null>(null);
  function move(v: number) {           // the window follows the slider (re-made a moment after the finger stops)
    const next = value.rw && value.rh && value.rw > value.rh ? { fx: v } : { fy: v };
    onChange({ ...value, ...next });
    if (slide.current) clearTimeout(slide.current);
    slide.current = setTimeout(() => { void compose(next); }, 250);
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
      {fees && fees.photo > 0 && <div className="muted">{t("media.photoFee", { p: fees.photo })}</div>}
      {value.photo && value.raw && (
        <div className="gap">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={`btn sm ${value.fit === "whole" ? "ghost" : ""}`} disabled={busy} onClick={() => void compose({ fit: "fill" })}>{t("media.fitFill")}</button>
            <button type="button" className={`btn sm ${value.fit === "whole" ? "" : "ghost"}`} disabled={busy} onClick={() => void compose({ fit: "whole" })}>{t("media.fitWhole")}</button>
          </div>
          {value.fit !== "whole" && value.rw && value.rh && value.rw !== value.rh && (
            <label className="muted">{t("media.fitMove")}
              <input type="range" min={0} max={100} value={Math.round(((value.rw > value.rh ? value.fx : value.fy) ?? (value.rw > value.rh ? 0.5 : 0.32)) * 100)} onChange={(e) => move(Number(e.target.value) / 100)} style={{ width: "100%" }} />
            </label>
          )}
        </div>
      )}
      {err && <div className="bad">{err}</div>}
      <img src={svgUri(preview)} alt="" style={{ width: "100%", maxWidth: 340, margin: "0 auto", display: "block", borderRadius: 22 }} />
    </div>
  );
}
