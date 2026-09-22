"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

// Monetag Multitag (zone 275749) bundles several ad formats automatically,
// including more intrusive ones (popunder/interstitial) alongside banners —
// unlike the single-format In-Page Push script, which stays site-wide.
// Kept off these paths so it never interrupts a real money/credential flow:
// checkout & order tracking, wallet/payment pages, the admin dashboard, the
// bot-token deploy form, and the ad-watch verification page (an ad breaking
// another ad's reward flow would be a bad look).
//
// The homepage ("/") joined this list 2026-09-22: real report — tapping the
// "جرّب بوتاتنا الآن على تليجرام" card force-closed both the browser and
// Telegram. That card does the exact same thing as /watch's outbound flow
// (hands off to an external app mid-page), the same hazard class already
// excluded above; a popunder/interstitial firing on the resulting
// visibilitychange/blur is the most likely cause. Same reasoning: an ad
// breaking the platform's own flagship "try a real bot" funnel is worse
// than the ad revenue lost on this one page.
const EXCLUDED_PREFIXES = ["/admin", "/order", "/pay", "/bots", "/watch", "/"];

export default function MultitagScript() {
  const pathname = usePathname();
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }
  return <Script src="https://quge5.com/88/tag.min.js" data-zone="275749" strategy="afterInteractive" data-cfasync="false" />;
}
