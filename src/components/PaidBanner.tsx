"use client";

import { useEffect, useState } from "react";

type Active = { active: boolean; bannerUrl?: string; targetUrl?: string; altText?: string; kind?: string };

export default function PaidBanner() {
  const [ad, setAd] = useState<Active>({ active: false });
  useEffect(() => {
    fetch("/api/ads/active").then((r) => r.json()).then(setAd).catch(() => setAd({ active: false }));
  }, []);
  if (!ad.active || !ad.targetUrl) return null;
  if (ad.kind === "code") {
    return <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="block bg-amber-400 px-4 py-3 text-center text-sm font-extrabold text-slate-950">{ad.bannerUrl}</a>;
  }
  if (ad.kind === "video" && ad.bannerUrl) {
    return <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="block bg-black text-center"><video src={ad.bannerUrl} className="mx-auto h-24 max-w-3xl" autoPlay muted loop playsInline /></a>;
  }
  if (!ad.bannerUrl) return null;
  return <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="block bg-white text-center"><img src={ad.bannerUrl} alt={ad.altText || "إعلان"} className="mx-auto h-[72px] w-full max-w-3xl object-contain" /></a>;
}
