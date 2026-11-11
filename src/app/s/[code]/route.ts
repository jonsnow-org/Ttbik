import { isLegacySiteUrl, publicSiteUrl, rewriteLegacyLinks } from "@/lib/siteUrl";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const code = (params.code || "").trim();
  if (!code || code.length > 16) {
    return NextResponse.redirect(new URL("/", publicSiteUrl()));
  }

  try {
    const link = await prisma.shortLink.findUnique({ where: { code } });
    if (!link) {
      return new NextResponse("الرابط غير موجود أو انتهت صلاحيته", { status: 404 });
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      return new NextResponse("انتهت صلاحية هذا الرابط", { status: 410 });
    }

    // atomic click increment (best-effort; race is acceptable)
    await prisma.shortLink.update({
      where: { code },
      data: { clicks: { increment: 1 } },
    });

    // a short link made while the site lived on ttbik.vercel.app (402 since 2026-11-11) goes to the same path on the live address
    return NextResponse.redirect(isLegacySiteUrl(link.targetUrl) ? rewriteLegacyLinks(link.targetUrl) : link.targetUrl, 302);
  } catch {
    return new NextResponse("خطأ مؤقت", { status: 503 });
  }
}
