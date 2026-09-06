import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const subscriptions = await prisma.novaSubscription.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: { novaUser: true },
    orderBy: { created_at: "desc" },
    take: 100,
  });
  return NextResponse.json({ subscriptions });
}
