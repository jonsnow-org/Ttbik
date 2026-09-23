import { NextRequest, NextResponse } from "next/server";
import { isPlaceholderTitle, isTikTok, mediaDb, tiktokOembed } from "@/lib/mediaSocial";

// Preview image for a feed item. TikTok items were saved with no thumbnail
// at all (owner report 2026-09-24: TikTok cards showed an empty preview),
// and TikTok's own thumbnail URLs are signed and expire within hours — so
// storing one wouldn't last. This resolves a fresh one through TikTok's
// public oEmbed on demand and serves it from our domain, CDN-cached.
// While it's there, it also backfills a real title over the numeric id the
// downloader stored as the title.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return new NextResponse("id required", { status: 400 });
  const db = await mediaDb();
  if (!db) return new NextResponse("not configured", { status: 503 });

  const { data } = await db.from("media_feed").select("id,url,thumbnail,title").eq("id", id).maybeSingle();
  if (!data) return new NextResponse("not found", { status: 404 });
  const row = data as any;

  let imageUrl = String(row.thumbnail || "");
  if (isTikTok(row.url) || !imageUrl) {
    const o = isTikTok(row.url) ? await tiktokOembed(row.url) : null;
    if (o?.thumbnail) imageUrl = o.thumbnail;
    if (o && isPlaceholderTitle(row.title)) {
      const title = (o.title || (o.author ? `فيديو من ${o.author}` : "")).slice(0, 120);
      if (title) await db.from("media_feed").update({ title }).eq("id", id).then(() => {}, () => {});
    }
  }
  if (!imageUrl || imageUrl.startsWith("/")) return new NextResponse("no thumbnail", { status: 404 });

  try {
    const img = await fetch(imageUrl, { cache: "no-store" });
    const type = img.headers.get("content-type") || "";
    if (!img.ok || !type.startsWith("image/")) return new NextResponse("upstream failed", { status: 502 });
    return new NextResponse(img.body, {
      headers: {
        "content-type": type,
        // TikTok URLs expire in hours; keep our cached copy well inside that.
        "cache-control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse("upstream failed", { status: 502 });
  }
}
