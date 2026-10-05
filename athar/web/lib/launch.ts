// Turns a season definition into the wallet requests that publish it. Nothing here signs anything:
// every request is shown to the owner inside their own wallet, who pays and confirms.
import { Address, beginCell, Cell, Dictionary, storeStateInit, toNano } from "@ton/core";
import { AtharCollection, storeProposePayout, storeProposeBaseUri, storeApplyBaseUri, storeSetItemFees, storeProposeMinter } from "../../build/athar_AtharCollection";
import { AtharMinter, storeConfigure, storeAddSpecial, storeSetKindFees, storeSetCap, storeOpen, storeStartAuction, storeSetPaused, storeReveal, storeSweep, storeReprice } from "../../build/athar_AtharMinter";
import { BASE_URI, COLLECTION_URI, DELAY_SEC } from "./config";
import { SeasonDef, specialIndex } from "./seasons";
import type { Msg } from "./tx";

const b64 = (c: Cell) => c.toBoc().toString("base64");
const body = (store: (b: any) => void) => b64(beginCell().store(store as any).endCell());
const initCell = (init: { code: Cell; data: Cell }) => b64(beginCell().store(storeStateInit(init)).endCell());

export async function derive(admin: Address, def: SeasonDef) {
  const collection = await AtharCollection.fromInit(admin, COLLECTION_URI, BigInt(DELAY_SEC));
  const minter = await AtharMinter.fromInit(collection.address, admin, BigInt(def.id), BigInt(def.rangeStart), BigInt(def.rangeEnd));
  return { collection, minter };
}

