import { toNano, Address, beginCell } from "@ton/core";
import { setup, openSeason, itemOf, S1_START, DELAY } from "./helpers";
import { indexOf, ruleTier, TIER } from "../lib/rules";

const BUY_FEES = toNano("0.15");
const find = (from: number, tier: number) => { for (let i = from; i < from + 4000; i++) if (ruleTier(i) === tier) return i; throw new Error("none"); };

describe("Athar season sale", () => {
  it("sells a common date: item minted, money reaches payout, change returned", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, minter, collection, payout } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    const price = await minter.getPrice(0n);
    expect(price).toBe(toNano("0.5"));
    const before = await payout.getBalance();
    const aliceBefore = await alice.getBalance();
    const r = await minter.send(alice.getSender(), { value: price + BUY_FEES + toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    expect(r.transactions).toHaveTransaction({ from: minter.address, to: collection.address, success: true });
    const item = await itemOf(ctx, idx);
    const d = await item.getGetNftData();
    expect(d.isInitialized).toBe(true);
    expect(d.index).toBe(BigInt(idx));
    expect(d.ownerAddress.equals(alice.address)).toBe(true);
    expect(d.collectionAddress.equals(collection.address)).toBe(true);
    const st = await item.getAthar();
    expect(st.paid).toBe(price); expect(st.tier).toBe(0n); expect(st.season).toBe(1n); expect(st.hands).toBe(1n);
    const got = (await payout.getBalance()) - before;
    expect(got).toBeLessThanOrEqual(price); expect(got).toBeGreaterThan(price - toNano("0.001"));   // the full price, at once (minus the wallet's own tiny gas)
    const spent = aliceBefore - (await alice.getBalance());
    expect(spent).toBeLessThan(price + toNano("0.3"));                          // the extra 1 TON came back
    expect(await minter.getIsTaken(BigInt(idx))).toBe(true);
    expect(await minter.getSoldCount()).toBe(1n);
    expect(await collection.getTotalMinted()).toBe(1n);
  });

  it("refuses the same date twice and refunds", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, bob, minter } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    const r = await minter.send(bob.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    expect(r.transactions).toHaveTransaction({ from: bob.address, to: minter.address, success: false });
    expect(r.transactions).toHaveTransaction({ from: minter.address, to: bob.address, inMessageBounced: true });
  });

  it("underpaying is rejected; dates outside the season are rejected; mythic cannot be bought directly", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, minter } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    let r = await minter.send(alice.getSender(), { value: toNano("0.5") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(indexOf(1990, 5, 5)), recipient: null });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(indexOf(2000, 11, 11)), recipient: null });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
  });

  it("price rises with sales and falls by itself when sales stop", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, bc, minter } = ctx;
    const p0 = await minter.getPrice(0n);
    let idx = S1_START; let n = 0;
    while (n < 40) { if (ruleTier(idx) === TIER.COMMON) { await minter.send(alice.getSender(), { value: toNano("3") }, { $$type: "Buy", index: BigInt(idx), recipient: null }); n++; } idx++; }
    const p1 = await minter.getPrice(0n);
    expect(p1).toBeGreaterThan(p0);                                              // demand pushed it up
    bc.now = bc.now! + 5 * 86400;
    const p2 = await minter.getPrice(0n);
    expect(p2).toBeLessThan(p1);                                                 // five quiet days pulled it down
    bc.now = bc.now! + 400 * 86400;
    expect(await minter.getPrice(0n)).toBe(toNano("0.25"));                      // never below the floor
  });

  it("limits purchases per wallet per day", async () => {
    const ctx = await setup(); await openSeason(ctx, { walletCap: 2 });
    const { alice, minter } = ctx;
    let idx = S1_START; const res: boolean[] = [];
    for (let k = 0; k < 3; k++) {
      while (ruleTier(idx) !== TIER.COMMON) idx++;
      const r = await minter.send(alice.getSender(), { value: toNano("2") }, { $$type: "Buy", index: BigInt(idx++), recipient: null });
      res.push(r.transactions.some((t) => t.inMessage?.info.dest?.toString() === minter.address.toString() && (t.description as any).computePhase?.success === true && (t.description as any).aborted === false));
    }
    expect(res).toEqual([true, true, false]);
  });

  it("unauthorised minters and the closed collection cannot mint", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, collection } = ctx;
    const r = await collection.send(alice.getSender(), { value: toNano("1") }, { $$type: "MintItem", index: 5n, newOwner: alice.address, season: 1n, tier: 0n, paid: 0n });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
  });

  it("a rejected mint bounces the money back to the buyer (minter not yet active)", async () => {
    const ctx = await setup();
    const { admin, bc, alice, minter, collection } = ctx;
    await minter.send(admin.getSender(), { value: toNano("0.2") }, { $$type: "Configure", tier: 0n, startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Configure", tier: 1n, startPrice: toNano("3"), floor: toNano("1.5"), cap: toNano("40"), bumpBps: 200n, decayBps: 1500n });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });   // delay not over
    const idx = find(S1_START, TIER.COMMON);
    const before = await alice.getBalance();
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    const after = await alice.getBalance();
    expect(before - after).toBeLessThan(toNano("0.1"));                          // refunded, only gas lost
    expect(await minter.getIsTaken(BigInt(idx))).toBe(false);                    // the date is free again
  });
});

