"use client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { useEffect } from "react";
import { ToastHost } from "@/components/ui";

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) { try { tg.ready(); tg.expand(); tg.setHeaderColor?.("#070b18"); tg.setBackgroundColor?.("#070b18"); } catch { /* not inside Telegram */ } }
  }, []);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return <TonConnectUIProvider manifestUrl={`${process.env.NEXT_PUBLIC_SITE_URL || origin}/tonconnect-manifest.json`}><ToastHost>{children}</ToastHost></TonConnectUIProvider>;
}
