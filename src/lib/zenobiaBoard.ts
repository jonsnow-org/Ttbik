import { rawAddress } from "@/lib/zenobiaSeason";

/**
 * The Caravan Board: who has held ZNB the longest, from the daily holder snapshots. Wallet based: no Telegram, no account.
 * Rank = consecutive days holding (up to the latest snapshot), then the larger balance. It is a ranking and a title ladder only:
 * no reward, no promise. Addresses holding at least `maxShare` of the supply (liquidity pools, the launch curve, big contracts) are not ranked.
 */
export interface BoardRow { day: string; owner: string; balance: bigint }
export interface BoardEntry { owner: string; days: number; balance: bigint; rank: number }

const DAY = 86400000;

export function buildBoard(rows: BoardRow[], opts: { maxShare?: number } = {}): { latest: string | null; supply: bigint; holders: number; entries: BoardEntry[] } {
  const maxShare = opts.maxShare ?? 0.1;
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const latest = days.at(-1) ?? null;
  if (!latest) return { latest: null, supply: 0n, holders: 0, entries: [] };
  const byOwner = new Map<string, Map<string, bigint>>();
  for (const r of rows) {
    if (r.balance <= 0n) continue;
    const m = byOwner.get(r.owner) ?? new Map<string, bigint>();
    m.set(r.day, r.balance);
    byOwner.set(r.owner, m);
  }
  let supply = 0n;
  for (const m of byOwner.values()) supply += m.get(latest) ?? 0n;
  const entries: BoardEntry[] = [];
  for (const [owner, m] of byOwner) {
    const bal = m.get(latest);
    if (bal === undefined) continue; // not holding now
    if (supply > 0n && Number((bal * 10000n) / supply) / 10000 >= maxShare) continue; // pools and contracts
    let days = 0;
    for (let t = Date.parse(latest); m.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) days += 1;
    entries.push({ owner, days, balance: bal, rank: 0 });
  }
  entries.sort((a, b) => b.days - a.days || (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : a.owner < b.owner ? -1 : 1));
  entries.forEach((e, i) => { e.rank = i + 1; });
  return { latest, supply, holders: byOwner.size, entries };
}

export const shortAddr = (raw: string) => { try { const a = rawAddress(raw); return a.slice(0, 6) + "…" + a.slice(-4); } catch { return raw.slice(0, 6) + "…"; } };
