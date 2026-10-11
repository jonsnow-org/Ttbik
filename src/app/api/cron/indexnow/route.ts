import { NextRequest, NextResponse } from "next/server";
import sitemap from "@/app/sitemap";
import { newsSitemapEntries } from "@/lib/newsItems";
import { INDEXNOW_KEY } from "@/lib/indexNow";
import { SITE_URL } from "@/lib/siteUrl";

// Daily (or on demand with ?secret=): tells every IndexNow search engine
// (Bing, Yandex, Seznam, Naver, ...) about every public URL -- all tools, bot
// pages, news, events, prayer cities -- so new pages are discovered in hours.
// Google does not take IndexNow; it reads the sitemap submitted in Search Console.
export const maxDuration = 60;

const ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow", "https://yandex.com/indexnow"];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const urls = Array.from(new Set([...(await sitemap()).map((e) => e.url), ...newsSitemapEntries().map((n) => `${SITE_URL}${n.path}`)])).slice(0, 9000);
  const body = JSON.stringify({ host: new URL(SITE_URL).host, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}/indexnow-key.txt`, urlList: urls });
  const results = await Promise.all(
    ENDPOINTS.map(async (ep) => {
      const res = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body }).catch(() => null);
      return { endpoint: new URL(ep).host, status: res?.status ?? 0 };
    }),
  );
  return NextResponse.json({ ok: results.some((r) => r.status >= 200 && r.status < 300), submitted: urls.length, results });
}
