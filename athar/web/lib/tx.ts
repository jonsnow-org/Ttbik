// Builds the wallet requests (TON Connect). The user always confirms and pays inside their own wallet.
import { Address, beginCell, Cell, toNano } from "@ton/core";
import { storeBuy, storeBid, storeBuyTicket, storeClaimTicket, storeSettle, storeUpgradeStart } from "../../build/athar_AtharMinter";
import { storeEngraveReq, storeSetMediaReq } from "../../build/athar_AtharCollection";

export type Msg = { address: string; amount: string; payload?: string; stateInit?: string };
const b64 = (c: Cell) => c.toBoc().toString("base64");
export const BUY_FEES = toNano("0.15");          // paid on top of the price; the unused part is refunded
export const SAFETY = toNano("0.08");

/** style: 0 generated art (free), 1 own photo, 2 own photo in waxed silver. extraTon is that style's fee, read from the contract. */
export function buyMsg(minter: string, index: number, priceTon: number, recipient?: string, occasion = 0, mediaRef = 0n, style = 0, extraTon = 0): Msg {
  const amount = toNano((priceTon + extraTon).toFixed(9)) + BUY_FEES + SAFETY + toNano(priceTon * 0.12 + 0.02);   // headroom for a price that moved; change comes back
  return { address: minter, amount: amount.toString(), payload: b64(beginCell().store(storeBuy({ $$type: "Buy", index: BigInt(index), recipient: recipient ? Address.parse(recipient) : null, occasion: BigInt(occasion), mediaRef, style: BigInt(style) })).endCell()) };
}
export function bidMsg(minter: string, index: number, bidTon: number): Msg {
  const amount = toNano(bidTon.toFixed(9)) + BUY_FEES + SAFETY;
  return { address: minter, amount: amount.toString(), payload: b64(beginCell().store(storeBid({ $$type: "Bid", index: BigInt(index) })).endCell()) };
}
export function ticketMsg(minter: string, priceTon: number): Msg {
  const amount = toNano(priceTon.toFixed(9)) + BUY_FEES + SAFETY + toNano(priceTon * 0.12 + 0.02);
  return { address: minter, amount: amount.toString(), payload: b64(beginCell().store(storeBuyTicket({ $$type: "BuyTicket", recipient: null })).endCell()) };
}
export function claimMsg(minter: string, ticket: number): Msg {
  return { address: minter, amount: toNano("0.06").toString(), payload: b64(beginCell().store(storeClaimTicket({ $$type: "ClaimTicket", ticket: BigInt(ticket) })).endCell()) };
}
export function settleMsg(minter: string, index: number): Msg {
  return { address: minter, amount: toNano("0.1").toString(), payload: b64(beginCell().store(storeSettle({ $$type: "Settle", index: BigInt(index) })).endCell()) };
}
/** Engraving is asked at the collection (it holds the current fee). feeTon is read from the contract; the change comes back. */
export function engraveMsg(collection: string, index: number, text: string, feeTon: number): Msg {
  return { address: collection, amount: (toNano(feeTon.toFixed(9)) + toNano("0.05") + toNano("0.06") + toNano("0.1")).toString(), payload: b64(beginCell().store(storeEngraveReq({ $$type: "EngraveReq", index: BigInt(index), text })).endCell()) };
}
export function upgradeMsg(item: string, valueTon: number): Msg {
  return { address: item, amount: toNano(valueTon.toFixed(9)).toString(), payload: b64(beginCell().store(storeUpgradeStart({ $$type: "UpgradeStart", queryId: 0n })).endCell()) };
}
export const tx = (messages: Msg[]) => ({ validUntil: Math.floor(Date.now() / 1000) + 600, messages });
export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);
export const eq = (a: string, b: string) => { try { return Address.parse(a).equals(Address.parse(b)); } catch { return false; } };

export function mediaMsg(collection: string, index: number, occasion: number, mediaRef: bigint, feeTon: number): Msg {
  return { address: collection, amount: (toNano(feeTon.toFixed(9)) + toNano("0.05") + toNano("0.06") + toNano("0.1")).toString(), payload: b64(beginCell().store(storeSetMediaReq({ $$type: "SetMediaReq", index: BigInt(index), occasion: BigInt(occasion), mediaRef })).endCell()) };
}
