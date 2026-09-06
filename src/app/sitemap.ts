import type { MetadataRoute } from "next";
import { supabasePublic } from "@/lib/supabase";

// Same ISR window as src/app/page.tsx / service/[slug] — without this the
// service list baked in here would only refresh on the next deploy.
export const revalidate = 30;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const db = supabasePublic();
  const { data: services } = await db.from("services").select("slug").eq("is_active", true);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/bots`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/order/lookup`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/free-tools`, changeFrequency: "monthly", priority: 0.9 },
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
    {
      url: `${base}/free-tools/image-optimizer`,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: { ar: `${base}/free-tools/image-optimizer`, en: `${base}/en/free-tools/image-optimizer` } },
    },
    { url: `${base}/free-tools/text-analyzer`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/writing-assistant`, changeFrequency: "monthly", priority: 0.9 },
    // English versions of the 3 language-agnostic tools (owner directive
    // 2026-09-04: reach English/global search demand for QR/URL-shortener/
    // image-compression queries, without translating the whole site).
    { url: `${base}/en/free-tools/qr-generator`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/url-shortener`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/image-optimizer`, changeFrequency: "monthly", priority: 0.85 },
  ];

  const serviceRoutes: MetadataRoute.Sitemap = (services ?? []).map((s) => ({
    url: `${base}/service/${s.slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticRoutes, ...serviceRoutes];
}
