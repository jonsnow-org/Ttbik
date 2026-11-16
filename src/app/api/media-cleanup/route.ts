import { NextRequest, NextResponse } from "next/server";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TOO_BIG_GRACE_MS = 24 * 3600_000;
const SCAN_LIMIT = 300;
const PARALLEL = 8;

// Daily integrity sweep: posts that can never play are removed from the feed.
//  - Telegram says the file identifier is permanently invalid -> removed.
//  - Telegram says "file is too big" (over the 20MB Bot API download limit, so the Mini App cannot stream it) -> removed once the post is
//    older than TOO_BIG_GRACE_MS: the bot's /refeed (and every new upload) first replaces such a clip with a compressed streamable copy.
// Rate limits, 5xx and network errors are never treated as proof that a post is broken.
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
    .select("id,file_id,title,created_at")
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .limit(SCAN_LIMIT);
  if (error) return NextResponse.json({ error: "feed scan failed" }, { status: 500 });

  let checked = 0;
  const deleted: { id: string; reason: string }[] = [];
  const rows = (data || []).filter((r: any) => r.file_id);
  async function inspect(row: any) {
    checked++;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(row.file_id)}`,
        { cache: "no-store", signal: AbortSignal.timeout(7000) }
      );
      const result = await response.json().catch(() => null);
      if (result?.ok && result?.result?.file_path) return;
      const description = String(result?.description || "").toLowerCase();
      const permanentInvalid = /wrong file identifier|invalid file_id|file_id is invalid|file not found|file identifier .* not found/.test(description);
      const age = Date.now() - new Date(row.created_at || 0).getTime();
      const tooBigAndStale = /file is too big/.test(description) && age > TOO_BIG_GRACE_MS;
      if (!permanentInvalid && !tooBigAndStale) return; // 429, 5xx, timeouts, young too-big posts: leave alone
      const removal = await db!.from("media_feed").delete().eq("id", row.id).eq("file_id", row.file_id).select("id");
      if (!removal.error && removal.data?.length) deleted.push({ id: String(row.id), reason: permanentInvalid ? "telegram-file-invalid" : "too-big-for-streaming" });
    } catch {
      // Temporary network errors must never trigger deletion.
    }
  }
  for (let i = 0; i < rows.length; i += PARALLEL) await Promise.all(rows.slice(i, i + PARALLEL).map(inspect));

  return NextResponse.json({ ok: true, checked, deleted_count: deleted.length, deleted });
}
