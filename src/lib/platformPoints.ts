import { prisma } from "@/lib/prisma";

/**
 * Unified points/rewards ledger — docs/claude-feature-backlog.md item 1.
 * One PlatformPoints balance per real Telegram person (tgUserId), shared
 * across every bot on the platform: earn it in one bot, spend it in
 * another. `botId` on earn/spend calls is recorded on the ledger row only
 * for informational/analytics purposes — it never scopes the balance
 * itself.
 *
 * Every mutation runs inside a DB transaction so the balance and its
 * PlatformPointsTransaction row can never drift apart, the same guarantee
 * User.balance/Transaction already rely on elsewhere in this codebase.
 */

export class InsufficientPointsError extends Error {
  constructor(tgUserId: string, requested: number, available: number) {
    super(`tgUserId ${tgUserId} has ${available} points, cannot spend ${requested}`);
    this.name = "InsufficientPointsError";
  }
}

export async function getPointsBalance(tgUserId: string): Promise<number> {
  const row = await prisma.platformPoints.findUnique({ where: { tgUserId } });
  return row?.balance ?? 0;
}

export async function earnPoints(
  tgUserId: string,
  amount: number,
  reason: string,
  botId?: string
): Promise<number> {
  if (amount <= 0) throw new Error("earnPoints amount must be positive");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.platformPoints.upsert({
      where: { tgUserId },
      update: { balance: { increment: amount } },
      create: { tgUserId, balance: amount },
    });

    await tx.platformPointsTransaction.create({
      data: { tgUserId, botId, amount, reason, balanceAfter: updated.balance },
    });

    return updated.balance;
  });
}

export async function spendPoints(
  tgUserId: string,
  amount: number,
  reason: string,
  botId?: string
): Promise<number> {
  if (amount <= 0) throw new Error("spendPoints amount must be positive");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.platformPoints.findUnique({ where: { tgUserId } });
    const available = existing?.balance ?? 0;
    if (available < amount) {
      throw new InsufficientPointsError(tgUserId, amount, available);
    }

    const updated = await tx.platformPoints.update({
      where: { tgUserId },
      data: { balance: { decrement: amount } },
    });

    await tx.platformPointsTransaction.create({
      data: { tgUserId, botId, amount: -amount, reason, balanceAfter: updated.balance },
    });

    return updated.balance;
  });
}

export async function getPointsHistory(tgUserId: string, limit = 50) {
  return prisma.platformPointsTransaction.findMany({
    where: { tgUserId },
    orderBy: { created_at: "desc" },
    take: limit,
  });
}
