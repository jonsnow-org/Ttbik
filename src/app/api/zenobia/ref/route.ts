import { NextRequest, NextResponse } from "next/server";
import { invitedCount, tgUserFromInit } from "@/lib/znbtEngage";
import { REWARD_DAYS, REWARD_SHARE_BPS, accountOf, fmtNano } from "@/lib/znbtRefs";

// The user's own invite link, how many people joined through it, and the reward balance credited to them.
export const dynamic = "force-dynamic";
const BOT = (process.env.NEXT_PUBLIC_PLATFORM_BOT_URL || "https://t.me/PalmyraLaunchBot").trim().replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const tg = await tgUserFromInit(req.headers.get("x-tg-init") || "");
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  const acc = await accountOf(tg).catch(() => null);
  return NextResponse.json({
    link: `${BOT}?start=ref_${tg}`,
    invited: await invitedCount(tg).catch(() => 0),
    wallet: acc?.wallet ?? null,
    earned: acc ? fmtNano(acc.earned) : "0.000",
    pending: acc ? fmtNano(acc.pending) : "0.000",
    paid: acc ? fmtNano(acc.paid) : "0.000",
    sharePct: REWARD_SHARE_BPS / 100,
    days: REWARD_DAYS,
  });
}
