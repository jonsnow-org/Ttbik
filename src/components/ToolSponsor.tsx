"use client";

import { useEffect, useState } from "react";

export default function ToolSponsor({ tool }: { tool: string }) {
  const [ad, setAd] = useState<{ active: boolean; code?: string; name?: string; line?: string; url?: string }>({ active: false });
  useEffect(() => {
    fetch(`/api/sponsors/active?tool=${tool}`).then((r) => r.json()).then(setAd).catch(() => setAd({ active: false }));
  }, [tool]);
  // proof of promotion for the sponsor's report: a view per render, clicks counted through /api/ads/go
  useEffect(() => {
    if (!ad.active || !ad.code || (navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    fetch("/api/ads/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: ad.code }), keepalive: true }).catch(() => {});
  }, [ad.active, ad.code]);
  if (!ad.active) {
    return <a href={`/sponsor?tool=${tool}`} className="mt-3 block rounded-md bg-amber-50 px-3 py-1 text-center text-xs font-bold text-amber-800">هذه الأداة بلا راعٍ — احجز الرعاية</a>;
  }
  return <a href={ad.code ? `/api/ads/go?c=${encodeURIComponent(ad.code)}` : ad.url} target="_blank" rel="sponsored noopener" className="mt-3 block rounded-md bg-amber-50 px-3 py-1 text-center text-xs font-bold text-amber-900">برعاية {ad.name}: {ad.line}</a>;
}
