// The single dispatcher of the coder's scheduled tasks (src/lib/coderSchedules.ts). Called every 5 minutes by the free GitHub Actions
// scheduler (.github/workflows/coder-schedules.yml) with CRON_SECRET; a Vercel Cron GET with the same secret works too (Hobby: daily only).
// It claims the due rows and fans out one signed request per run, so each run gets its own function invocation.
import { NextRequest, NextResponse } from "next/server";
import { claimDue, fanOut } from "@/lib/coderSchedules";
import { selfUrl } from "@/lib/coderSections";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  return !!secret && auth === `Bearer ${secret}`;
}

async function tick(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claimed = await claimDue().catch(() => []);
  const sent = await fanOut(claimed, selfUrl());
  return NextResponse.json({ due: claimed.length, sent: sent.filter((x) => x.ok).length, failed: sent.filter((x) => !x.ok).map((x) => x.id) });
}
export const GET = tick;
export const POST = tick;
