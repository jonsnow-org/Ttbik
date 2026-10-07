"use client";

import { useEffect } from "react";

function lock() {
  const t = (window as any).Telegram?.WebApp;
  if (!t) return;
  try {
    t.ready();
    t.expand();
    t.disableVerticalSwipes?.();
  } catch {}
  document.documentElement.style.overscrollBehaviorY = "none";
  document.body.style.overscrollBehaviorY = "none";
}

export default function TelegramSwipeLock() {
  useEffect(() => {
    lock();
    if ((window as any).Telegram?.WebApp) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = lock;
    document.head.appendChild(s);
  }, []);
  return null;
}
