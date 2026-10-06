"use client";

import AdsterraBanner from "./AdsterraBanner";

// Adsterra ad-unit keys (site: ttbik.vercel.app, added 2026-09-04).
const KEY_320x50 = "560a1eb1632771185b888243a7d36a07";
const KEY_300x250 = "3ee970813986977775e962f26938d143";
const KEY_728x90 = "4f06d38f318a4c96638f8e2289f8ca0c";

/**
 * Renders the right Adsterra unit for a given AdSlot position.
 * Fixed min-heights reserve layout space before the iframe paints (CLS).
 */
export default function AdsterraSlot({ position }: { position: "header-banner" | "in-content" | "footer-banner" }) {
  if (position === "in-content") {
    return (
      <div className="flex min-h-[250px] items-center justify-center">
        <AdsterraBanner adKey={KEY_300x250} width={300} height={250} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[50px] justify-center sm:min-h-[90px]">
      <div className="sm:hidden">
        <AdsterraBanner adKey={KEY_320x50} width={320} height={50} />
      </div>
      <div className="hidden sm:block">
        <AdsterraBanner adKey={KEY_728x90} width={728} height={90} />
      </div>
    </div>
  );
}
