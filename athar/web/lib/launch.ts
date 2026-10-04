// Turns a season definition into the wallet requests that publish it. Nothing here signs anything:
// every request is shown to the owner inside their own wallet, who pays and confirms.
import { Address, beginCell, Cell, Dictionary, storeStateInit, toNano } from "@ton/core";
import { AtharCollection, storeProposePayout, storeProposeBaseUri, storeApplyBaseUri, storeProposeMinter } from "../../build/athar_AtharCollection";
import { AtharMinter, storeConfigure, storeAddSpecial, storeLoadPool, storeSetMystery, storeSetFees, storeOpen, storeStartAuction, storeSetPaused, storeReveal, storeSweep } from "../../build/athar_AtharMinter";
import { BASE_URI, COLLECTION_URI, DELAY_SEC } from "./config";
import { buildPool, SeasonDef, specialIndex, seasonTier } from "./seasons";
import { ruleTier, TIER } from "./dates";
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

/** Four groups of requests, to be sent in this order, each after the previous one is visible on-chain. */
export async function launchSteps(admin: Address, payout: Address, def: SeasonDef, opts: { startAt: number; commit: bigint; revealAt: number }) {
  const { collection, minter } = await derive(admin, def);
  const C = addr(collection.address), M = addr(minter.address);
  const cfg = (tier: number, p: SeasonDef["common"]) => body(storeConfigure({ $$type: "Configure", tier: BigInt(tier), startPrice: nano(p.start), floor: nano(p.floor), cap: nano(p.cap), bumpBps: BigInt(p.bumpBps), decayBps: BigInt(p.decayBps) }));

  const specials = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
  def.specials.forEach((s) => specials.set(specialIndex(s), s.tier));

  const pool = buildPool(def).dates;
  const poolMsgs: Msg[] = [];
  for (let i = 0; i < pool.length; i += 35) {
    const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    pool.slice(i, i + 35).forEach((d, k) => items.set(i + k, d));
    poolMsgs.push({ address: M, amount: nano("0.12").toString(), payload: body(storeLoadPool({ $$type: "LoadPool", items })) });
  }

  const steps: { title: string; messages: Msg[] }[] = [
    { title: "نشر العقود (المجموعة + البائع)", messages: [
      { address: C, amount: nano("0.3").toString(), stateInit: initCell(collection.init!), payload: body(storeProposePayout({ $$type: "ProposePayout", payout })) },
      { address: M, amount: nano("0.25").toString(), stateInit: initCell(minter.init!), payload: cfg(TIER.COMMON, def.common) },
    ] },
    { title: "ضبط الأسعار والتواريخ الخاصة وصناديق الغموض", messages: [
      { address: C, amount: nano("0.06").toString(), payload: body(storeProposeBaseUri({ $$type: "ProposeBaseUri", uri: BASE_URI })) },
      { address: M, amount: nano("0.06").toString(), payload: cfg(TIER.RARE, def.rare) },
      { address: M, amount: nano("0.05").toString(), payload: body(storeSetFees({ $$type: "SetFees", photoFee: nano(def.fees.photo), silverFee: nano(def.fees.silver) })) },
      { address: M, amount: nano("0.3").toString(), payload: body(storeAddSpecial({ $$type: "AddSpecial", items: specials })) },
      { address: M, amount: nano("0.1").toString(), payload: body(storeSetMystery({ $$type: "SetMystery", commitHash: opts.commit, revealAt: BigInt(opts.revealAt), startPrice: nano(def.ticket.start), floor: nano(def.ticket.floor), cap: nano(def.ticket.cap), bumpBps: BigInt(def.ticket.bumpBps), decayBps: BigInt(def.ticket.decayBps), poolExpected: BigInt(pool.length) })) },
    ] },
    { title: `تحميل قائمة الصناديق (${pool.length} تاريخاً)`, messages: poolMsgs },
    { title: "اعتماد البائع وجدولة فتح البيع", messages: [
      { address: C, amount: nano("0.06").toString(), payload: body(storeProposeMinter({ $$type: "ProposeMinter", minter: minter.address })) },
      { address: M, amount: nano("0.06").toString(), payload: body(storeOpen({ $$type: "Open", startAt: BigInt(opts.startAt), walletDailyCap: BigInt(def.walletDailyCap) })) },
    ] },
  ];
  return { steps, collection: C, minter: M, poolDates: pool };
}

/** Auctions of the mythic dates by rule (48 h, no picture of ours). Special dates have their own, long auctions (specialAuctionMsg). */
export function auctionMsgs(minter: string, def: SeasonDef): Msg[] {
  const pool = new Set(buildPool(def).dates);
  const special = new Set(def.specials.map(specialIndex));
  const dates: number[] = [];
  for (let i = def.rangeStart; i <= def.rangeEnd; i++) if (seasonTier(def, i) === TIER.MYTHIC && !pool.has(i) && !special.has(i)) dates.push(i);
  return dates.map((i) => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeStartAuction({ $$type: "StartAuction", index: BigInt(i), reserve: nano(def.auctionReserve), duration: BigInt(def.auctionHours * 3600), mediaRef: 0n })) }));
}
/** A special (gold) date: the picture is ours, stored permanently first, and bidders see it. */
export function specialAuctionMsg(minter: string, def: SeasonDef, index: number, mediaRef: bigint, reserve = def.specialReserve, days = def.specialDays): Msg {
  return { address: minter, amount: nano("0.05").toString(), payload: body(storeStartAuction({ $$type: "StartAuction", index: BigInt(index), reserve: nano(reserve), duration: BigInt(Math.round(days * 86400)), mediaRef })) };
}
export const pauseMsg = (minter: string, paused: boolean): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSetPaused({ $$type: "SetPaused", paused })) });
export const revealMsg = (minter: string, secret: bigint): Msg => ({ address: minter, amount: nano("0.1").toString(), payload: body(storeReveal({ $$type: "Reveal", secret })) });
/** Moves the address the token metadata is read from (the failover switch). The first one is immediate; every later one waits out the public notice period, then must be applied. */
export const proposeBaseUriMsg = (collection: string, uri: string): Msg => ({ address: collection, amount: nano("0.06").toString(), payload: body(storeProposeBaseUri({ $$type: "ProposeBaseUri", uri })) });
export const applyBaseUriMsg = (collection: string): Msg => ({ address: collection, amount: nano("0.05").toString(), payload: body(storeApplyBaseUri({ $$type: "ApplyBaseUri" })) });
export const sweepMsg = (minter: string): Msg => ({ address: minter, amount: nano("0.05").toString(), payload: body(storeSweep({ $$type: "Sweep" })) });
export const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
