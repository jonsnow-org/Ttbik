import { NextResponse } from "next/server";
import { cleanupExpiredFakeChats } from "@/lib/matchBotLogic";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const cleaned = await cleanupExpiredFakeChats();
  return NextResponse.json({ ok: true, cleaned });
}
