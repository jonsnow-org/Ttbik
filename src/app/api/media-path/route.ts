import { NextRequest, NextResponse } from "next/server";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";

// Tiny lookup for the Cloudflare media Worker (cloudflare/media-stream-worker.js):
// post id -> Telegram file_path. Only the path is returned (it's useless
// without the bot token, which lives only in Vercel and in the Worker's
// secret), so no video bytes ever pass through Vercel. Edge-cached ~50 min,
// inside Telegram's ≥1h validity for a file_path.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = await mediaDb();
  const token = mediaBotToken();
  if (!db || !token) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data } = await db.from("media_feed").select("file_id,media_type,hidden").eq("id", id).maybeSingle();
  const row = data as any;
  if (!row || row.hidden || !row.file_id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(row.file_id)}`, { cache: "no-store" });
  const j = await r.json().catch(() => null);
  const filePath = j?.result?.file_path;
  if (!filePath) {
    // Most often: file over Telegram's 20MB Bot API download limit.
    return NextResponse.json({ error: j?.description || "file unavailable" }, { status: 422, headers: { "cache-control": "public, s-maxage=600" } });
  }
  return NextResponse.json(
    { file_path: filePath, media_type: String(row.media_type || "video") },
    { headers: { "cache-control": "public, max-age=0, s-maxage=3000" } }
  );
}
