"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

// Monetag's "In-Page Push" ad script (zone 11710148) -- previously ran
// unconditionally, inline in layout.tsx, on every route. Skipped on the
// homepage since 2026-09-22, same reasoning as MultitagScript.tsx's own
// homepage exclusion: a real report of the "جرّب بوتاتنا الآن على تليجرام"
// card force-closing both the browser and Telegram on tap. Excluding
// Multitag's popunder bundle from the homepage alone did not resolve it,
// so this -- the other non-standard, ad-network script still active
// there -- is the next real candidate to rule out.
export default function MonetagInPagePushScript() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <Script
      id="monetag-inpage-push"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html:
          "(function(s){s.dataset.zone='11710148',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))",
      }}
    />
  );
}
