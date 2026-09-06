import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Real visibility into what people are actually asking Nova — reads the
// same message/answer columns the Kaggle notebook fetches for training
// data (prisma/migration_20_nova_training_log.sql).
export async function GET() {
  const logs = await prisma.novaUsageLog.findMany({
    where: { message: { not: null } },
    include: { novaUser: { select: { telegramId: true, email: true } } },
    orderBy: { created_at: "desc" },
    take: 50,
  });
  return NextResponse.json({ logs });
}
