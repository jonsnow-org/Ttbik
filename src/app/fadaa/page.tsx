"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import "./fadaa-client.css";

const FadaaApp = dynamic(() => import("@/components/fadaa/App"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[var(--tg-viewport-height,100dvh)] place-items-center bg-[#081b2b] text-[#f4fafb]">
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
      tg?.setHeaderColor?.("#102a3c");
      tg?.setBackgroundColor?.("#081b2b");
      tg?.setBottomBarColor?.("#102a3c");
      tg?.disableVerticalSwipes?.();
      // Keep Telegram's native top bar visible and use its viewport CSS variables instead.
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