export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = BigInt("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""));
  return secret;
}
export async function commitOf(secret: bigint) {
  const buf = new Uint8Array(32); let v = secret; for (let i = 31; i >= 0; i--) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return BigInt("0x" + Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

const nano = (s: string) => toNano(s);
const addr = (a: Address) => a.toString({ bounceable: true });

/** Three groups of requests, to be sent in this order, each after the previous one is visible on-chain. */
export async function launchSteps(admin: Address, payout: Address, def: SeasonDef, opts: { startAt: number; commit?: bigint; revealAt?: number }) {
  const { collection, minter } = await derive(admin, def);
  const C = addr(collection.address), M = addr(minter.address);
  const cfg = (kind: number) => {
    const k = def.kinds[kind];
    return body(storeConfigure({ $$type: "Configure", kind: BigInt(kind), startPrice: nano(k.start), floor: nano(k.floor), cap: nano(k.cap), bumpBps: BigInt(k.bumpBps), decayBps: BigInt(k.decayBps),
      maxSupply: BigInt(k.maxSupply), specialFee: nano(k.specialFee), photoFee: nano(k.photoFee), walletMax: BigInt(k.walletMax) }));
  };

  const specials = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
  def.specials.forEach((s) => specials.set(specialIndex(s), s.tier));

  const steps: { title: string; messages: Msg[] }[] = [
    { title: "نشر العقود (المجموعة + البائع)", messages: [
      { address: C, amount: nano("0.3").toString(), stateInit: initCell(collection.init!), payload: body(storeProposePayout({ $$type: "ProposePayout", payout })) },
      { address: M, amount: nano("0.25").toString(), stateInit: initCell(minter.init!), payload: cfg(0) },
    ] },
    { title: "ضبط الأصناف (عادي، فضي، ذهبي) وسقوف الفئات والتواريخ الخاصة", messages: [
      { address: C, amount: nano("0.06").toString(), payload: body(storeProposeBaseUri({ $$type: "ProposeBaseUri", uri: BASE_URI })) },
      { address: M, amount: nano("0.06").toString(), payload: cfg(1) },
      { address: M, amount: nano("0.06").toString(), payload: cfg(2) },
      ...def.classCaps.map((cap, i): Msg => ({ address: M, amount: nano("0.05").toString(), payload: body(storeSetCap({ $$type: "SetCap", kind: BigInt(3 + i), cap: BigInt(cap) })) })),
      { address: M, amount: nano("0.3").toString(), payload: body(storeAddSpecial({ $$type: "AddSpecial", items: specials })) },
    ] },
    { title: "اعتماد البائع وجدولة فتح البيع", messages: [
      { address: C, amount: nano("0.06").toString(), payload: body(storeProposeMinter({ $$type: "ProposeMinter", minter: minter.address })) },
      { address: M, amount: nano("0.06").toString(), payload: body(storeOpen({ $$type: "Open", startAt: BigInt(opts.startAt), walletDailyCap: BigInt(def.walletDailyCap) })) },
    ] },
  ];
  return { steps, collection: C, minter: M };
}

/** An auction of one of the owner's class tokens (id = kind * 65536 + date, kind 3..7); the picture, if any, is stored permanently first and bidders see it. */
export function classAuctionMsg(minter: string, id: number, mediaRef: bigint, reserve: string, hours: number): Msg {
  return { address: minter, amount: nano("0.05").toString(), payload: body(storeStartAuction({ $$type: "StartAuction", index: BigInt(id), reserve: nano(reserve), duration: BigInt(Math.round(hours * 3600)), mediaRef })) };
}
export const pauseMsg = (minter: string, paused: boolean): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSetPaused({ $$type: "SetPaused", paused })) });
export const revealMsg = (minter: string, secret: bigint): Msg => ({ address: minter, amount: nano("0.1").toString(), payload: body(storeReveal({ $$type: "Reveal", secret })) });
/** Moves the address the token metadata is read from (the failover switch). The first one is immediate; every later one waits out the public notice period, then must be applied. */
export const proposeBaseUriMsg = (collection: string, uri: string): Msg => ({ address: collection, amount: nano("0.06").toString(), payload: body(storeProposeBaseUri({ $$type: "ProposeBaseUri", uri })) });
export const applyBaseUriMsg = (collection: string): Msg => ({ address: collection, amount: nano("0.05").toString(), payload: body(storeApplyBaseUri({ $$type: "ApplyBaseUri" })) });
/** The fees of engraving / first picture / picture change (TON), changeable any time: prices follow the market. */
export const setItemFeesMsg = (collection: string, engrave: string, media: string, change: string): Msg => ({ address: collection, amount: nano("0.05").toString(), payload: body(storeSetItemFees({ $$type: "SetItemFees", engraveFee: nano(engrave), mediaFee: nano(media), changeFee: nano(change) })) });
/** Fees of a kind (TON), changeable any time: an own photo on the token, and a designed (special) date. */
export const setKindFeesMsg = (minter: string, kind: number, photo: string, special: string): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSetKindFees({ $$type: "SetKindFees", kind: BigInt(kind), photoFee: nano(photo), specialFee: nano(special) })) });
/** Lowers the supply cap of a kind (it can never be raised once the sale is open). */
export const setCapMsg = (minter: string, kind: number, cap: number): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSetCap({ $$type: "SetCap", kind: BigInt(kind), cap: BigInt(cap) })) });
/** Moves the price band (floor and cap, TON) of a kind after opening: 0 normal, 1 silver, 2 gold, 15 mystery tickets. */
export const repriceMsg = (minter: string, kind: number, floor: string, cap: string): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeReprice({ $$type: "Reprice", kind: BigInt(kind), floor: nano(floor), cap: nano(cap) })) });
export const sweepMsg = (minter: string): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSweep({ $$type: "Sweep" })) });
/** Groups of at most n messages. A message that deploys a contract (carries a stateInit) is always sent alone: some wallets cannot preview a big deploy next to other messages and never leave the loading screen. */
export const chunk = <T extends { stateInit?: unknown }>(a: T[], n: number) => {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const m of a) {
    if (m.stateInit) { if (cur.length) out.push(cur); out.push([m]); cur = []; continue; }
    cur.push(m);
    if (cur.length >= n) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
};
