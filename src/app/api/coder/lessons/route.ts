// The owner's successful Nova runs as JSON Lines, for the manual "publish lessons" workflow (.github/workflows/nova-publish-lessons.yml).
// Same Bearer CRON_SECRET check as the schedules tick. Read-only: nothing is changed or sent anywhere from here.
import { NextRequest, NextResponse } from "next/server";
import { exportLessons } from "@/lib/coderLessons";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jsonl, count } = await exportLessons(undefined, 2000, 8_000_000);
  return new NextResponse(jsonl, { headers: { "Content-Type": "application/x-ndjson", "X-Lessons-Count": String(count), "Cache-Control": "no-store" } });
}
