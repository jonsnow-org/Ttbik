// Server-side index of every coin launched through the master: read from the chain once, kept in a snapshot, served to every visitor
// (the browser used to scan the chain itself through a keyless 1 request/second endpoint, which cannot carry real traffic).
// Bundled for Node by build.mjs into src/lib/vendor/znbtIndexer.cjs. Read-only: nothing here signs or sends anything.
import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import { LaunchpadV2 } from '../../sdk/dist/index.js';
import { CreateLaunch } from '../../sdk/dist/generated/BondingCurveMasterV2.gen.js';
import { readMeta } from './meta';

export interface IndexedCoin {
  curve: string; creator: string; salt: string; name: string; symbol: string; description: string; image: string;
  supply: string; creatorFeeBps: number; createdAt: number;
  features?: { shape: number; maxBuyBps: number; buyback: boolean; split: boolean };   // advanced launch options chosen by the creator (fixed on chain)
  minter?: string;           // the coin's jetton minter (for holders and portfolio)
  state?: number;            // 1 = on the curve, 2+ = graduated
  raisedNano?: string; thresholdNano?: string; tokensPerTon?: string; statsAt?: number;
}
export interface Snapshot { coins: IndexedCoin[]; updatedAt: number; scannedTo?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshIndex(opts: { master: string; prev: Snapshot | null; apiKey?: string; budgetMs: number }): Promise<Snapshot> {
  const t0 = Date.now();
  const gap = opts.apiKey ? 150 : 1200;                       // toncenter: ~10 requests/s with a key, ~1/s without
  const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: opts.apiKey });
  const sdk = new LaunchpadV2((a: Address) => client.provider(a));
  const master = Address.parse(opts.master);
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let i = 0; i < 4; i++) {
      try { const r = await fn(); await sleep(gap); return r; } catch (e) { last = e; await sleep(gap * (i + 2)); }
    }
    throw last;
  };
  const known = new Map<string, IndexedCoin>((opts.prev?.coins ?? []).map((c) => [c.creator + ':' + c.salt, c]));
  const coins = new Map<string, IndexedCoin>(known);

  // 1. launches sent to the master (newest 100 transactions), identity of every coin once
  const txs = await call(() => client.getTransactions(master, { limit: 100, archival: true }));
  for (const tx of txs) {
    if (Date.now() - t0 > opts.budgetMs * 0.6) break;
    const m = tx.inMessage;
    if (!m || m.info.type !== 'internal') continue;
    const desc: any = tx.description;
    if (desc.type !== 'generic' || desc.aborted || desc.computePhase?.type !== 'vm' || !desc.computePhase.success) continue;
    let body: CreateLaunch;
    try { body = CreateLaunch.fromSlice(m.body.beginParse()); } catch { continue; }
    const creator = (m.info.src as Address).toString({ bounceable: false });
    const key = creator + ':' + body.salt.toString();
    if (coins.has(key)) continue;
    // body.options is already the on-chain options struct: ask the master directly (sdk.getLaunchAddress expects the user-level preset and rejected real launches with "Invalid launch preset")
    const curve = await call(() => sdk.master(master).getLaunchAddress(m.info.src as Address, body.salt, body.options as any));
    const o = body.options.ref;
    coins.set(key, { curve: curve.toString({ bounceable: true }), creator, salt: body.salt.toString(), ...readMeta(body.metadata), features: { shape: Number(o.reserveRatio), maxBuyBps: Number(o.maxBuyBps), buyback: !!o.buybackBurn, split: !!o.beneficiaries }, supply: o.supply.toString(), creatorFeeBps: Number(o.creatorFeeBps), createdAt: tx.now });
  }

  // 2. live numbers, oldest statistics first, within the time budget
  const order = [...coins.values()].sort((a, b) => (a.statsAt ?? 0) - (b.statsAt ?? 0));
  for (const c of order) {
    if (Date.now() - t0 > opts.budgetMs) break;
    try {
      const curve = Address.parse(c.curve);
      const d = await call(() => sdk.getCurveData(curve));
      const q = Number(d.state) === 1 ? await call(() => sdk.quoteBuy(curve, 1_000_000_000n)) : 0n;
      Object.assign(c, { minter: d.jettonMinter ? d.jettonMinter.toString({ bounceable: true }) : c.minter, state: Number(d.state), raisedNano: d.realTonReserve.toString(), thresholdNano: d.graduationThreshold.toString(), tokensPerTon: q.toString(), statsAt: Math.floor(Date.now() / 1000) });
    } catch { /* keep the previous numbers; the next run tries again */ }
  }
  return { coins: [...coins.values()].sort((a, b) => b.createdAt - a.createdAt), updatedAt: Math.floor(Date.now() / 1000) };
}
