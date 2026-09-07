import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_PLANS = ["PRO_BASIC", "PRO_PLUS", "PRO_ULTRA"];

// Manual override for the owner — grants/revokes a paid tier or resets
// today's/this week's quota without touching Supabase's raw table
// editor. Complements (doesn't replace) the automatic NOWPayments
// activation in /api/payments/nova-webhook — this is for goodwill
// grants, support cases, or activating someone who paid outside the
// automated flow.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "grant_pro") {
    const plan = String(body.plan || "");
    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: `plan must be one of ${VALID_PLANS.join(", ")}` }, { status: 400 });
    }
    const days = Math.max(1, Math.min(365, Number(body.days) || 30));
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
    const user = await prisma.novaUser.update({
      where: { id: params.id },
      data: { plan, subscriptionExpiresAt: expiresAt },
    });
    return NextResponse.json({ ok: true, user });
  }

  if (action === "revoke_pro") {
    const user = await prisma.novaUser.update({
      where: { id: params.id },
      data: { plan: "FREE", subscriptionExpiresAt: null },
    });
    return NextResponse.json({ ok: true, user });
  }

  if (action === "reset_quota") {
    const now = new Date();
    const user = await prisma.novaUser.update({
      where: { id: params.id },
      data: {
        dailyUsed: 0,
        dailyUsedImage: 0,
        dailyResetAt: now,
        weeklyUsedText: 0,
        weeklyUsedImage: 0,
        weeklyResetAt: now,
      },
    });
    return NextResponse.json({ ok: true, user });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
