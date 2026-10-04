"use client";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { TIER_NAME_AR } from "@/lib/dates";
import { Msg, tx } from "@/lib/tx";

export function Top() {
  return (
    <div className="top">
      <Link href="/" className="logo">أثر<b>.</b></Link>
      <TonConnectButton />
    </div>
  );
}
export const TierBadge = ({ tier }: { tier: number }) => <span className={`badge t${tier}`}>{TIER_NAME_AR[tier]}</span>;
export const Bar = ({ value }: { value: number }) => <div className="bar"><i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
export const ton = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(n < 10 ? 2 : 1)} TON`);

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
  const [busy, setBusy] = useState(false);
  const send = useCallback(async (messages: Msg[], okText = "تم الإرسال. سيظهر الأثر خلال لحظات.") => {
    if (!address) { ui.openModal(); return false; }
    setBusy(true);
    try { await ui.sendTransaction(tx(messages)); toast(okText); return true; }
    catch { toast("لم تكتمل العملية (أُلغيت أو رُفضت من المحفظة)."); return false; }
    finally { setBusy(false); }
  }, [address, ui, toast]);
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
