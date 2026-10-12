import { rawAddress } from "@/lib/zenobiaSeason";

/** Read-only: all holders of a jetton from tonapi, summed per owner. */
export async function fetchHolders(
  jetton: string,
  opts: { fetchFn?: typeof fetch; pageSize?: number; delayMs?: number; apiKey?: string; maxPages?: number } = {},
): Promise<Map<string, bigint>> {
  const f = opts.fetchFn ?? fetch;
  const size = opts.pageSize ?? 1000;
  const out = new Map<string, bigint>();
  for (let page = 0; page < (opts.maxPages ?? 50); page++) {
    const res = await f(`https://tonapi.io/v2/jettons/${encodeURIComponent(jetton)}/holders?limit=${size}&offset=${page * size}`, {
      headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : undefined,
    });
    if (!res.ok) throw new Error(`tonapi ${res.status}`);
    const body = (await res.json()) as { addresses?: { owner?: { address?: string }; address: string; balance: string }[]; total?: number };
    const rows = body.addresses ?? [];
    for (const r of rows) {
      const owner = rawAddress(r.owner?.address ?? r.address);
      out.set(owner, (out.get(owner) ?? 0n) + BigInt(r.balance));
    }
    if (rows.length < size || (body.total != null && (page + 1) * size >= body.total)) break;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return out;
}
