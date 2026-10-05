// Read-only access to the chain (server side only). Everything is cached briefly and calls are spaced out
// so the free public TON API is never hammered.
import { TonClient } from "@ton/ton";
import { Address } from "@ton/core";
import { AtharCollection } from "../../build/athar_AtharCollection";
import { AtharItem } from "../../build/athar_AtharItem";
import { AtharMinter } from "../../build/athar_AtharMinter";
import { adminAddress, COLLECTION_URI, DELAY_SEC, TONCENTER_RPC, TONCENTER_V3 } from "./config";
import { toncenterKey } from "./settings";
import { SEASONS, specialIndex } from "./seasons";
import { KIND_COUNT, dateOf, kindOf } from "./kinds";

// the pause between calls to the public node: short with a (free) API key, about a second without
const gapMs = () => (toncenterKey() ? 120 : 1100);
// Every call to the node, however many a page makes at once, goes through one gate: spaced out, and retried when the free
// public API answers "too many requests" (found on the test network: a burst of reads made the whole app look undeployed).
let gate: Promise<void> = Promise.resolve();
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    const turn = gate.then(() => new Promise<void>((r) => setTimeout(r, gapMs())));
    gate = turn.catch(() => undefined);
    await turn;
    try { return await fn(); } catch (e: any) {
      last = e;
      const st = e?.response?.status;
      const transient = st === 429 || st === 500 || st === 502 || st === 503 || st === 504 || /exit_code: -13/.test(String(e?.message || e));   // -13: the public node's own hiccup, seen on the test network
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}
export class PacedClient extends TonClient {
  runMethod(...a: Parameters<TonClient["runMethod"]>) { return throttled(() => super.runMethod(...a)); }
  callGetMethod(...a: Parameters<TonClient["callGetMethod"]>) { return throttled(() => super.callGetMethod(...a)); }
  getContractState(...a: Parameters<TonClient["getContractState"]>) { return throttled(() => super.getContractState(...a)); }
  getBalance(...a: Parameters<TonClient["getBalance"]>) { return throttled(() => super.getBalance(...a)); }
}
export const makeClient = () => new PacedClient({ endpoint: TONCENTER_RPC, apiKey: toncenterKey() || undefined });
// the shared client follows the key: when the owner saves or removes it in the panel, the next call already uses the new one
let shared: PacedClient | null = null, sharedKey = "";
const client = new Proxy({} as PacedClient, {
  get: (_t, prop) => {
    const k = toncenterKey();
    if (!shared || k !== sharedKey) { shared = makeClient(); sharedKey = k; }
    const v = (shared as any)[prop];
    return typeof v === "function" ? v.bind(shared) : v;
  },
});
const cache = new Map<string, { at: number; v: unknown }>();
let chain: Promise<unknown> = Promise.resolve();

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(() => new Promise((r) => setTimeout(r, gapMs())), () => new Promise((r) => setTimeout(r, gapMs())));
  return run;
}
// Same question asked by many visitors at once is asked of the node once; when the queue to the node is long, an older answer is
// served instead of making everybody wait longer (and a request that would only lengthen an already huge queue is refused), so a
// crowd, or a script walking through every date, can slow the pages down but never lock the site.
const inflight = new Map<string, Promise<unknown>>();
let waiting = 0;
const BUSY_SERVE_STALE = 10, BUSY_REFUSE = 24;   // with the public node at about one call a second, a longer queue only means waiting minutes: refuse early, the caller retries
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const same = inflight.get(key);
  if (same) return same as Promise<T>;
  if (hit && waiting >= BUSY_SERVE_STALE) return hit.v as T;
  if (waiting >= BUSY_REFUSE) throw new Error("busy");
  waiting++;
  const run = paced(fn).then((v) => { cache.set(key, { at: Date.now(), v }); return v; }).finally(() => { waiting--; inflight.delete(key); });
  inflight.set(key, run);
  return run;
}
export const isBusy = (e: unknown) => String((e as Error)?.message) === "busy";

/** Is there a contract at this address? Asked first, so a reading of something not deployed (yet) answers at once instead of retrying
 *  the public node for half a minute (it answers "exit code -13" for an empty address, the same as when it is momentarily overloaded). */
