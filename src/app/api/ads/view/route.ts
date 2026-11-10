import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAdEvent } from "@/lib/adStats";
import { isMachineUserAgent } from "@/lib/botUserAgent";
import { pgRateLimit } from "@/lib/match/rateLimitPg";

// One view per visitor per ad per 30 minutes (IP-keyed); machine user agents are not counted.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.c || "").toUpperCase().slice(0, 40);
  if (!code || isMachineUserAgent(req.headers.get("user-agent") || "")) return NextResponse.json({ ok: true });
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  if (!(await pgRateLimit(`adview:${code}:${ip}`, 1, 1800))) return NextResponse.json({ ok: true });
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code }, select: { adStatus: true } }).catch(() => null);
  if (ad?.adStatus === "ACTIVE") await recordAdEvent(code, "view");
  return NextResponse.json({ ok: true });
}
