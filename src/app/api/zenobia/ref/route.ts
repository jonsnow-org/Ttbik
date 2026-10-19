import { NextRequest, NextResponse } from "next/server";
import { invitedCount, tgUserFromInit } from "@/lib/znbtEngage";

// The user's own invite link and how many people joined through it. Counting only: no payout is attached to it.
export const dynamic = "force-dynamic";
const BOT = (process.env.NEXT_PUBLIC_PLATFORM_BOT_URL || "https://t.me/PalmyraLaunchBot").trim().replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const tg = await tgUserFromInit(req.headers.get("x-tg-init") || "");
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  return NextResponse.json({ link: `${BOT}?start=ref_${tg}`, invited: await invitedCount(tg).catch(() => 0) });
}
