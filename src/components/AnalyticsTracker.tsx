"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "ttbik_sid";

export function getSessionId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Private browsing / storage blocked — fall back to a per-load id
    // rather than breaking the page; this visit just won't be grouped
    // into a returning session.
    return crypto.randomUUID();
  }
}

/**
 * Fires one beacon per page view to /api/analytics/track (see that route
 * for what is/isn't stored). Renders nothing.
 *
 * Skips entirely when `isOwner` is true — the owner's own visits while
 * building/testing the site shouldn't inflate their own visitor count.
 * isOwner comes from the root layout's server-side isOwnerServer() check,
 * since this client component can't read the owner cookie itself (it's
 * httpOnly).
 */
export default function AnalyticsTracker({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (isOwner) return;
    // automated browsers (Playwright/Puppeteer/Selenium, the repo's own probes) announce themselves: never count them as visitors
    if (typeof navigator !== "undefined" && (navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    const sessionId = getSessionId();
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, referrer: document.referrer || null, sessionId }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, isOwner]);

  return null;
}
