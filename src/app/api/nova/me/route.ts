import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FASTAPI_URL = process.env.NOVA_FASTAPI_URL || "";

// Public, but gated by possession of the unguessable NovaUser UUID — same
// trust model this project already uses for /pay/marriage?uid=,
// /pay/jobs?uid=, /watch/[token], etc. (an unguessable id as an implicit
// bearer credential, not a full username/password account system).
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid") || "";
  if (!uid) return NextResponse.json({ error: "missing uid" }, { status: 400 });

  const user = await prisma.novaUser.findUnique({ where: { id: uid } });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recentLogs = await prisma.novaUsageLog.findMany({
    where: { novaUserId: uid, message: { not: null } },
    orderBy: { created_at: "desc" },
    take: 20,
  });

  // Tiered-plan limits (ai-system/app/quota.py's PLANS dict) so the
  // dashboard can show real remaining-quota numbers instead of a
  // hardcoded constant that drifts from the actual backend config.
  let plans: Record<string, unknown> = {};
  if (FASTAPI_URL) {
    try {
      const plansRes = await fetch(`${FASTAPI_URL}/plans`, { cache: "no-store" });
      const plansData = await plansRes.json();
      plans = plansData.plans || {};
    } catch {
      /* dashboard falls back to hiding quota numbers if this fails */
    }
  }

  return NextResponse.json({ user, recentLogs, plans });
}
