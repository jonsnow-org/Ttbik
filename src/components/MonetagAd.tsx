"use client";

import Script from "next/script";

/**
 * Monetag ad groundwork for the Telegram mini-app (owner is bringing real
 * zone codes from Monetag separately) — everything here is inert (renders/
 * loads nothing) until the matching env var is set, so it's safe to ship
 * ahead of having the actual codes and doesn't show a placeholder ad box
 * to real users in the meantime.
 *
 * Rewarded/interstitial format (Monetag's documented SDK pattern):
 *   <script src="https://libtl.com/sdk.js" data-zone="<ZONE_ID>" data-sdk="show_<ZONE_ID>">
 * then calling window.show_<ZONE_ID>() shows it and resolves when done.
 * Set NEXT_PUBLIC_MONETAG_ZONE_ID once that code is available.
 */
const ZONE_ID = (process.env.NEXT_PUBLIC_MONETAG_ZONE_ID || "").trim();

/** Mount once near the root of the mini-app — loads Monetag's SDK script. */
export function MonetagSdkLoader() {
  if (!ZONE_ID) return null;
  return (
    <Script
      src="https://libtl.com/sdk.js"
      data-zone={ZONE_ID}
      data-sdk={`show_${ZONE_ID}`}
      strategy="afterInteractive"
    />
  );
}

/**
 * Shows a rewarded/interstitial ad on demand (e.g. from a "شاهد إعلان" button).
 * Resolves true if it played, false if unavailable/skipped/not configured yet
 * — callers should treat false as "no reward", never throw the user an error.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (!ZONE_ID) return false;
  const fn = (window as unknown as Record<string, unknown>)[`show_${ZONE_ID}`];
  if (typeof fn !== "function") return false;
  try {
    await (fn as () => Promise<unknown>)();
    return true;
  } catch {
    return false;
  }
}

/**
 * Banner slot — Monetag issues a unique container id + script URL per
 * banner zone, so both come from env vars rather than a hardcoded pattern.
 * Renders nothing until NEXT_PUBLIC_MONETAG_BANNER_CONTAINER_ID and
 * NEXT_PUBLIC_MONETAG_BANNER_SCRIPT_URL are both set.
 */
export function MonetagBannerSlot({ className }: { className?: string }) {
  const containerId = (process.env.NEXT_PUBLIC_MONETAG_BANNER_CONTAINER_ID || "").trim();
  const scriptUrl = (process.env.NEXT_PUBLIC_MONETAG_BANNER_SCRIPT_URL || "").trim();
  if (!containerId || !scriptUrl) return null;
  return (
    <div className={className}>
      <div id={containerId} />
      <Script src={scriptUrl} strategy="afterInteractive" async />
    </div>
  );
}
