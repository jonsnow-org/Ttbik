import { prisma } from "@/lib/prisma";

export type ConfessionUnlockField = "revealSenderUnlocked" | "unlimitedRepliesUnlocked";
export type ConfessionUnlockResult = {
  ok: boolean;
  alreadyUnlocked: boolean;
  balance: number;
  user: any | null;
};

/**
 * Charge and activate a permanent confession upgrade in one transaction.
 *
 * The conditional UPDATE checks both balance >= price and the unlock flag
 * still being false. This makes rapid/double Telegram taps safe: only one
 * request can debit the user and create a charge record. The flag and ledger
 * row roll back together if any step fails.
 */
export async function chargeAndUnlockConfessionUser(
  userId: string,
  amount: number,
  type: string,
  field: ConfessionUnlockField,
): Promise<ConfessionUnlockResult> {
  return prisma.$transaction(async (tx: any) => {
    const where: Record<string, unknown> = {
      id: userId,
      balance: { gte: amount },
      [field]: false,
    };
    const data: Record<string, unknown> = {
      balance: { decrement: amount },
      [field]: true,
    };
    const changed = await tx.confessionUser.updateMany({ where, data });
    if (changed.count !== 1) {
      const user = await tx.confessionUser.findUnique({ where: { id: userId } });
      const unlocked = !!user?.[field];
      return {
        ok: unlocked,
        alreadyUnlocked: unlocked,
        balance: Number(user?.balance || 0),
        user,
      };
    }

    await tx.confessionTransaction.create({
      data: { userId, amount, currency: "internal", type, status: "COMPLETED" },
    });
    const user = await tx.confessionUser.findUnique({ where: { id: userId } });
    return {
      ok: true,
      alreadyUnlocked: false,
      balance: Number(user?.balance || 0),
      user,
    };
  });
}
