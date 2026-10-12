import { rawAddress } from "@/lib/zenobiaSeason";

/** The ledger wallet that mints passports (its address is public: it is the admin of the passport collection). */
export const LEDGER_RAW = "0:9eb094e339a542fdcae8bd2800bd3adb4fa9fbeceaa4b694ab46c7bf4cfeac91";
/** What a holder pays for a passport: covers the 0.03 the mint costs the ledger plus network fees. Nothing more is promised for it. */
export const PASSPORT_PRICE_NANO = 60_000_000n; // 0.06 GRAM

export const payComment = (tgUserId: string) => `ZNBP-${tgUserId}`;

interface TonapiTx { hash?: string; success?: boolean; in_msg?: { source?: { address?: string }; value?: number | string; decoded_body?: { text?: string } } }

const headers = (apiKey?: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

/** Read-only: does this wallet hold any of the coin? */
export async function holdsCoin(wallet: string, jetton: string, opts: { fetchFn?: typeof fetch; apiKey?: string } = {}): Promise<boolean> {
  const f = opts.fetchFn ?? fetch;
  const res = await f(`https://tonapi.io/v2/accounts/${encodeURIComponent(wallet)}/jettons/${encodeURIComponent(jetton)}`, { headers: headers(opts.apiKey) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`tonapi ${res.status}`);
  const body = (await res.json()) as { balance?: string };
  try { return BigInt(body.balance ?? "0") > 0n; } catch { return false; }
}

/** Read-only: the payment transaction from this person's verified wallet to the ledger, with their comment and at least the price. */
export async function findPayment(wallet: string, tgUserId: string, opts: { fetchFn?: typeof fetch; apiKey?: string; used?: Set<string> } = {}): Promise<string | null> {
  const f = opts.fetchFn ?? fetch;
  const res = await f(`https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(LEDGER_RAW)}/transactions?limit=100`, { headers: headers(opts.apiKey) });
  if (!res.ok) throw new Error(`tonapi ${res.status}`);
  const body = (await res.json()) as { transactions?: TonapiTx[] };
  const me = rawAddress(wallet);
  const want = payComment(tgUserId);
  for (const tx of body.transactions ?? []) {
    const m = tx.in_msg;
    if (!tx.hash || !m || tx.success === false || opts.used?.has(tx.hash)) continue;
    let from: string;
    try { from = rawAddress(m.source?.address ?? ""); } catch { continue; }
    if (from !== me) continue;
    if ((m.decoded_body?.text ?? "").trim() !== want) continue;
    if (BigInt(m.value ?? 0) < PASSPORT_PRICE_NANO) continue;
    return tx.hash;
  }
  return null;
}
