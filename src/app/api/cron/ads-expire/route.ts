import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();
  const result = await prisma.siteBannerAd.updateMany({
    where: { adStatus: "ACTIVE", endsAt: { lte: now } },
    data: { adStatus: "EXPIRED" },
  });
  return NextResponse.json({ expired: result.count });
}
