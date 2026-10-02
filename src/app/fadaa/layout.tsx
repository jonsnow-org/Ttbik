import type { Metadata, Viewport } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "فضاء | جلسات مؤقتة",
  description: "جلسة مؤقتة لغرض واضح بإسهامات محددة ثم تُغلق.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function FadaaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
