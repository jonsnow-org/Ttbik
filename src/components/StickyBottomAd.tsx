"use client";

import { useEffect, useState } from "react";
import AdsterraBanner from "./AdsterraBanner";

const DISMISS_KEY = "ttbik_sticky_ad_dismissed";
// Same real, live Adsterra 320x50 unit already used for header/footer on
// mobile (AdsterraSlot.tsx) — a sticky bottom placement of the exact same
// ad format/size is standard practice and needs no new ad-network zone,
// just different CSS positioning.
const KEY_320x50 = "560a1eb1632771185b888243a7d36a07";

/**
 * Sticky bottom anchor ad, mobile-only — real, high-CTR ad-revenue lever
 * (owner-analysis idea, 2026-09-16). Dismissible (required for a decent
 * user experience and to stay within most ad networks' "no intrusive/
 * unclosable ad" policies), and the dismissal is remembered for the rest
 * of this browsing session (sessionStorage) so it doesn't reappear on
 * every single page navigation once someone's closed it once, but does
 * come back on their next visit.
 */
export default function StickyBottomAd() {
  const [dismissed, setDismissed] = useState(true); // default hidden until we know sessionStorage says otherwise — avoids a flash on load

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private browsing / storage blocked — just hides for this page load instead
    }
  }

  if (dismissed) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-1.5 border-t border-slate-200 bg-white/95 px-2 py-1.5 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <button
        onClick={dismiss}
        aria-label="إغلاق الإعلان"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600"
      >
        ✕
      </button>
      <AdsterraBanner adKey={KEY_320x50} width={320} height={50} />
    </div>
  );
}
