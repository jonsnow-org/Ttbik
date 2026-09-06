import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeTargetUrl } from "@/lib/watchTarget";

const REQUIRED_SECONDS = 15;

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const click = await prisma.adClick.findUnique({ where: { id: params.token } });
  if (!click) {
    return NextResponse.json({ ok: false, error: "الرابط غير صالح أو منتهي." }, { status: 404 });
  }
  const ad = await prisma.ad.findUnique({ where: { id: click.adId } });
  if (!ad || ad.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "هذا الإعلان لم يعد متاحاً." }, { status: 410 });
  }
  return NextResponse.json({
    ok: true,
    verified: click.verified,
    issuedAt: click.issuedAt,
    requiredSeconds: REQUIRED_SECONDS,
    targetUrl: normalizeTargetUrl(ad.type, ad.content),
  });
}
