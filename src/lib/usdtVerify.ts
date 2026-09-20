/**
 * Automatic on-chain verification for the manual "USDT (تحويل يدوي)" payment
 * option — owner decision 2026-09-20: manual payment confirmation must be
 * automatic, not admin-reviewed. Since the customer already provides the
 * transaction hash as transferReference, we can check TRON's own public
 * TronGrid API for a real, confirmed USDT-TRC20 transfer to our address
 * instead of trusting the customer's claim or waiting on a human.
 *
 * Only TRC20 (the site's default/configured USDT_NETWORK) is automated.
 * Any other network, or any lookup failure/timeout/mismatch, is treated as
 * "not verified yet" — the caller falls back to the existing manual-review
 * flow, so a TronGrid hiccup can never wrongly approve OR permanently block
 * an order.
 */

// Official USDT (Tether) TRC20 contract address on TRON mainnet — a fixed,
// public constant, not a secret.
const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export interface UsdtVerifyResult {
  ok: boolean;
  reason: string;
}

export function usdtAutoVerifySupported(network: string | null | undefined): boolean {
  return (network || "TRC20").trim().toUpperCase() === "TRC20";
}

/**
 * Looks up the given address's recent TRC20 USDT transfers via TronGrid and
 * checks whether txHash is among them, sent TO our address, with an amount
 * covering expectedUsd (USDT is pegged 1:1 to USD, no FX conversion needed).
 */
export async function verifyTrc20UsdtPayment(
  txHash: string,
  toAddress: string,
  expectedUsd: number
): Promise<UsdtVerifyResult> {
  const hash = (txHash || "").trim().toLowerCase();
  const address = (toAddress || "").trim();
  if (!hash || !address) return { ok: false, reason: "missing tx hash or address" };
  if (!Number.isFinite(expectedUsd) || expectedUsd <= 0) return { ok: false, reason: "invalid amount" };

  try {
    const url =
      `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` +
      `?limit=50&only_confirmed=true&contract_address=${USDT_TRC20_CONTRACT}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, reason: `tron api status ${res.status}` };

    const data = await res.json().catch(() => null);
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    const match = list.find((t) => String(t?.transaction_id || "").toLowerCase() === hash);
    if (!match) return { ok: false, reason: "transaction not found yet for this address" };
    if (String(match.to || "").trim() !== address) {
      return { ok: false, reason: "recipient address mismatch" };
    }

    const decimals = Number(match.token_info?.decimals ?? 6);
    const amount = Number(match.value) / 10 ** decimals;
    if (!(amount >= expectedUsd - 0.01)) {
      return { ok: false, reason: `amount too low: received ${amount}, expected ${expectedUsd}` };
    }

    return { ok: true, reason: "verified on-chain" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "lookup failed" };
  }
}
