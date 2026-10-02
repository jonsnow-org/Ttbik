"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import "./fadaa-client.css";

const FadaaApp = dynamic(() => import("@/components/fadaa/App"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[100dvh] place-items-center bg-slate-900 text-white">
      <div className="text-3xl font-bold">فضاء</div>
    </div>
  ),
});

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        requestFullscreen?: () => void;
        disableVerticalSwipes?: () => void;
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        isExpanded?: boolean;
        platform?: string;
      };
    };
  }
}

export default function FadaaPage() {
  useEffect(() => {
    document.documentElement.classList.add("fadaa-tma");
    const tg = window.Telegram?.WebApp;
    try {
      tg?.ready();
      tg?.expand();
      tg?.setHeaderColor?.("#0f172a");
      tg?.setBackgroundColor?.("#0f172a");
      tg?.disableVerticalSwipes?.();
      // Fullscreen when supported (Bot API 8+)
      try {
        tg?.requestFullscreen?.();
      } catch {
        /* older clients */
      }
    } catch {
      /* outside Telegram */
    }
    return () => {
      document.documentElement.classList.remove("fadaa-tma");
    };
  }, []);

  return (
    <div className="fadaa-root">
      <FadaaApp />
    </div>
  );
}
