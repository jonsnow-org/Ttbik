import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import Providers from "./providers";
import Nav from "@/components/Nav";

export const metadata: Metadata = { title: "أثر · Athar", description: "رمز لكل يوم في التقويم. يحفظ ذاكرة كل من امتلكه. من شام AI." };
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
