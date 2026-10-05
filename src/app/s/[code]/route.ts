import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const code = (params.code || "").trim();
  if (!code || code.length > 16) {
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app"));
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

    return NextResponse.redirect(link.targetUrl, 302);
  } catch {
    return new NextResponse("خطأ مؤقت", { status: 503 });
  }
}
