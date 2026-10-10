// The secondary market, read from the public TON indexer: which of our tokens are listed for sale on Getgems, and at what price.
// Nothing here is stored by us and nobody pays through us: every listing links to its own page on Getgems.
import { Address } from "@ton/core";
import { NETWORK } from "./config";
import { addresses } from "./chain";
import { dateOf, kindOf, KIND_COUNT } from "./kinds";

const API = NETWORK === "testnet" ? "https://testnet.tonapi.io" : "https://tonapi.io";
export type Listing = { id: number; kind: number; date: number; address: string; price: number | null; market: string; owner: string };   // price null: an auction (the indexer gives no price for it)
export type Market = { partial: boolean; collection: string; minted: number; listings: Listing[]; floor: (number | null)[]; counts: number[]; at: number; network: string };

let memo: { at: number; v: Market } | null = null;
let pending: Promise<Market> | null = null;

async function load(): Promise<Market> {
  const a = await addresses(1);
  if (!a) throw new Error("not configured");
  const collection = a.collection.address;
  const listings: Listing[] = [];
  let minted = 0, partial = false;
  const key = process.env.TONAPI_KEY;   // optional: a free key lifts the indexer's anonymous limits (100 items per call, about one call a second)
  const page = key ? 1000 : 100, maxPages = key ? 20 : 40;
  for (let p = 0; ; p++) {
    if (p >= maxPages) { partial = true; break; }
    if (p > 0 && !key) await new Promise((r) => setTimeout(r, 1200));
    const r = await fetch(`${API}/v2/nfts/collections/${collection.toRawString()}/items?limit=${page}&offset=${p * page}`, { cache: "no-store", signal: AbortSignal.timeout(15000), headers: key ? { Authorization: `Bearer ${key}` } : undefined });
    if (r.status === 404) break;   // the collection is not on chain (yet): an empty market
    if (!r.ok) throw new Error(`indexer ${r.status}`);
    const j: any = await r.json();
    const items: any[] = j.nft_items || [];
    for (const it of items) {
      minted++;
      const s = it.sale;
      if (!s) continue;
      const id = Number(it.index);
      const nano = s.price && s.price.currency_type === "native" ? Number(s.price.value) : 0;
      listings.push({
        id, kind: kindOf(id), date: dateOf(id), address: Address.parse(it.address).toString({ bounceable: true }),
        price: nano > 0 ? nano / 1e9 : null, market: String(s.market?.name || "Getgems"), owner: s.owner?.address ? Address.parse(s.owner.address).toString({ bounceable: false }) : "",
      });
    }
    if (items.length < page) break;
  }
  const floor: (number | null)[] = Array(KIND_COUNT).fill(null), counts: number[] = Array(KIND_COUNT).fill(0);
  for (const l of listings) { counts[l.kind]++; if (l.price != null && (floor[l.kind] == null || l.price < floor[l.kind]!)) floor[l.kind] = l.price; }
  listings.sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity));
  return { partial, collection: collection.toString({ bounceable: true }), minted, listings, floor, counts, at: Date.now(), network: NETWORK };
}

/** Served from memory; refreshed in the background every 5 minutes (a first visit waits for the first reading); on a failure the last good answer stays. */
export async function marketView(): Promise<Market> {
  const refresh = () => { if (!pending) pending = load().then((v) => { memo = { at: Date.now(), v }; return v; }).finally(() => { pending = null; }); return pending; };
  if (memo) { if (Date.now() - memo.at > 300000) refresh().catch(() => {}); return memo.v; }
  return refresh();
}
