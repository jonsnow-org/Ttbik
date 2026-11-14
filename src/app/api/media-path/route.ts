import { NextRequest, NextResponse } from "next/server";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";
import { isPublicMediaPost } from "@/lib/mediaVisibility";

// Tiny lookup for the Cloudflare media Worker (cloudflare/media-stream-worker.js):
// post id -> Telegram file_path. This endpoint runs behind the permanent site gate
// and reads from the active site's media DB/token. Only this short-lived path is
// returned; the Worker's BOT_TOKEN remains a Cloudflare secret. Video bytes are
// fetched directly from Telegram, not proxied through the site.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = await mediaDb();
  const token = mediaBotToken();
  if (!db || !token) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data } = await db.from("media_feed").select("file_id,media_type,hidden,squad_code").eq("id", id).maybeSingle();
  const row = data as any;
  if (!isPublicMediaPost(row) || !row.file_id) return NextResponse.json({ error: "not found" }, { status: 404 });

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
