import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({ user, recentLogs });
}
