import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeTargetUrl } from "@/lib/watchTarget";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const click = await prisma.adClick.findUnique({ where: { id: token } }).catch(() => null);
  if (!click) return NextResponse.json({ error: "رابط المهمة غير صالح." }, { status: 404 });

  const ad = await prisma.ad.findUnique({ where: { id: click.adId } }).catch(() => null);
  if (!ad || ad.status !== "ACTIVE" || (Number(ad.cpc) > 0 && Number(ad.remaining) < Number(ad.cpc))) {
    return NextResponse.json({ error: "هذا الإعلان لم يعد متاحاً." }, { status: 410 });
  }

  // Channel and group membership is verified directly through Telegram and
  // must never be converted to a timed visit. Telegram bot targets are valid
  // here because the redirect carries the unique ad verification payload.
  if (ad.type === "TELEGRAM") {
    const handle = String(ad.content || "").trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/^(t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    if (!/bot$/i.test(handle)) {
      return NextResponse.json({ error: "انضمام قنوات تيليجرام يتم التحقق منه مباشرة داخل البوت." }, { status: 400 });
    }
  }

  const target = normalizeTargetUrl(ad.type, ad.content, click.id);
  let parsed: URL;
  try { parsed = new URL(target); } catch {
    return NextResponse.json({ error: "رابط الإعلان غير صالح." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "نوع الرابط غير مدعوم." }, { status: 400 });
  }

  // The timestamp is issued only by this explicit POST (a user-activated
  // form submission), never by rendering the watch card or its page preview.
  await prisma.adClick.update({
    where: { id: click.id },
    data: { issuedAt: new Date(), verified: true },
  });
  return NextResponse.redirect(target, 303);
}
