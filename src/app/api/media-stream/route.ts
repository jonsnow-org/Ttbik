import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Real inline player support for the mini-app. Downloaded media only ever
// exists as a Telegram file_id (never handed to the browser -- see
// media-feed/route.ts's stripped public projection), so there was no URL a
// browser <video>/<audio> tag could actually point at; every card just
// showed a static thumbnail with no way to play anything without leaving
// to the bot chat. This resolves file_id -> a real Telegram file_path via
// getFile, then proxies the actual bytes through our own server so
// BOT_TOKEN never reaches the client (it's embedded in Telegram's file URL).
//
// Known limit: Telegram's Bot API getFile only works for files up to 20MB.
// Anything larger (occasionally a longer video) will 502 here; the
// mini-app falls back to the existing "⚡ فوري" clone-via-bot button.
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return NextResponse.json({ error: "BOT_TOKEN not configured" }, { status: 500 });

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return NextResponse.json({ error: "not available" }, { status: 404 });

  let fileId: string | null = null;
  let mediaType = "video";
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await db.from("media_feed").select("file_id,media_type").eq("id", id).maybeSingle();
    if (data) {
      fileId = String((data as any).file_id || "") || null;
      mediaType = String((data as any).media_type || "video");
    }
  } catch {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!fileId) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const fileResp = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const fileJson = await fileResp.json();
    const filePath = fileJson?.result?.file_path;
    if (!filePath) {
      return NextResponse.json(
        { error: fileJson?.description || "telegram file lookup failed" },
        { status: 502 }
      );
    }

    const mediaResp = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!mediaResp.ok || !mediaResp.body) {
      return NextResponse.json({ error: "media download failed" }, { status: 502 });
    }

    const fallbackType = mediaType === "audio" || mediaType === "voice" ? "audio/mpeg" : "video/mp4";
    const headers: Record<string, string> = {
      "content-type": mediaResp.headers.get("content-type") || fallbackType,
      "cache-control": "public, max-age=3600, immutable",
      "accept-ranges": "bytes",
    };
    const len = mediaResp.headers.get("content-length");
    if (len) headers["content-length"] = len;
    return new NextResponse(mediaResp.body, { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
