// How many Nova tasks are running right now. Read by the Oracle updater (deploy/oracle/agent/updater.sh) from inside the site container
// with the server's own CRON_SECRET, so a deploy waits for running tasks instead of cutting them. Nothing is changed here.
import { NextRequest, NextResponse } from "next/server";
import { activeTaskCount } from "@/lib/coderTasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ busy: await activeTaskCount() }, { headers: { "Cache-Control": "no-store" } });
}
