import { NextRequest, NextResponse } from "next/server";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily integrity sweep. Permanently invalid Telegram file identifiers are
// deleted from the feed; size limits, rate limits and network errors are NOT
// treated as proof that a post is broken.
export async function GET(req: NextRequest) {
  const expected = (process.env.CRON_SECRET || process.env.FEED_SECRET || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const supplied = (req.headers.get("x-feed-secret") || "").trim();
  if (!expected || (auth !== `Bearer ${expected}` && supplied !== expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await mediaDb();
  const token = mediaBotToken();
  if (!db || !token) return NextResponse.json({ error: "media service not configured" }, { status: 503 });

  const { data, error } = await db.from("media_feed")
    .select("id,file_id,title")
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: "feed scan failed" }, { status: 500 });

  let checked = 0;
  const deleted: { id: string; reason: string }[] = [];
  for (const row of data || []) {
    if (!row.file_id) continue;
    checked++;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(row.file_id)}`,
        { cache: "no-store", signal: AbortSignal.timeout(7000) }
      );
      const result = await response.json().catch(() => null);
      if (result?.ok && result?.result?.file_path) continue;
      const description = String(result?.description || "").toLowerCase();
      // Delete only Telegram's explicit permanent invalid-file responses.
      // Never delete on "file is too big", 429, 5xx, timeout or generic failure.
      const permanentInvalid = /wrong file identifier|invalid file_id|file_id is invalid|file not found|file identifier .* not found/.test(description);
      if (!permanentInvalid) continue;
      const removal = await db.from("media_feed").delete().eq("id", row.id).eq("file_id", row.file_id).select("id");
      if (!removal.error && removal.data?.length) deleted.push({ id: String(row.id), reason: "telegram-file-invalid" });
    } catch {
      // Temporary network errors must never trigger deletion.
    }
  }

  return NextResponse.json({ ok: true, checked, deleted_count: deleted.length, deleted });
}
