/** The ledger wallet that mints passports (its address is public: it is the admin of the passport collection). */
export const LEDGER_RAW = "0:9eb094e339a542fdcae8bd2800bd3adb4fa9fbeceaa4b694ab46c7bf4cfeac91";

const headers = (apiKey?: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

/** Read-only: does this wallet hold any of the coin? */
export async function holdsCoin(wallet: string, jetton: string, opts: { fetchFn?: typeof fetch; apiKey?: string; minBalance?: bigint } = {}): Promise<boolean> {
  const f = opts.fetchFn ?? fetch;
  const res = await f(`https://tonapi.io/v2/accounts/${encodeURIComponent(wallet)}/jettons/${encodeURIComponent(jetton)}`, { headers: headers(opts.apiKey) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`tonapi ${res.status}`);
  const body = (await res.json()) as { balance?: string };
  try { return BigInt(body.balance ?? "0") >= (opts.minBalance ?? 1n); } catch { return false; }
}

/** Read-only: does this wallet hold any of the coins (ZNB on Blum, and ZNBt once the owner sets it)? True if at least one holds; throws only when none holds and a lookup failed. */
export async function holdsAnyCoin(wallet: string, jettons: string[], opts: { fetchFn?: typeof fetch; apiKey?: string; minBalance?: bigint } = {}): Promise<boolean> {
  let failed: unknown = null;
  for (const j of jettons) {
    try { if (await holdsCoin(wallet, j, opts)) return true; } catch (e) { failed = e; }
  }
  if (failed) throw failed;
  return false;
}
