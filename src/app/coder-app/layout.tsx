import type { Metadata, Viewport } from "next";
// telegram-ui's design tokens and component styles (platform-aware: iOS / Material), scoped to this route
import "@telegram-apps/telegram-ui/dist/styles.css";

export const metadata: Metadata = { title: "Nova AI", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

// 2026-10-21: the official tma.js SDK (src/app/coder-app/_tma/sdk.ts) replaced the telegram-web-app.js <Script> that was loaded here.
export default function CoderAppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
