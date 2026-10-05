import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import Providers from "./providers";
import Nav from "@/components/Nav";
import { META_BASE, SITE_URL } from "@/lib/config";

const DESC = "One token for every day of the calendar (1950–2049) on TON. It remembers everyone who owned it and matures the longer it is held. | رمز لكل يوم في التقويم. يحفظ ذاكرة كل من امتلكه. من شام AI.";
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL || "http://localhost:3100"),
  title: { default: "Athar · أثر", template: "%s · Athar" },
  description: DESC,
  openGraph: { type: "website", siteName: "Athar · أثر", title: "Athar · أثر: one token for every day", description: DESC, images: [{ url: `${META_BASE}/img/collection.png`, width: 800, height: 800, alt: "Athar" }] },
  twitter: { card: "summary", title: "Athar · أثر: one token for every day", description: DESC, images: [`${META_BASE}/img/collection.png`] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#070b18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body>
        <Providers>
          <div className="wrap">{children}</div>
          <Nav />
        </Providers>
      </body>
    </html>
  );
}
