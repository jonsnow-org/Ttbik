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
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast">{msg}</div>}</ToastCtx.Provider>;
}

/** Send one wallet request: opens the wallet to confirm and pay. Returns true if the user approved. */
export function useSend() {
  const [ui] = useTonConnectUI();
  const address = useTonAddress();
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const send = useCallback(async (messages: Msg[], okText?: string) => {
    if (!address) { ui.openModal(); return false; }
    setBusy(true);
    try { await ui.sendTransaction(tx(messages)); toast(okText ?? t("ui.sent")); return true; }
    catch { toast(t("ui.cancelled")); return false; }
    finally { setBusy(false); }
  }, [address, ui, toast, t]);
  return { send, busy, address };
}

export function useApi<T>(url: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const run = () => fetch(url, { cache: "no-store" }).then((r) => r.json()).then((j) => live && setData(j)).catch(() => {});
    run();
    const t = refreshMs ? setInterval(run, refreshMs) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [url, refreshMs, tick]);
  return { data, reload: () => setTimeout(() => setTick((x) => x + 1), 7000) };
}
