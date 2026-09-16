import type { MetadataRoute } from "next";

// Next.js's built-in manifest.ts convention — auto-served at
// /manifest.webmanifest and auto-linked in every page's <head>, no manual
// wiring needed (same pattern as sitemap.ts/robots.ts in this codebase).
// Makes the site a real installable PWA ("Add to Home Screen") so a
// visitor can return straight to the tools without re-searching —
// standard, low-risk, zero ongoing cost. Doesn't touch the existing ad
// network service worker (public/sw_1.js) at all; a manifest + icons is
// enough for installability, no separate service worker needed here.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "سوق تولز — سوق الخدمات الرقمية المصغّرة",
    short_name: "سوق تولز",
    description: "أدوات مجانية تعمل فعلياً داخل متصفحك، وبوتات تليجرام حقيقية — بلا تسجيل وبلا حدود استخدام.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0284c7",
    dir: "rtl",
    lang: "ar",
    icons: [
      { src: "/pwa-icon-192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon-512", sizes: "512x512", type: "image/png" },
    ],
  };
}
