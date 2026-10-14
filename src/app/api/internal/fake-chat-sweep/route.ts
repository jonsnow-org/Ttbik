import { NextRequest, NextResponse } from "next/server";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";
import { sweepAnonFilterTimeouts, sweepFakeChats, sweepIdleRandomSessions } from "@/lib/matchBotLogic";

// Called every minute by the Oracle VM agent (deploy/oracle/agent/sweeper.sh).
// Replaces the per-chat 280-second Vercel function while this heartbeat is fresh.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const anonFilterNotices = await sweepAnonFilterTimeouts().catch(() => 0);
    const idleAnonEnded = await sweepIdleRandomSessions().catch(() => 0);
    return NextResponse.json({ ok: true, ...(await sweepFakeChats()), anonFilterNotices, idleAnonEnded });
  } catch (e) {
    console.error("[fake-chat-sweep]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
