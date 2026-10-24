// The single dispatcher of the coder's scheduled tasks (src/lib/coderSchedules.ts). Called every 5 minutes by the free GitHub Actions
// scheduler (.github/workflows/coder-schedules.yml) with CRON_SECRET; a Vercel Cron GET with the same secret works too (Hobby: daily only).
// Each tick also does one piece of the threads' quiet-time work. It claims the due rows and fans out one signed request per run, so each run gets its own function invocation.
import { NextRequest, NextResponse } from "next/server";
import { runCoderTick } from "@/lib/coderTick";

export const maxDuration = 300;   // the quiet-time work (a model call on the free CPU Studio) runs after the answer and needs minutes
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  return !!secret && auth === `Bearer ${secret}`;
}

async function tick(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runCoderTick());
}
export const GET = tick;
export const POST = tick;
