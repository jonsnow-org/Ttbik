import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";
import { NEWS_ITEMS } from "@/lib/newsItems";
import { EN_NEWS, EN_ARTICLES, EN_EVENTS } from "@/lib/enDesk";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { EVENT_EXTRAS } from "@/lib/eventsExtra";
import { BOT_LANDINGS } from "@/lib/botLanding";
import { FREE_TOOLS } from "@/lib/freeTools";
import { PRAYER_CITIES } from "@/lib/prayerCities";

export const revalidate = 30;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL;

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/bots`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/news`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/en`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/en/advertise`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/en/free-tools`, changeFrequency: "weekly", priority: 0.7 },
    {
      url: `${base}/ai-tools`,
      changeFrequency: "weekly",
      priority: 0.8,
      alternates: { languages: { ar: `${base}/ai-tools`, en: `${base}/en/ai-tools` } },
    },
    {
      url: `${base}/en/ai-tools`,
      changeFrequency: "weekly",
      priority: 0.8,
      alternates: { languages: { ar: `${base}/ai-tools`, en: `${base}/en/ai-tools` } },
    },
    { url: `${base}/en/news`, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/en/articles`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/en/events`, changeFrequency: "weekly", priority: 0.6 },
    ...EN_NEWS.map((n) => ({ url: `${base}/en/news/${n.slug}`, changeFrequency: "weekly" as const, priority: 0.65 })),
    ...EN_ARTICLES.map((n) => ({ url: `${base}/en/articles/${n.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...EN_EVENTS.map((n) => ({ url: `${base}/en/events/${n.slug}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...NEWS_ITEMS.map((n) => ({
      url: `${base}/news/${n.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    { url: `${base}/editorial-policy`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/events`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/events/autumn-equinox-2026`, changeFrequency: "weekly", priority: 0.75 },
    { url: `${base}/word-of-day`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/guess-word`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/prices`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/markets`, changeFrequency: "hourly", priority: 0.85 },
    { url: `${base}/prayer-times`, changeFrequency: "daily", priority: 0.85 },
    { url: `${base}/prayer-widget`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/bashar`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/watch-and-earn`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/bots/health-check`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/bots/earnings-calculator`, changeFrequency: "monthly", priority: 0.75 },
    { url: `${base}/order/lookup`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/free-tools/bmi-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/life-counter`, changeFrequency: "monthly", priority: 0.9 },
    {
      url: `${base}/free-tools/qr-generator`,
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: { ar: `${base}/free-tools/qr-generator`, en: `${base}/en/free-tools/qr-generator` } },
    },
    { url: `${base}/free-tools/zakat-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/hijri-converter`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/profit-margin`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/store-net-profit`, changeFrequency: "monthly", priority: 0.9 },
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
    { url: `${base}/free-tools/number-to-words`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/name-decorator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/percentage-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/pregnancy-calculator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/date-difference`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/free-tools/shared-costs`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/en/free-tools/qr-generator`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/url-shortener`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/image-optimizer`, changeFrequency: "monthly", priority: 0.85 },
    { url: `${base}/en/free-tools/bmi-calculator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/vat-calculator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/profit-margin`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/invoice-generator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/cv-generator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/crypto-converter`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/life-counter`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/whatsapp-link`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/articles`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/articles/mawaeed-qitaf-zaytoun-2026`, changeFrequency: "monthly", priority: 0.6 },
    ...ARTICLE_ITEMS.map((a) => ({ url: `${base}/articles/${a.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${base}/events/upcoming`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/en/events/upcoming`, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/digest`, changeFrequency: "daily", priority: 0.6 },
    ...Array.from(new Set([...EVENT_ITEMS, ...EVENT_EXTRAS].map((e) => e.slug)))
      .filter((slug) => slug !== "autumn-equinox-2026")
      .map((slug) => ({ url: `${base}/events/${slug}`, changeFrequency: "monthly" as const, priority: 0.65 })),
    ...BOT_LANDINGS.map((b) => ({ url: `${base}/bot/${b.slug}`, changeFrequency: "monthly" as const, priority: 0.85 })),
    { url: `${base}/en/free-tools/percentage-calculator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/date-difference`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/pregnancy-calculator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/en/free-tools/fancy-text`, changeFrequency: "monthly", priority: 0.8 },
    ...PRAYER_CITIES.map((c) => ({
      url: `${base}/prayer-times/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  let serviceRoutes: MetadataRoute.Sitemap = [];
  try {
    const { readCatalog } = await import("@/lib/supabase");
    const services = await readCatalog((db) => db.from("services").select("slug").eq("is_active", true));
    serviceRoutes = (services ?? []).map((s) => ({
      url: `${base}/service/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    serviceRoutes = [];
  }

  // Every tool listed in FREE_TOOLS is included even if nobody remembered to
  // add it by hand above (story-card, sentiment-analyzer, ...).
  const have = new Set(staticRoutes.map((r) => r.url));
  const toolRoutes: MetadataRoute.Sitemap = FREE_TOOLS.filter((t) => !have.has(`${base}${t.href}`)).map((t) => ({
    url: `${base}${t.href}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const seen = new Set<string>();
  return [...staticRoutes, ...toolRoutes, ...serviceRoutes].filter((r) => !seen.has(r.url) && !!seen.add(r.url));
}
