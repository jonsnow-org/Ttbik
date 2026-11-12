import type { Viewport } from "next";
import Script from "next/script";

import "./match-app.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function MatchAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}
