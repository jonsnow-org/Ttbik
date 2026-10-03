import { NextRequest, NextResponse } from "next/server";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

// Called only by the Python media bot. Render's datacenter IPs are often
// refused by tikwm.com (HTTP 403), while this Vercel function reaches it, so
// the bot asks us to resolve the TikTok link and then downloads the returned
// CDN URLs itself. Auth: x-media-bot-key, same token-derived secret as the
// front door.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

export async function GET(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-media-bot-key") || "", s)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = (req.nextUrl.searchParams.get("url") || "").trim();
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* invalid */
  }
  if (!host || !(host === "tiktok.com" || host.endsWith(".tiktok.com"))) {
    return NextResponse.json({ error: "not a tiktok url" }, { status: 400 });
  }

  let last = "";
  for (const base of ["https://www.tikwm.com/api/", "https://tikwm.com/api/"]) {
    try {
      const r = await fetch(`${base}?url=${encodeURIComponent(url)}&hd=1`, {
        headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.tikwm.com/" },
        signal: AbortSignal.timeout(15000),
      });
      last = `HTTP ${r.status}`;
      if (!r.ok) continue;
      const js = await r.json().catch(() => null);
      if (!js || js.code !== 0) {
        last = `code=${js?.code} msg=${js?.msg}`;
        continue;
      }
      const d = js.data || {};
      const play = d.hdplay || d.play || d.wmplay;
      if (!play) {
        last = "no media url";
        continue;
      }
      return NextResponse.json({
        media: play,
        music: d.music || null,
        title: String(d.title || "TikTok").slice(0, 120),
        thumbnail: d.cover || d.origin_cover || null,
      });
    } catch (e) {
      last = e instanceof Error ? e.message : "fetch failed";
    }
  }
  return NextResponse.json({ error: `resolve failed (${last})` }, { status: 502 });
}
