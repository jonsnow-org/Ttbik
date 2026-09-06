import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Automatically protected by src/middleware.ts (matcher covers /api/admin/:path*)
// — same ADMIN_PASSWORD cookie gate as every other /api/admin/* route, no
// extra auth code needed here.
export const dynamic = "force-dynamic";

export async function GET() {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [totalUsers, proUsers, pendingSubs, messages24h, messages7d, byChannel, byQueryType] = await Promise.all([
    prisma.novaUser.count(),
    prisma.novaUser.count({ where: { plan: "PRO" } }),
    prisma.novaSubscription.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.novaUsageLog.count({ where: { created_at: { gte: since24h } } }),
    prisma.novaUsageLog.count({ where: { created_at: { gte: since7d } } }),
    prisma.novaUsageLog.groupBy({ by: ["channel"], _count: { _all: true } }),
    prisma.novaUsageLog.groupBy({ by: ["queryType"], _count: { _all: true } }),
  ]);

  return NextResponse.json({
    totalUsers,
    proUsers,
    freeUsers: totalUsers - proUsers,
    pendingSubscriptions: pendingSubs,
    messages24h,
    messages7d,
    byChannel: byChannel.map((c) => ({ channel: c.channel, count: c._count._all })),
    byQueryType: byQueryType.map((q) => ({ queryType: q.queryType, count: q._count._all })),
  });
}
