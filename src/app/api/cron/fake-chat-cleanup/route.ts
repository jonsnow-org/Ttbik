import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredFakeChats } from "@/lib/matchBotLogic";
import { isCronAuthorized } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cleaned = await cleanupExpiredFakeChats();
  return NextResponse.json({ ok: true, cleaned });
}
