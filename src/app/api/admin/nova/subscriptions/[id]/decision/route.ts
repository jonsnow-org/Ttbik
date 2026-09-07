import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  const subscription = await prisma.novaSubscription.findUnique({ where: { id: params.id } });
  if (!subscription) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "approve") {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    await prisma.novaSubscription.update({
      where: { id: params.id },
      data: { status: "ACTIVE", approvedBy: "ADMIN_PANEL", startedAt: now, expiresAt },
    });
    await prisma.novaUser.update({
      where: { id: subscription.novaUserId },
      data: { plan: subscription.plan, subscriptionExpiresAt: expiresAt },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    await prisma.novaSubscription.update({ where: { id: params.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
