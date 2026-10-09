import { NextRequest, NextResponse } from "next/server";
import { publishRotation, type RotationResult } from "@/lib/channelRotation";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";

export const maxDuration = 60;

/**
 * Channel cron every 2 hours. Quiet hours 23:00-07:00 Istanbul are skipped.
 * Literium once every 2 days, Athar once every 3 days.
 * No title or link repeat inside 48 hours. No profit promises.
 * Literium and Athar use one uploaded card each (adult presenter + the tool UI).
 * No Pollinations and no random image fetch. Other posts are Arabic text plus the link only.
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

  const hourIstanbul = (new Date().getUTCHours() + 3) % 24;
  if (hourIstanbul < 7 || hourIstanbul >= 23) {
    return NextResponse.json({ ok: true, skipped: "quiet-hours", hourIstanbul });
  }
  const slot = ((hourIstanbul - 7) % 3) + 1;
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
