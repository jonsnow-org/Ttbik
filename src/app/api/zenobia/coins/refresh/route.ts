import { NextResponse } from "next/server";
import { isStale, readSnapshot, refreshSnapshot } from "@/lib/znbtIndex";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Public, rate limited: refresh the coin index when it is old. GitHub's scheduled workflow runs only every few hours in practice,
 * so a page that finds the index stale asks for a refresh itself. At most one refresh runs at a time, at most one every 3 minutes
 * (it only re-reads public chain data, so nobody gains anything by calling it more often).
 */
let lastStart = 0;
let running: Promise<unknown> | null = null;

export async function POST() {
  const now = Date.now();
  const snap = await readSnapshot().catch(() => null);
  if (!isStale(snap, now)) return NextResponse.json({ ok: true, refreshed: false, reason: "fresh" });
  if (running) return NextResponse.json({ ok: true, refreshed: false, reason: "running" });
  if (now - lastStart < 3 * 60_000) return NextResponse.json({ ok: true, refreshed: false, reason: "too-soon" });
  lastStart = now;
  running = refreshSnapshot(40_000).catch((e) => { console.error("[znbt-refresh]", e); }).finally(() => { running = null; });
  await running;
  return NextResponse.json({ ok: true, refreshed: true });
}
