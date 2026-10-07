"use client";

import { useEffect, useState } from "react";

type Active = { active: boolean; bannerUrl?: string; targetUrl?: string; altText?: string; kind?: string };

const frame = "mx-auto block h-16 w-full max-w-3xl overflow-hidden bg-slate-100";

export default function PaidBanner() {
  const [ad, setAd] = useState<Active>({ active: false });
  useEffect(() => {
    fetch("/api/ads/active").then((r) => r.json()).then(setAd).catch(() => setAd({ active: false }));
  }, []);
  if (!ad.active || !ad.targetUrl) return null;
  if (ad.kind === "code" && ad.bannerUrl) {
    return (
      <div className={frame}>
        <iframe title="إعلان" sandbox="" srcDoc={ad.bannerUrl} className="h-16 w-full border-0" />
      </div>
    );
  }
  if (ad.kind === "video" && ad.bannerUrl) {
    return (
      <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className={frame}>
        <video src={ad.bannerUrl} className="h-16 w-full object-cover" autoPlay muted loop playsInline />
      </a>
    );
  }
  if (!ad.bannerUrl) return null;
  return (
    <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className={frame}>
      <img src={ad.bannerUrl} alt={ad.altText || "إعلان"} className="h-16 w-full object-cover" />
    </a>
  );
}
