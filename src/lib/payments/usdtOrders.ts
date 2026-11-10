// Automatic USDT (TRC20) checkout for the site's own orders (sponsor slots, remittance listings): the money goes straight to the
// owner's wallet (src/lib/usdtWallet.ts), nobody confirms by hand. A TRC20 transfer carries no memo, so each order gets its own exact
// amount (price + a tiny unique suffix, src/lib/chainDeposits.ts) and is marked paid when that exact amount arrives, confirmed, on-chain.
import { checkUserDeposits, createDepositRequest, openPayers, openRequestFor, type Applier } from "@/lib/chainDeposits";

export type UsdtQuote =
  | { ok: true; auto: true; address: string; amount: string; network: "TRC20"; usd: number; expiresInMin: number }
  | { ok: false; error: string };

/** The exact amount to send for order `ref` (e.g. "sponsor:KSP-…"). Reuses the open quote while it is valid. */
export async function usdtQuote(ref: string, usd: number): Promise<UsdtQuote> {
  const open = await openRequestFor(ref, "USDT_TRC20").catch(() => null);
  if (open) return { ok: true, auto: true, address: open.address, amount: open.amount, network: "TRC20", usd: open.usd, expiresInMin: open.expiresInMin };
  const r = await createDepositRequest(ref, "USDT_TRC20", usd);
  if (!r.ok) return { ok: false, error: r.reason === "no_address" ? "محفظة USDT غير مضبوطة." : r.reason === "range" ? "المبلغ خارج الحدود." : "تعذّر إنشاء طلب الدفع الآن، حاول بعد قليل." };
  return { ok: true, auto: true, address: r.address, amount: r.amount, network: "TRC20", usd: r.usd, expiresInMin: r.expiresInMin };
}

/** Looks on-chain for this order's payment; `apply` runs in the same transaction that claims the transfer. */
export async function usdtCheck(ref: string, apply: Applier): Promise<{ paid: boolean; readFailed: boolean }> {
  const r = await checkUserDeposits(ref, apply);
  return { paid: r.credited.length > 0, readFailed: r.readFailed };
}

export { openPayers };
