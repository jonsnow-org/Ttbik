"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import "./fadaa-client.css";

const FadaaApp = dynamic(() => import("@/components/fadaa/App"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[100dvh] place-items-center bg-[#0f172a] text-[#f1f5f9]">
      <div className="text-3xl font-bold" style={{ fontFamily: "Amiri, serif" }}>
        فضاء
      </div>
    </div>
  ),
});

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close?: () => void;
        requestFullscreen?: () => void;
        disableVerticalSwipes?: () => void;
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        setBottomBarColor?: (c: string) => void;
        isExpanded?: boolean;
      };
    };
  }
}

export default function FadaaPage() {
  useEffect(() => {
    document.documentElement.classList.add("fadaa-tma", "dark");
    const tg = window.Telegram?.WebApp;
    try {
      tg?.ready();
      tg?.expand();
      tg?.setHeaderColor?.("#1e293b");
      tg?.setBackgroundColor?.("#0f172a");
      tg?.setBottomBarColor?.("#1e293b");
      tg?.disableVerticalSwipes?.();
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
