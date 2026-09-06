import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Basic anti-multi-accounting: a fingerprint already tied to this many
// OTHER distinct accounts flags the account for review.
const FINGERPRINT_DISTINCT_USER_LIMIT = 2;

// Called via navigator.sendBeacon the instant the /watch page loads, fired
// alongside (not gating) its immediate redirect to the advertiser's link —
// there is no elapsed-time check here anymore. That gate now lives
// server-side in the bot's own "تحقق من الإنجاز" handler, checked directly
// against AdClick.issuedAt, so it no longer depends on this page's JS
// surviving long enough to report back (owner report, 2026-09-06: mobile
// browsers were blocking the page's auto-open as a "popup" before it ever
// got the chance).
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const click = await prisma.adClick.findUnique({ where: { id: params.token } });
  if (!click) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint.slice(0, 256) : null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  if (fingerprint) {
    await prisma.deviceFingerprint.upsert({
      where: { fingerprint_userId: { fingerprint, userId: click.userId } },
      update: { ip },
      create: { fingerprint, userId: click.userId, ip },
    });
    const seen = await prisma.deviceFingerprint.findMany({ where: { fingerprint }, select: { userId: true }, distinct: ["userId"] });
    const otherAccounts = seen.filter((d) => d.userId !== click.userId).length;
    if (otherAccounts >= FINGERPRINT_DISTINCT_USER_LIMIT) {
      await prisma.user.update({ where: { id: click.userId }, data: { multiAccountFlag: true } }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true });
}
