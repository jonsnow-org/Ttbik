import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export const OPEN_WITHDRAWAL_STATUSES = ["PENDING", "PENDING_AUDIT"];

/**
 * Atomic "spend" of a wallet balance: the WHERE clause is evaluated by
 * Postgres as part of the UPDATE (row-locked), so two concurrent spends can
 * never both pass a stale in-JS balance check and spend the same money twice.
 * Returns false (nothing changed) when the balance is too low.
 */
export async function debitUserBalance(tx: Tx, userId: string, amount: number): Promise<boolean> {
  const r = await tx.user.updateMany({ where: { id: userId, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
  return r.count === 1;
}

/** Same as debitUserBalance, for a bot supervisor's withdrawable commission. */
export async function debitBotOwnerBalance(tx: Tx, botId: string, amount: number): Promise<boolean> {
  const r = await tx.bot.updateMany({ where: { id: botId, ownerBalance: { gte: amount } }, data: { ownerBalance: { decrement: amount } } });
  return r.count === 1;
}

/**
 * Creates a withdrawal request and takes its amount out of the right balance
 * in ONE database transaction. Before, the balance was read, checked in JS and
 * then overwritten with an absolute value: two quick requests both saw the full
 * balance, both created a request, and the balance was only reduced once.
 */
export async function requestWithdrawal(p: {
  userId: string;
  botId?: string;
  amount: number;
  destination: string;
  audit: boolean;
}): Promise<{ ok: true; id: string } | { ok: false }> {
  const owner = !!p.botId;
  return prisma.$transaction(async (tx) => {
    const debited = owner ? await debitBotOwnerBalance(tx, p.botId as string, p.amount) : await debitUserBalance(tx, p.userId, p.amount);
    if (!debited) return { ok: false as const };
    const row = await tx.transaction.create({
      data: {
        userId: p.userId,
        ...(owner ? { botId: p.botId } : {}),
        amount: p.amount,
        currency: "internal",
        type: owner ? "OWNER_WITHDRAWAL" : "WITHDRAWAL",
        status: p.audit ? "PENDING_AUDIT" : "PENDING",
        destination: p.destination,
      },
    });
    return { ok: true as const, id: row.id };
  });
}

/**
 * Takes exclusive ownership of an open withdrawal request. Only ONE caller can
 * move it out of its open status, so a repeated "موافقة"/"رفض" message (or two
 * admins answering at once) cannot approve, send or refund it twice.
 */
export async function claimWithdrawal(id: string, from: string, to: string): Promise<boolean> {
  const r = await prisma.transaction.updateMany({ where: { id, status: from }, data: { status: to } });
  return r.count === 1;
}

/** Gives a claimed request back to its open status (a send that definitely failed). */
export async function releaseWithdrawalClaim(id: string, claimedStatus: string, backTo: string): Promise<void> {
  await prisma.transaction.updateMany({ where: { id, status: claimedStatus }, data: { status: backTo } });
}

/**
 * Rejects an open withdrawal and returns its amount to where it came from
 * (the supervisor's commission or the user's balance) exactly once, using an
 * atomic increment instead of overwriting the balance with a stale read.
 */
export async function rejectWithdrawal(w: { id: string; userId: string; botId: string | null; type: string; amount: number }): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({ where: { id: w.id, status: { in: OPEN_WITHDRAWAL_STATUSES } }, data: { status: "FAILED" } });
    if (r.count !== 1) return false;
    if (w.type === "OWNER_WITHDRAWAL" && w.botId) {
      await tx.bot.update({ where: { id: w.botId }, data: { ownerBalance: { increment: Number(w.amount) } } });
    } else {
      await tx.user.update({ where: { id: w.userId }, data: { balance: { increment: Number(w.amount) } } });
    }
    return true;
  });
}
