// The owner's USDT receiving wallet: TRON network (TRC20), given by the owner on 2026-11-10.
// It is a public address (not a secret), committed here so every server shows the same one. The servers' env feed from Vercel is down
// (deploy/oracle/agent/env-sync.sh), so a server .env cannot be changed without logging in, and the old USDT_ADDRESS left in env must not win.
// The network is always TRC20 because the address is a TRON address; a USDT_NETWORK env saying ERC20/BEP20 would send buyers' money to the wrong chain.
export const OWNER_USDT_TRC20 = "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn";
export const USDT_NETWORK_LABEL = "TRC20";
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** The address buyers send USDT (TRC20) to. Falls back to env USDT_ADDRESS only if the committed one were ever invalid. */
export function usdtAddress(): string {
  if (TRON.test(OWNER_USDT_TRC20)) return OWNER_USDT_TRC20;
  const e = (process.env.USDT_ADDRESS || "").trim();
  return TRON.test(e) ? e : "";
}
/** Always "TRC20" (the address is on TRON). */
export function usdtNetwork(): string {
  return USDT_NETWORK_LABEL;
}
