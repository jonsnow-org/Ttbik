"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { inPagePushZone } from "@/lib/monetagGate";

// Loads Monetag's In-Page Push tag for the gate's own site only (lib/monetagGate.ts), after the page is interactive, once per page view.
export default function MonetagInPagePush() {
  const pathname = usePathname() || "/";
  useEffect(() => {
    const zone = inPagePushZone(window.location.hostname, pathname);
    if (!zone) return;
    const s = document.createElement("script");
    s.dataset.zone = zone;
    s.src = "https://nap5k.com/tag.min.js";
    s.async = true;
    (document.body || document.documentElement).appendChild(s);
    return () => { s.remove(); };
  }, [pathname]);
  return null;
}
