"use client";

import { useEffect, useState } from "react";
import AdsterraBanner from "./AdsterraBanner";

// Adsterra ad-unit keys (site: ttbik.vercel.app, added 2026-09-04).
const KEY_320x50 = "560a1eb1632771185b888243a7d36a07";
const KEY_300x250 = "3ee970813986977775e962f26938d143";
const KEY_728x90 = "4f06d38f318a4c96638f8e2289f8ca0c";

/**
 * Renders the right Adsterra unit for a given AdSlot position.
 * Fixed min-heights reserve layout space before the iframe paints (CLS).
 * Only one banner size is mounted (matchMedia) so mobile+desktop iframes
 * do not both load ads on every page — keeps CLS reserve, cuts wasted requests.
 */
export default function AdsterraSlot({ position }: { position: "header-banner" | "in-content" | "footer-banner" }) {
  if (position === "in-content") {
    return (
      <div className="flex min-h-[250px] items-center justify-center">
        <AdsterraBanner adKey={KEY_300x250} width={300} height={250} />
      </div>
    );
  }

  return <ResponsiveBannerSlot />;
}

function ResponsiveBannerSlot() {
  // undefined = SSR/first paint: reserve max height, mount nothing yet (no double fetch).
  const [wide, setWide] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div className="flex min-h-[50px] justify-center sm:min-h-[90px]">
      {wide === true ? (
        <AdsterraBanner adKey={KEY_728x90} width={728} height={90} />
      ) : wide === false ? (
        <AdsterraBanner adKey={KEY_320x50} width={320} height={50} />
      ) : null}
    </div>
  );
}
