// Read-only access to the chain (server side only). Everything is cached briefly and calls are spaced out
// so the free public TON API is never hammered.
import { TonClient } from "@ton/ton";
import { Address } from "@ton/core";
import { AtharCollection } from "../../build/athar_AtharCollection";
import { AtharItem } from "../../build/athar_AtharItem";
import { AtharMinter } from "../../build/athar_AtharMinter";
import { adminAddress, COLLECTION_URI, DELAY_SEC, TONCENTER_RPC, TONCENTER_V3 } from "./config";
import { SEASONS, SeasonDef, seasonTier, specialIndex, buildPool } from "./seasons";

const client = new TonClient({ endpoint: TONCENTER_RPC, apiKey: process.env.TONCENTER_API_KEY });
const cache = new Map<string, { at: number; v: unknown }>();
let chain: Promise<unknown> = Promise.resolve();
const GAP = process.env.TONCENTER_API_KEY ? 120 : 1100;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(() => new Promise((r) => setTimeout(r, GAP)), () => new Promise((r) => setTimeout(r, GAP)));
  return run;
}
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await paced(fn);
  cache.set(key, { at: Date.now(), v });
  return v;
}

export async function addresses(season = 1) {
  const admin = adminAddress();
  if (!admin) return null;
  const def = SEASONS[season];
  const collection = await AtharCollection.fromInit(admin, COLLECTION_URI, BigInt(DELAY_SEC));
  const minter = await AtharMinter.fromInit(collection.address, admin, BigInt(def.id), BigInt(def.rangeStart), BigInt(def.rangeEnd));
  return { admin, def, collection, minter };
}

const nano = (v: bigint | number) => Number(v) / 1e9;

export async function seasonStatus(season = 1) {
  const a = await addresses(season);
  if (!a) return { configured: false as const };
  return cached(`season:${season}`, 8000, async () => {
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    try {
      const status = Number(await m.getStatus());
      const [sold, pc, pr, myst, pt] = [await m.getSoldCount(), await m.getPrice(0n), await m.getPrice(1n), await m.getMysteryInfo(), await m.getPrice(3n)];
      return {
        configured: true as const, deployed: true, status, sold: Number(sold),
        prices: { common: nano(pc), rare: nano(pr), ticket: nano(pt) },
        mystery: { poolSize: Number(myst.poolSize), ticketsSold: Number(myst.ticketsSold), revealed: myst.revealed, revealAt: Number(myst.revealAt) },
        minter: a.minter.address.toString({ bounceable: true }), collection: a.collection.address.toString({ bounceable: true }),
      };
    } catch {
      return { configured: true as const, deployed: false, minter: a.minter.address.toString({ bounceable: true }), collection: a.collection.address.toString({ bounceable: true }) };
    }
  });
}

export async function dateInfo(index: number) {
  const a = await addresses(1);
  const def = SEASONS[1];
  const inSeason = (index >= def.rangeStart && index <= def.rangeEnd) || def.specials.some((s) => specialIndex(s) === index);
  const tier = seasonTier(def, index);
  const pool = new Set(buildPool(def).dates);
  const base = { index, tier, inSeason, reserved: pool.has(index) };
  if (!a || !inSeason) return { ...base, taken: false as boolean, owner: null as string | null, price: null as number | null, auction: null as null | { endAt: number; reserve: number; highBid: number; highBidder: string | null; live: boolean } };
  return cached(`date:${index}`, 8000, async () => {
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    let taken = false, owner: string | null = null, price: number | null = null;
    let auction: null | { endAt: number; reserve: number; highBid: number; highBidder: string | null; live: boolean } = null;
    try {
      taken = await m.getIsTaken(BigInt(index));
      if (taken) owner = (await tokenState(index))?.owner ?? null;
      else if (tier < 2 && !pool.has(index)) price = nano(await m.getPrice(BigInt(tier)));
      if (tier === 2 && !pool.has(index) && !taken) {
        const au = await m.getAuctionOf(BigInt(index));
        if (au) auction = { endAt: Number(au.endAt), reserve: nano(au.reserve), highBid: nano(au.highBid), highBidder: au.highBidder?.toString() ?? null, live: au.started && Number(au.endAt) * 1000 > Date.now() };
      }
    } catch { /* contract not deployed yet */ }
    return { ...base, taken, owner, price, auction };
  });
}

export async function tokenState(index: number) {
  const a = await addresses(1);
  if (!a) return null;
  return cached(`token:${index}`, 8000, async () => {
    try {
      const itemAddr = await client.open(AtharCollection.fromAddress(a.collection.address)).getGetNftAddressByIndex(BigInt(index));
      const it = client.open(AtharItem.fromAddress(itemAddr));
      const d = await it.getGetNftData();
      if (!d.isInitialized) return null;
      const st = await it.getAthar();
      // engravings: linked cells (newest first): owner, time, length, text, ref(previous)
      const notes: { owner: string; at: number; text: string }[] = [];
      let c = st.engravings;
      while (c && notes.length < 50) {
        const s = c.beginParse();
        const owner = s.loadAddress().toString(); const at = s.loadUint(32); const bits = s.loadUint(9);
        const text = Buffer.from(s.loadBuffer(Math.ceil(bits / 8))).toString("utf8");
        notes.push({ owner, at, text });
        c = s.loadMaybeRef();
      }
      return {
        index, address: itemAddr.toString({ bounceable: true }), owner: d.ownerAddress.toString(),
        season: Number(st.season), tier: Number(st.tier), paid: nano(st.paid), mintedAt: Number(st.mintedAt),
        lastTransferAt: Number(st.lastTransferAt), hands: Number(st.hands), locked: st.locked, engravings: notes,
      };
    } catch { return null; }
  });
}

export async function tokensOf(owner: string) {
  const a = await addresses(1);
  if (!a) return [];
  return cached(`mine:${owner}`, 10000, async () => {
    const url = `${TONCENTER_V3}/nft/items?owner_address=${encodeURIComponent(owner)}&collection_address=${encodeURIComponent(a.collection.address.toString())}&limit=200`;
    const r = await fetch(url, { headers: process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {}, cache: "no-store" });
    if (!r.ok) return [] as number[];
    const j = await r.json();
    return (j.nft_items || []).map((x: { index: string }) => Number(x.index)).filter((n: number) => Number.isFinite(n)) as number[];
  });
}

export async function ticketsOf(owner: string) {
  const a = await addresses(1);
  if (!a) return [];
  return cached(`tickets:${owner}`, 10000, async () => {
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    const info = await m.getMysteryInfo();
    const out: { ticket: number; claimed: boolean; date: number | null }[] = [];
    const me = Address.parse(owner);
    for (let t = 0; t < Number(info.ticketsSold); t++) {
      const tk = await m.getTicketOf(BigInt(t));
      if (tk && tk.owner.equals(me)) {
        const date = info.revealed ? await m.getTicketDate(BigInt(t)) : null;
        out.push({ ticket: t, claimed: tk.claimed, date: date == null ? null : Number(date) });
      }
    }
    return out;
  });
}

export function liveAuctionDates(def: SeasonDef = SEASONS[1]) {
  const pool = new Set(buildPool(def).dates);
  const out: number[] = [];
  for (let i = def.rangeStart; i <= def.rangeEnd; i++) if (seasonTier(def, i) === 2 && !pool.has(i)) out.push(i);
  for (const s of def.specials) { const i = specialIndex(s); if (s.tier === 2 && (i < def.rangeStart || i > def.rangeEnd)) out.push(i); }
  return out;
}
