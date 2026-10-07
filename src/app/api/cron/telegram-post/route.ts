import { NextRequest, NextResponse } from "next/server";
import { publishRotation, type RotationResult } from "@/lib/channelRotation";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";

export const maxDuration = 60;

/**
 * Channel cron (vercel.json, three slots/day).
 * Owner list, 2026-10-07: Sham AI news, events, articles and tools,
 * Literium (https://literium.ai.studio/) once every 2 days, Athar on
 * Getgems once every 3 days. No title/link repeat inside 2 days.
 * Each post is a generated still of a man or woman plus Arabic caption
 * and the link. Athar copy must not promise profit. Video generation is
 * not used here: free GPU lanes miss the 60s cron budget.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized =
    !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channel) {
    return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });
  }

  await ensureFrontDoor().catch(() => null);

  const slot = Math.min(3, Math.max(1, Number(req.nextUrl.searchParams.get("slot") || "2") || 2));
  let result: RotationResult;
  try {
    result = await publishRotation(slot);
  } catch (e) {
    console.error("[telegram-post] publishRotation failed", e);
    result = { ok: false, slot, reason: "exception" };
  }
  if (result.ok && result.text && !isSafeForChannel(result.text)) {
    return NextResponse.json({ ok: false, slot, topic: result.topic, blocked: true });
  }
  return NextResponse.json(result);
}
