"use client";

import { useEffect, useState } from "react";

type Active = { active: boolean; bannerUrl?: string; targetUrl?: string; altText?: string; kind?: string };

export default function PaidBanner() {
  const [ad, setAd] = useState<Active>({ active: false });
  useEffect(() => {
    fetch("/api/ads/active").then((r) => r.json()).then(setAd).catch(() => setAd({ active: false }));
  }, []);
  if (!ad.active || !ad.targetUrl) return null;

  if (ad.kind === "code" && ad.bannerUrl) {
    return (
      <div className="relative z-20 mx-auto my-2 h-[250px] w-full max-w-3xl overflow-hidden bg-white">
        <iframe title="إعلان" sandbox="" srcDoc={ad.bannerUrl} className="h-[250px] w-full border-0" />
      </div>
    );
  }
  if (ad.kind === "video" && ad.bannerUrl) {
    return (
      <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="relative z-20 mx-auto my-2 block h-52 w-full max-w-3xl overflow-hidden bg-black">
        <video src={ad.bannerUrl} className="h-full w-full object-contain" autoPlay muted loop playsInline />
      </a>
    );
  }
  if (!ad.bannerUrl) return null;
  return (
    <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="relative z-20 mx-auto my-2 block h-44 w-full max-w-3xl overflow-hidden bg-white">
      <img src={ad.bannerUrl} alt={ad.altText || "إعلان"} className="h-full w-full object-contain" />
    </a>
  );
}
