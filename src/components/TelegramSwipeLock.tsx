"use client";

import { useEffect } from "react";

function openedInsideTelegram() {
  try {
    if ((window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData) return true;
    if (/Telegram/i.test(navigator.userAgent || "")) return true;
    return /tgWebApp/i.test(`${window.location.hash} ${window.location.search}`);
  } catch {
    return false;
  }
}

function lock() {
  const t = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void; disableVerticalSwipes?: () => void } } }).Telegram?.WebApp;
  if (!t) return;
  try {
    t.ready();
    t.expand();
    t.disableVerticalSwipes?.();
  } catch { /* old clients */ }
  document.documentElement.style.overscrollBehaviorY = "none";
  document.body.style.overscrollBehaviorY = "none";
}

export default function TelegramSwipeLock() {
  useEffect(() => {
    if (!openedInsideTelegram()) return;
    lock();
    if ((window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = lock;
    document.head.appendChild(s);
  }, []);
  return null;
}
