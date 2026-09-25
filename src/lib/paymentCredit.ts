import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

/**
 * Records a payment and applies its credit atomically, exactly once.
 *
 * The ledger row (unique txHash / payment id) and the balance/plan change used
 * to be two separate writes: if the first succeeded and the second hit a
 * transient DB error, the gateway's retry found the ledger row, took it as
 * "already credited" and the user never got what they paid for.
 *
 * - duplicate IPN (unique violation)        → "duplicate", nothing changes
 * - credited account row missing (P2025)    → ledger row kept alone if possible + logged
 * - any other error                         → whole thing rolled back, "retry" (answer 500
 *                                             so NOWPayments redelivers and it can succeed)
 */
export async function creditOnce(label: string, record: (tx: Tx) => Promise<unknown>, apply: (tx: Tx) => Promise<unknown>): Promise<"ok" | "duplicate" | "retry"> {
  try {
    await prisma.$transaction(async (tx) => {
      // apply first: the ledger row's foreign key needs the account row, which
      // apply may create (upsert). A duplicate still fails on the ledger insert
      // and rolls the credit back with it.
      await apply(tx);
      await record(tx);
    });
    return "ok";
  } catch (e) {
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "";
    if (code === "P2002") return "duplicate";
    if (code === "P2025") {
      try {
        await prisma.$transaction(async (tx) => {
          await record(tx);
        });
      } catch (e2) {
        const code2 = e2 instanceof Prisma.PrismaClientKnownRequestError ? e2.code : "";
        if (code2 === "P2002") return "duplicate";
        if (code2 === "P2003") {
          // no account row to hang the ledger on either: retrying can't fix that
          console.error(`[${label}] payment for a missing account could not be recorded`, e);
          return "ok";
        }
        console.error(`[${label}] ledger write failed`, e2);
        return "retry";
      }
      console.error(`[${label}] payment recorded but the account to credit is missing`, e);
      return "ok";
    }
    console.error(`[${label}] credit failed, asking the gateway to retry`, e);
    return "retry";
  }
}
