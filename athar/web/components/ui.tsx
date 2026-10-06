"use client";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { LANGS, useI18n } from "@/lib/i18n";
import { Msg, tx } from "@/lib/tx";

export function Top() {
  const { lang, setLang } = useI18n();
  return (
    <div className="top">
      <Link href="/" className="logo">أثر<b>.</b></Link>
      <div className="row" style={{ flex: "none", gap: 8 }}>
        <select aria-label="language" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} style={{ width: "auto", padding: "8px 10px", fontSize: 14 }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <TonConnectButton />
      </div>
    </div>
  );
}
/** The badge of a token's kind (0 normal ... 7 legendary). */
export const KindBadge = ({ kind }: { kind: number }) => { const { t } = useI18n(); return <span className={`badge t${kind}`}>{t(`kind.${kind}` as "kind.0")}</span>; };
export const Bar = ({ value }: { value: number }) => <div className="bar"><i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
export const ton = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(n < 10 ? 2 : 1)} Gram`);

const ToastCtx = createContext<(m: string) => void>(() => {});
export function useToast() { return useContext(ToastCtx); }
type Reopen = (() => void) | null;
const StuckCtx = createContext<(f: Reopen) => void>(() => {});
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [stuck, setStuck] = useState<Reopen>(null);
  const { t } = useI18n();
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); }, []);
  const setStuckFn = useCallback((f: Reopen) => setStuck(f ? () => f : null), []);
  return (
    <ToastCtx.Provider value={show}>
      <StuckCtx.Provider value={setStuckFn}>
        {children}
        {msg && <div className="toast">{msg}</div>}
        {stuck && (
          <div className="toast" style={{ top: "auto", bottom: 86 }}>
            <div>{t("ui.stuck")}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn gold" onClick={() => { try { stuck(); } catch { /* the wallet link could not be opened */ } }}>{t("ui.reopen")}</button>
              <button className="btn ghost" onClick={() => setStuck(null)}>{t("ui.dismiss")}</button>
            </div>
          </div>
        )}
      </StuckCtx.Provider>
    </ToastCtx.Provider>
  );
}

/** Send one wallet request: opens the wallet to confirm and pay. Returns true if the user approved. */
export function useSend() {
  const [ui] = useTonConnectUI();
  const address = useTonAddress();
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const setStuck = useContext(StuckCtx);
  const send = useCallback(async (messages: Msg[], okText?: string) => {
    if (!address) { ui.openModal(); return false; }
    setBusy(true);
    const hint = setTimeout(() => toast(t("ui.walletWait")), 9000);      // the wallet prepares its own preview first (it simulates the purchase); a second try is instant
    // A wallet that was not running can open blank and never show the request (seen with MyTonWallet); when the user comes back to the page with the
    // request still waiting, offer to open the wallet again (the SDK re-opens its link, no second request is made) and say what else to do.
    let reopen: (() => void) | null = null, sentAt = 0, finished = false;
    const onBack = () => { if (!finished && reopen && document.visibilityState === "visible") setTimeout(() => { if (!finished && reopen && Date.now() - sentAt > 4000) setStuck(reopen); }, 1500); };
    document.addEventListener("visibilitychange", onBack);
    try {
      await ui.sendTransaction(tx(messages), { onRequestSent: (re: () => void) => { reopen = re; sentAt = Date.now(); } } as any);
      toast(okText ?? t("ui.sent")); return true;
    }
    catch { toast(t("ui.cancelled")); return false; }
    finally { finished = true; document.removeEventListener("visibilitychange", onBack); setStuck(null); clearTimeout(hint); setBusy(false); }
  }, [address, ui, toast, t, setStuck]);
  return { send, busy, address };
}

export function useApi<T>(url: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true, retry: ReturnType<typeof setTimeout> | undefined;
    // An error reply (node busy, server hiccup) is never taken as data: the last good answer stays and we ask again in a few seconds.
    const run = (): void => { fetch(url, { cache: "no-store" }).then(async (r) => {
      const j = await r.json();
      if (!live) return;
      if (!r.ok || (j && typeof j === "object" && "error" in j && !Array.isArray(j))) { retry = setTimeout(run, 4000); return; }
      setData(j);
    }).catch(() => { if (live) retry = setTimeout(run, 4000); }); };
    run();
    const t = refreshMs ? setInterval(run, refreshMs) : undefined;
    return () => { live = false; if (t) clearInterval(t); if (retry) clearTimeout(retry); };
  }, [url, refreshMs, tick]);
  return { data, reload: () => setTimeout(() => setTick((x) => x + 1), 7000) };
}
