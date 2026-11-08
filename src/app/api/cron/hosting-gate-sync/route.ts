import { NextRequest, NextResponse } from "next/server";
import { gateUrl, rehookBots } from "@/lib/hostingOps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Keeps every bot's webhook AND Mini App menu button on the gate, so a Vercel outage (HTTP 402/503 "deployment is temporarily paused") never strands a user
 *  who opens the app from the chat. Idempotent: it only changes what is not on the gate yet. Called hourly by .github/workflows/hosting-gate-sync.yml. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await rehookBots(gateUrl(), false);
  return NextResponse.json({ checked: rows.length, changed: rows.filter((r) => r.note === "changed").length, menuChanged: rows.filter((r) => r.menu === "menu changed").length, failed: rows.filter((r) => !r.ok).map((r) => ({ template: r.template, note: r.note })) });
}