describe("token features", () => {
  async function minted() {
    const ctx = await setup(); await openSeason(ctx);
    const idx = find(S1_START, TIER.COMMON);
    await ctx.minter.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null });
    return { ctx, idx, item: await itemOf(ctx, idx) };
  }

  it("transfer: new owner, hands counted, only the owner can transfer", async () => {
    const { ctx, item } = await minted();
    const { alice, bob } = ctx;
    let r = await item.send(bob.getSender(), { value: toNano("0.1") }, { $$type: "Transfer", queryId: 1n, newOwner: bob.address, responseDestination: bob.address, customPayload: null, forwardAmount: 0n, forwardPayload: beginCell().endCell().asSlice() });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });
    r = await item.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Transfer", queryId: 1n, newOwner: bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 0n, forwardPayload: beginCell().endCell().asSlice() });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: true });
    expect((await item.getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);
    expect((await item.getAthar()).hands).toBe(2n);
  });

  it("engraving: owner only, pays a fee that reaches the payout wallet, text kept with the token", async () => {
    const { ctx, item } = await minted();
    const { alice, bob, payout } = ctx;
    let r = await item.send(bob.getSender(), { value: toNano("0.3") }, { $$type: "Engrave", text: "not mine" });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });
    const before = await payout.getBalance();
    r = await item.send(alice.getSender(), { value: toNano("0.3") }, { $$type: "Engrave", text: "Majd was born today" });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: true });
    expect((await item.getAthar()).engravings).not.toBeNull();
    expect((await payout.getBalance()) - before).toBeGreaterThan(toNano("0.09"));
    r = await item.send(alice.getSender(), { value: toNano("0.3") }, { $$type: "Engrave", text: "x".repeat(40) });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });          // longer than 32 bytes
    r = await item.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "Engrave", text: "cheap" });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });          // fee not attached
  });

  it("metadata follows TEP-62/64 and royalty is 5% to the payout wallet", async () => {
    const { ctx, idx, item } = await minted();
    const { collection, payout } = ctx;
    const data = await item.getGetNftData();
    const full = await collection.getGetNftContent(BigInt(idx), data.individualContent);
    const s = full.beginParse();
    expect(s.loadUint(8)).toBe(1);
    expect(s.loadStringTail()).toContain("https://athar.test/m/");
    const rp = await collection.getRoyaltyParams();
    expect(rp.numerator).toBe(500n); expect(rp.denominator).toBe(10000n);
    expect(rp.destination.equals(payout.address)).toBe(true);
    expect((await collection.getGetNftAddressByIndex(BigInt(idx))).equals(item.address)).toBe(true);
  });
});

describe("timelocks", () => {
  it("payout change needs a public notice period", async () => {
    const ctx = await setup(); const { collection, admin, bob, bc, payout } = ctx;
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposePayout", payout: bob.address });
    let r = await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ApplyPayout" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    expect((await collection.getPayoutAddress())!.equals(payout.address)).toBe(true);
    bc.now = bc.now! + DELAY + 1;
    r = await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ApplyPayout" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: true });
    expect((await collection.getPayoutAddress())!.equals(bob.address)).toBe(true);
  });
  it("only the admin can change anything", async () => {
    const ctx = await setup(); const { collection, alice } = ctx;
    for (const m of [{ $$type: "ProposePayout", payout: alice.address }, { $$type: "ProposeMinter", minter: alice.address }, { $$type: "SetSuccessor", successor: alice.address }] as any[]) {
      const r = await collection.send(alice.getSender(), { value: toNano("0.05") }, m);
      expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    }
  });
});
