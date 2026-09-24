"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";

type TgWebApp = { ready?: () => void; initDataUnsafe?: { start_param?: string } };

/**
 * When «بَشَر» is opened as a Telegram Mini App (t.me/<bot>/<app>?startapp=q_<id>),
 * Telegram shows it as a window over the chat. Route the start param to the question.
 */
export default function TelegramStart() {
  const router = useRouter();
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onLoad={() => {
        const tg = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
        tg?.ready?.();
        const sp = tg?.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get("tgWebAppStartParam") || "";
        const m = sp.match(/^q_([a-f0-9]{16})$/);
        if (m) router.replace(`/bashar/q/${m[1]}`);
      }}
    />
  );
}
