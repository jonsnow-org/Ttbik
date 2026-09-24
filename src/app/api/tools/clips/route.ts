import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { clipsFor, pexelsConfigured, storeSize } from "@/lib/rumoozStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET → how big the footage store is. */
export async function GET() {
  try {
    return NextResponse.json({ ...(await storeSize()), configured: pexelsConfigured() });
  } catch {
    return NextResponse.json({ queries: 0, clips: 0, configured: pexelsConfigured() });
  }
}

/** POST {queries: string[]} → real clips for each English concept query. */
export async function POST(req: NextRequest) {
  if (!pexelsConfigured()) return NextResponse.json({ error: "no_key" }, { status: 503 });
  if (isRateLimited(`clips:${requestIp(req)}`, 30, 10 * 60_000)) {
    return NextResponse.json({ error: "طلبات كثيرة، انتظر دقائق" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { queries?: unknown };
  const queries = [...new Set((Array.isArray(body.queries) ? body.queries : []).map((q) => String(q).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()))]
    .filter(Boolean)
    .slice(0, 16);
  if (!queries.length) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const results: Record<string, Awaited<ReturnType<typeof clipsFor>>> = {};
    // a few at a time: most are served from the store, the rest go to Pexels
    for (let i = 0; i < queries.length; i += 4) {
      const batch = queries.slice(i, i + 4);
      const found = await Promise.all(batch.map((q) => clipsFor(q).catch(() => [])));
      batch.forEach((q, k) => (results[q] = found[k]));
    }
    return NextResponse.json({ results });
  } catch (e) {
    console.error("clips", e);
    return NextResponse.json({ error: "الخدمة غير متاحة مؤقتاً" }, { status: 503 });
  }
}
