import type { MetadataRoute } from "next";
import { PRAYER_CITIES } from "@/lib/prayerCities";

export const revalidate = 30;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/bots`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/news`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/prayer-times`, changeFrequency: "daily", priority: 0.85 },
    { url: `${base}/watch-and-earn`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/bots/health-check`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/bots/earnings-calculator`, changeFrequency: "monthly", priority: 0.75 },
    { url: `${base}/order/lookup`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/free-tools/bmi-calculator`, changeFrequency: "monthly", priority: 0.9 },
    {
      url: `${base}/free-tools/qr-generator`,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: { ar: `${base}/free-tools/qr-generator`, en: `${base}/en/free-tools/qr-generator` } },
    },
    { url: `${base}/free-tools/zakat-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/hijri-converter`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/profit-margin`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/vat-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/crypto-converter`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/invoice-generator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/cv-generator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/digital-card`, changeFrequency: "monthly", priority: 0.9 },
    {
      url: `${base}/free-tools/url-shortener`,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: { ar: `${base}/free-tools/url-shortener`, en: `${base}/en/free-tools/url-shortener` } },
    },
    { url: `${base}/free-tools/whatsapp-link`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/business-name-generator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/logo-generator`, changeFrequency: "monthly", priority: 0.9 },
    {
      url: `${base}/free-tools/image-optimizer`,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: { ar: `${base}/free-tools/image-optimizer`, en: `${base}/en/free-tools/image-optimizer` } },
    },
    { url: `${base}/free-tools/text-analyzer`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/writing-assistant`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/en/free-tools/qr-generator`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/url-shortener`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/image-optimizer`, changeFrequency: "monthly", priority: 0.85 },
    ...PRAYER_CITIES.map((c) => ({
      url: `${base}/prayer-times/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  let serviceRoutes: MetadataRoute.Sitemap = [];
  try {
    const { supabasePublic } = await import("@/lib/supabase");
    const db = supabasePublic();
    const { data: services } = await db.from("services").select("slug").eq("is_active", true);
    serviceRoutes = (services ?? []).map((s) => ({
      url: `${base}/service/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    serviceRoutes = [];
  }

  return [...staticRoutes, ...serviceRoutes];
}
