"use client";

import { useEffect, useState } from "react";

type Active = { active: boolean; bannerUrl?: string; targetUrl?: string; altText?: string };

export default function PaidBanner() {
  const [ad, setAd] = useState<Active>({ active: false });
  useEffect(() => {
    fetch("/api/ads/active")
      .then((r) => r.json())
      .then((d) => setAd(d))
      .catch(() => setAd({ active: false }));
  }, []);
  if (!ad.active || !ad.bannerUrl || !ad.targetUrl) {
    return (
      <a href="/advertise" className="block bg-amber-50 px-4 py-2 text-center text-xs font-bold text-amber-800">
        إعلانك هنا — احجز البنر في كل الصفحات
      </a>
    );
  }
  return (
    <a href={ad.targetUrl} target="_blank" rel="sponsored noopener" className="block bg-white text-center">
      <img src={ad.bannerUrl} alt={ad.altText || "إعلان"} className="mx-auto h-[72px] w-full max-w-3xl object-contain" />
    </a>
  );
}
