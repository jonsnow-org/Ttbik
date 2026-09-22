"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Registers the ad network's service worker (public/sw_1.js — 3nbf4.com
 * domain-ownership + push-ad verification file) once per visit. Silently
 * no-ops if the browser doesn't support service workers.
 *
 * Skipped on the homepage since 2026-09-22 -- same reasoning as
 * MultitagScript.tsx's own homepage exclusion: a real report of the
 * "جرّب بوتاتنا الآن على تليجرام" card force-closing both the browser and
 * Telegram on tap, and this is the other real candidate (a push-ad
 * service worker registering/prompting right as the page hands off to an
 * external app) besides Multitag, which was excluded first and did not
 * resolve it on its own.
 */
export default function AdServiceWorker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw_1.js").catch(() => {
        // ad network unreachable/blocked — not fatal to the rest of the site
      });
    }
  }, [pathname]);
  return null;
}
