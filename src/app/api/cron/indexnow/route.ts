import { NextRequest, NextResponse } from "next/server";
import sitemap from "@/app/sitemap";
import { INDEXNOW_KEY } from "@/lib/indexNow";
import { SITE_URL } from "@/lib/siteUrl";

// Daily: tells IndexNow search engines (Bing, Yandex, ...) about every URL in
// our sitemap so new tools/pages get discovered in hours, not weeks.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const urls = (await sitemap()).map((e) => e.url).slice(0, 9000);
  const host = new URL(SITE_URL).host;
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}/indexnow-key.txt`, urlList: urls }),
  }).catch(() => null);
  return NextResponse.json({ ok: !!res && res.status < 300, status: res?.status ?? 0, submitted: urls.length });
}