const activeCache = new Map<string, { at: number; v: boolean }>();
export async function isActive(addr: Address): Promise<boolean> {
  const k = addr.toRawString();
  const h = activeCache.get(k);
  if (h && Date.now() - h.at < (h.v ? 60000 : 8000)) return h.v;
  try {
    const v = (await client.getContractState(addr)).state === "active";
    activeCache.set(k, { at: Date.now(), v });
    return v;
  } catch { return true; }      // the node is in trouble: let the normal (retrying) reads try
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

export { arweaveId } from "./ids";
import { arweaveId } from "./ids";

/** auction_of read by hand: the public node writes an empty "null" address inside a tuple as an empty list, which the generated reader rejects. */
type RawAuction = { started: boolean; endAt: bigint; reserve: bigint; highBid: bigint; highBidder: Address | null; mediaRef: bigint };
export async function auctionOf(minter: Address, index: number): Promise<RawAuction | null> {
  const res = await client.runMethod(minter, "auction_of", [{ type: "int", value: BigInt(index) }]);
  const top: any = res.stack.pop();
  if (!top || top.type !== "tuple") return null;
  const it = top.items as any[];
  const int = (x: any): bigint => (typeof x === "bigint" ? x : x && x.type === "int" ? (x.value as bigint) : 0n);   // the node's tuples hold plain values
  let hb: Address | null = null;
  const h = it[4];
  if (h && typeof h.beginParse === "function") { try { hb = h.beginParse().loadMaybeAddress(); } catch { hb = null; } }
  else if (h && h.cell && typeof h.cell.beginParse === "function") { try { hb = h.cell.beginParse().loadMaybeAddress(); } catch { hb = null; } }
  return { started: int(it[0]) !== 0n, endAt: int(it[1]), reserve: int(it[2]), highBid: int(it[3]), highBidder: hb, mediaRef: int(it[5]) };
}

export async function seasonStatus(season = 1) {
  const a = await addresses(season);
  if (!a) return { configured: false as const };
  return cached(`season:${season}`, 8000, async () => {
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    try {
      if (!(await isActive(a.minter.address))) throw new Error("not deployed");
      const status = Number(await m.getStatus());
      const [sold, myst] = [await m.getSoldCount(), await m.getMysteryInfo()];
      // each kind: its curve price now (direct kinds), its cap and how many are issued, its fees
      const kinds: { kind: number; price: number | null; cap: number; issued: number; photoFee: number; specialFee: number; walletMax: number }[] = [];
      for (let k = 0; k < KIND_COUNT; k++) {
        const ki = await m.getKindInfo(BigInt(k));
        kinds.push({ kind: k, price: k <= 2 ? nano(await m.getPrice(BigInt(k))) : null, cap: Number(ki.cap), issued: Number(ki.issued), photoFee: nano(ki.photo), specialFee: nano(ki.special), walletMax: Number(ki.walletMax) });
      }
      let itemFees = { engrave: 0.1, media: 0.1, change: 0.5 };
      try { const f = await client.open(AtharCollection.fromAddress(a.collection.address)).getItemFees(); itemFees = { engrave: nano(f.engrave), media: nano(f.media), change: nano(f.change) }; } catch { /* keep the defaults */ }
      return {
        configured: true as const, deployed: true, status, sold: Number(sold), kinds, ticketPrice: nano(await m.getPrice(15n)),
        itemFees,
        mystery: { poolSize: Number(myst.poolSize), ticketsSold: Number(myst.ticketsSold), revealed: myst.revealed, revealAt: Number(myst.revealAt) },
        minter: a.minter.address.toString({ bounceable: true }), collection: a.collection.address.toString({ bounceable: true }),
      };
    } catch {
      return { configured: true as const, deployed: false, minter: a.minter.address.toString({ bounceable: true }), collection: a.collection.address.toString({ bounceable: true }) };
    }
  });
}

export type DateKinds = {
  date: number; special: boolean; event: string | null;
  taken: boolean[]; auction: boolean[]; reserved: boolean[];          // by kind 0..7
  prices: (number | null)[];                                          // TON, direct kinds only (premium and special fee included)
  onChain: boolean;
};
/** Everything about one date in one read: which of its eight kinds are taken, under auction or in the boxes, and what the three direct kinds cost. */
export async function dateInfo(date: number): Promise<DateKinds> {
  const a = await addresses(1);
  const def = SEASONS[1];
  const special = def.specials.some((s) => specialIndex(s) === date);
  const empty: DateKinds = { date, special, event: def.specials.find((s) => specialIndex(s) === date)?.note ?? null, taken: Array(KIND_COUNT).fill(false), auction: Array(KIND_COUNT).fill(false), reserved: Array(KIND_COUNT).fill(false), prices: [null, null, null], onChain: false };
  if (!a) return empty;
  return cached(`date:${date}`, 8000, async () => {
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    try {
      if (!(await isActive(a.minter.address))) throw new Error("not deployed");
      const v = await m.getDateView(BigInt(date));
      const bit = (mask: bigint) => Array.from({ length: KIND_COUNT }, (_, k) => ((mask >> BigInt(k)) & 1n) === 1n);
      const prices = [v.p0, v.p1, v.p2].map((p) => (p > 0n ? nano(p) : null));
      return { ...empty, taken: bit(v.taken), auction: bit(v.auction), reserved: bit(v.reserved), prices, special: v.special, onChain: true };
    } catch { return empty; }   // contract not deployed yet
  });
}

/** One token by its id (kind * 65536 + date). */
export async function tokenState(index: number) {
  const a = await addresses(1);
  if (!a) return null;
  return cached(`token:${index}`, 8000, async () => {
    try {
      if (!(await isActive(a.collection.address))) return null;
      const itemAddr = await client.open(AtharCollection.fromAddress(a.collection.address)).getGetNftAddressByIndex(BigInt(index));
      if (!(await isActive(itemAddr))) return null;       // no token on this date yet
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
      // picture history (newest first): owner, time, Arweave id
      const media: { owner: string; at: number; ref: string }[] = [];
      let mc = st.mediaLog;
      while (mc && media.length < 50) {
        const ms = mc.beginParse();
        const mo = ms.loadAddress().toString(); const mt = ms.loadUint(32); const mr = ms.loadUintBig(256);
        media.push({ owner: mo, at: mt, ref: arweaveId(mr) });
        mc = ms.loadMaybeRef();
      }
      return {
        occasion: Number(st.occasion), mediaRef: st.mediaRef === 0n ? null : arweaveId(st.mediaRef), media,
        index, date: dateOf(index), kind: kindOf(index), address: itemAddr.toString({ bounceable: true }), owner: d.ownerAddress.toString(),
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
    const r = await fetch(url, { headers: toncenterKey() ? { "X-API-Key": toncenterKey() } : {}, cache: "no-store" });
    if (!r.ok) return [] as number[];
    const j = await r.json();
    return (j.nft_items || []).map((x: { index: string }) => Number(x.index)).filter((n: number) => Number.isFinite(n)) as number[];
  });
}

/** Every token of the collection with its owner (for the calendar board and the perks), cached for a minute. */
export async function allTokens(): Promise<{ index: number; owner: string }[]> {
  const a = await addresses(1);
  if (!a) return [];
  return cached("all-tokens", 60000, async () => {
    const out: { index: number; owner: string }[] = [];
    for (let offset = 0; offset < 40000; offset += 1000) {
      const url = `${TONCENTER_V3}/nft/items?collection_address=${encodeURIComponent(a.collection.address.toString())}&limit=1000&offset=${offset}`;
      const r = await fetch(url, { headers: toncenterKey() ? { "X-API-Key": toncenterKey() } : {}, cache: "no-store" });
      if (!r.ok) break;
      const items = ((await r.json()).nft_items || []) as { index: string; owner_address?: string }[];
      for (const x of items) { const n = Number(x.index); if (Number.isFinite(n)) out.push({ index: n, owner: String(x.owner_address || "") }); }
      if (items.length < 1000) break;
    }
    return out;
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

/** Every auction the minter ever started (token ids), read from its own list. */
export async function auctionIds(): Promise<number[]> {
  const a = await addresses(1);
  if (!a) return [];
  return cached("auction-ids", 15000, async () => {
    if (!(await isActive(a.minter.address))) return [] as number[];
    const m = client.open(AtharMinter.fromAddress(a.minter.address));
    const n = Number(await m.getAuctionCount());
    const out: number[] = [];
    for (let i = 0; i < n && i < 400; i++) { const id = await m.getAuctionIdAt(BigInt(i)); if (id != null) out.push(Number(id)); }
    return out;
  });
}
