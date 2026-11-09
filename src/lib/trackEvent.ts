"use client";
// One-line conversion tracking for the owner: trackEvent("share_whatsapp") stores "evt:share_whatsapp:<current page>" in page_views
// through the same tracker endpoint (machines and automated browsers are dropped there and here).
import { getSessionId } from "@/components/AnalyticsTracker";

export function trackEvent(name: string) {
  try {
    if (typeof window === "undefined") return;
    if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    const ev = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    if (!ev) return;
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `evt:${ev}:${window.location.pathname}`.slice(0, 300), referrer: document.referrer || null, sessionId: getSessionId() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never break the page for analytics */
  }
}
