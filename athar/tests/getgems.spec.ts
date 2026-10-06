import fs from "fs";
import path from "path";
import { compileFunc } from "@ton-community/func-js";
import { Address, beginCell, Cell, toNano, contractAddress, TupleReader } from "@ton/core";
import { setup, openSeason, itemOf, S1_START } from "./helpers";
import { ruleTier, TIER } from "../lib/rules";

// What a marketplace does with a token: Getgems' real fixed-price sale contract (v4r1, their open-source code, compiled here) is
// deployed, the token is transferred into it (forwarding money, asking for the rest back), a buyer pays, the token moves on and the
// seller, the royalty destination and the marketplace are paid. Getgems also refuses to list a token that does not send the
// unused value back to its owner ("Unexpected NFT behavior: no back message for owner").
const find = (from: number, tier: number) => { for (let i = from; i < from + 4000; i++) if (ruleTier(i) === tier) return i; throw new Error("none"); };
const D = path.join(__dirname, "getgems");
async function saleCode(): Promise<Cell> {
  const rd = (f: string) => fs.readFileSync(path.join(D, f), "utf8");
  const r: any = await compileFunc({ targets: ["nft-fixprice-sale-v4r1.fc"], sources: { "nft-fixprice-sale-v4r1.fc": rd("nft-fixprice-sale-v4r1.fc"), "op-codes.fc": rd("op-codes.fc"), "imports/stdlib.fc": rd("imports/stdlib.fc") } });
  if (r.status !== "ok") throw new Error(r.message);
  return Cell.fromBase64(r.codeBoc);
}

describe("marketplace flow (Getgems fixed-price sale v4r1)", () => {
  it("lists, sells and moves a token; the owner gets the unused value back", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { bc, alice, bob, admin, payout, minter } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    const item = await itemOf(ctx, idx);
    const price = toNano("2");
    const marketplace = admin;                       // stands for Getgems' marketplace/fee address
    const royaltyTo = payout;
    const statics = beginCell().storeAddress(marketplace.address).storeAddress(royaltyTo.address).storeUint(5000, 17).storeUint(5000, 17).storeAddress(item.address).storeUint(bc.now!, 32).endCell();
    const data = beginCell().storeUint(0, 1).storeAddress(marketplace.address).storeAddress(null).storeCoins(price).storeUint(0, 32).storeUint(0, 64).storeRef(statics).storeDict(null).storeBit(0).endCell();
    const code = await saleCode();
    const init = { code, data };
    const sale = contractAddress(0, init);
    // 1. the marketplace deploys the sale contract
    await marketplace.send({ to: sale, value: toNano("0.05"), init, body: beginCell().storeUint(0x664c0905, 32).storeUint(0, 64).endCell() });
    // 2. the owner transfers the token into it, forwarding money and asking for the rest back
    const r = await item.send(alice.getSender(), { value: toNano("0.3") }, { $$type: "Transfer", queryId: 7n, newOwner: sale, responseDestination: alice.address, customPayload: null, forwardAmount: toNano("0.1"), forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice() });
    expect(r.transactions).toHaveTransaction({ from: item.address, to: sale, success: true });                       // ownership assigned, sale initialised
    expect(r.transactions).toHaveTransaction({ from: item.address, to: alice.address });                              // the unused value comes back to the owner
    const d1 = await bc.runGetMethod(sale, "get_fix_price_data_v4");
    const sr = new TupleReader(d1.stack);
    sr.readBigNumber(); sr.readBigNumber(); sr.readAddress(); sr.readAddress();
    expect(sr.readAddress().equals(alice.address)).toBe(true);                                                  // the sale knows its seller
    expect((await item.getGetNftData()).ownerAddress.equals(sale)).toBe(true);
    // 3. a buyer pays
    const sellerBefore = await alice.getBalance(), royaltyBefore = await royaltyTo.getBalance();
    const b = await bc.sendMessage({ info: { type: "internal", ihrDisabled: true, bounce: true, bounced: false, src: bob.address, dest: sale, value: { coins: price + toNano("0.2") }, ihrFee: 0n, forwardFee: 0n, createdLt: 0n, createdAt: 0 }, body: new Cell() } as any);
    expect(b.transactions).toHaveTransaction({ from: sale, to: item.address, success: true });
    expect((await item.getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);                                 // the token moved to the buyer
    expect((await item.getAthar()).hands).toBe(3n);                                                                   // counted: alice -> sale -> bob
    expect((await alice.getBalance()) - sellerBefore).toBeGreaterThan(toNano("1.7"));                                 // 90% of 2 TON to the seller
    expect((await royaltyTo.getBalance()) - royaltyBefore).toBeGreaterThan(toNano("0.09"));                           // 5% royalty to the royalty destination
  }, 120000);
});
