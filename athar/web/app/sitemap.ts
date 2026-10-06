import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { allTokens } from "@/lib/chain";
import { submitIndexNow } from "@/lib/indexnow";
export const dynamic = "force-dynamic";

// The pages a search engine should know: the main ones, and a page for every token that exists (each has its own picture and story).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const main = ["", "/date", "/market", "/auctions", "/mystery", "/board"].map((p) => ({ url: `${SITE_URL}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p === "" ? 1 : 0.7 }));
  let tokens: MetadataRoute.Sitemap = [];
  try { tokens = (await allTokens()).map((t) => ({ url: `${SITE_URL}/token/${t.index}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.5 })); } catch { /* the chain is slow: the main pages are enough this time */ }
  const all = [...main, ...tokens];
  void submitIndexNow(all.map((e) => e.url));   // crawlers read this file regularly, so it is also when the engines hear about new pages
  return all;
}
