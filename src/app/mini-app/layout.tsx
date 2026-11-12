import type { Viewport } from "next";
import Script from "next/script";
import "./mini-app.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}
