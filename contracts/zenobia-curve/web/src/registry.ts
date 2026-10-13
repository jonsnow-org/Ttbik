import { Address, Cell, Dictionary, Slice } from '@ton/core';
import { sha256_sync } from '@ton/crypto';
import { CreateLaunch } from '../../sdk/dist/generated/BondingCurveMasterV2.gen.js';
import { client, sdk, retry } from './common';

export interface Coin {
  curve: string;
  creator: string;
  salt: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  supply: bigint;
  creatorFeeBps: number;
  createdAt: number;
}

function snakeText(c: Cell | undefined): string {
  if (!c) return '';
  let s: Slice = c.beginParse();
  if (s.remainingBits < 8 || s.loadUint(8) !== 0) return '';
  const parts: Buffer[] = [];
  for (;;) {
    parts.push(s.loadBuffer(Math.floor(s.remainingBits / 8)));
    if (s.remainingRefs === 0) break;
    s = s.loadRef().beginParse();
  }
  return Buffer.concat(parts).toString('utf8');
}

export function readMeta(meta: Cell) {
  const out = { name: '', symbol: '', description: '', image: '' };
  try {
    const s = meta.beginParse();
    if (s.loadUint(8) !== 0) return out;
    const d = s.loadDict(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
    const get = (k: string) => snakeText(d?.get(sha256_sync(k)));
    out.name = get('name').slice(0, 64);
    out.symbol = get('symbol').slice(0, 16);
    out.description = get('description').slice(0, 400);
    const img = get('image');
    out.image = /^https:\/\/[^\s"'<>]{4,300}$/.test(img) ? img : '';
  } catch {}
  return out;
}

const CACHE_KEY = 'znbt-coins-v1';
function cached(): Record<string, Coin & { supply: string }> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

/** Every launch ever sent to the master, read straight from the chain (nothing to trust but the chain). */
export async function scanCoins(master: Address, limit = 100): Promise<Coin[]> {
  const known = cached();
  const coins: Coin[] = [];
  const txs = await retry(() => client.getTransactions(master, { limit, archival: true }));
  for (const tx of txs) {
    const m = tx.inMessage;
    if (!m || m.info.type !== 'internal') continue;
    const desc: any = tx.description;
    if (desc.type !== 'generic' || desc.aborted || desc.computePhase?.type !== 'vm' || !desc.computePhase.success) continue;
    let body: CreateLaunch;
    try { body = CreateLaunch.fromSlice(m.body.beginParse()); } catch { continue; }
    const creator = m.info.src as Address;
    const key = creator.toRawString() + ':' + body.salt.toString();
    let c: any = known[key];
    if (!c) {
      const curve = await retry(() => sdk.getLaunchAddress(master, creator, body.salt, body.options as any));
      const o = body.options.ref;
      c = {
        curve: curve.toString({ bounceable: true }),
        creator: creator.toString({ bounceable: false }),
        salt: body.salt.toString(),
        ...readMeta(body.metadata),
        supply: o.supply.toString(),
        creatorFeeBps: Number(o.creatorFeeBps),
        createdAt: tx.now,
      };
      known[key] = c;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(known)); } catch {}
    }
    coins.push({ ...c, supply: BigInt(c.supply) });
  }
  return coins;
}

export async function hiddenSet(): Promise<Set<string>> {
  try {
    const r = await fetch('/api/zenobia/coins/hidden', { cache: 'no-store' });
    const j = await r.json();
    return new Set<string>((j.hidden || []).map((x: any) => x.curve));
  } catch {
    return new Set();
  }
}
