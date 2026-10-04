"use client";
import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Ask = { svg: string; notes: string[] };

/** A step the user cannot skip: the exact final picture, large, and a tick that they checked all of it. */
export function useConfirmPreview() {
  const { t } = useI18n();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [ok, setOk] = useState(false);
  const [broken, setBroken] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((svg: string, notes: string[] = []) => new Promise<boolean>((resolve) => {
    resolver.current = resolve; setOk(false); setBroken(false); setAsk({ svg, notes });
  }), []);
  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setAsk(null); };

  const node = ask && (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 50, overflowY: "auto", padding: 16 }}>
      <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
        <h3>{t("media.pvTitle")}</h3>
        <p className="muted">{t("media.pvHelp")}</p>
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ask.svg)}`} alt="" onError={() => setBroken(true)} style={{ width: "100%", borderRadius: 22, display: "block" }} />
        {ask.notes.includes("small") && <div className="note">{t("media.pvSmall")}</div>}
        {ask.notes.includes("shape") && <div className="note">{t("media.pvShape")}</div>}
        {broken && <div className="bad">{t("media.pvBroken")}</div>}
        <div className="gap" style={{ marginTop: 12 }}>
          <label className="muted"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {t("media.pvOk")}</label>
          <button className="btn gold" disabled={!ok || broken} onClick={() => done(true)}>{t("media.pvGo")}</button>
          <button className="btn ghost" onClick={() => done(false)}>{t("media.pvBack")}</button>
        </div>
      </div>
    </div>
  );
  return { confirm, node };
}
