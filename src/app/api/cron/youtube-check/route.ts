import { NextRequest, NextResponse } from "next/server";
import { youtubeCheck } from "@/lib/youtubePublish";

// Read-only: tries the stored YouTube refresh token against Google and reports Google's own answer (ok, invalid_grant, invalid_client, ...),
// without uploading anything and without returning any credential. Header auth only (Authorization: Bearer CRON_SECRET).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await youtubeCheck());
}
