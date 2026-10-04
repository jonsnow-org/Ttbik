import { toNano, Dictionary } from "@ton/core";
import { setup, openSeason, itemOf, S1_START } from "./helpers";
import { indexOf, ruleTier, TIER } from "../lib/rules";

const BUY_FEES = toNano("0.15");
const MINT_FEES = toNano("0.1");     // the minter keeps at least this per unclaimed ticket (constant in messages.tact is the real bound; see below)
const balanceOf = async (ctx: Awaited<ReturnType<typeof setup>>, a: any) => (await ctx.bc.getContract(a)).balance;

describe("Sweep can never take money that is owed", () => {
  const mythic = indexOf(2000, 11, 11);
  it("a live auction keeps its bid through Sweep, and the winner still gets the token", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, admin, alice, bob, bc, payout } = ctx;
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: BigInt(mythic), reserve: toNano("10"), duration: 3600n, mediaRef: 0n });
    await minter.send(alice.getSender(), { value: toNano("10") + BUY_FEES }, { $$type: "Bid", index: BigInt(mythic) });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    expect(await balanceOf(ctx, minter.address)).toBeGreaterThanOrEqual(toNano("10"));          // the bid is still there
    const aliceBefore = await alice.getBalance();
    await minter.send(bob.getSender(), { value: toNano("11") + BUY_FEES }, { $$type: "Bid", index: BigInt(mythic) });
    expect((await alice.getBalance()) - aliceBefore).toBeGreaterThan(toNano("10"));               // outbid refund still paid after a sweep
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    expect(await balanceOf(ctx, minter.address)).toBeGreaterThanOrEqual(toNano("11"));
    bc.now = bc.now! + 3700;
    const before = await payout.getBalance();
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(mythic) });
    expect((await (await itemOf(ctx, mythic)).getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);
    expect((await payout.getBalance()) - before).toBeGreaterThan(toNano("10.99"));
    // nothing owed any more: now a sweep may take the dust
    const adminBefore = await admin.getBalance();
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    expect(await balanceOf(ctx, minter.address)).toBeLessThan(toNano("0.2"));
    expect((await admin.getBalance()) - adminBefore).toBeGreaterThan(-toNano("0.05"));
  });

  it("tickets keep the mint fee for their claim through Sweep", async () => {
    const ctx = await setup();
    const { admin, minter, alice, bc, collection } = ctx;
    const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    let i = S1_START + 40, n = 0; while (n < 6) { if (ruleTier(i) === TIER.COMMON) items.set(n++, i); i++; }
    await minter.send(admin.getSender(), { value: toNano("0.5") }, { $$type: "LoadPool", items });
    const revealAt = bc.now! + 86400;
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "SetMystery", commitHash: 1n, revealAt: BigInt(revealAt), startPrice: toNano("1.1"), floor: toNano("0.6"), cap: toNano("20"), bumpBps: 60n, decayBps: 1500n, poolExpected: 6n });
    await openSeason(ctx);
    for (let k = 0; k < 3; k++) await minter.send(alice.getSender(), { value: toNano("3") }, { $$type: "BuyTicket", recipient: null });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    expect(await balanceOf(ctx, minter.address)).toBeGreaterThanOrEqual(MINT_FEES * 3n);
    bc.now = revealAt + 3 * 86400 + 5;
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "RevealPublic" });
    for (let k = 0; k < 3; k++) await minter.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "ClaimTicket", ticket: BigInt(k) });
    expect(await collection.getTotalMinted()).toBe(3n);                                           // every claim still worked after the sweep
  });
});

describe("input limits", () => {
  it("an occasion outside the known list is refused", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, alice } = ctx;
    let idx = S1_START; while (ruleTier(idx) !== TIER.COMMON) idx++;
    const r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 200n, mediaRef: 0n, style: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
  });
});

describe("prices can follow the market after opening", () => {
  it("only the admin can move a tier's band; the price is pulled inside it; bad bounds are refused", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, admin, alice } = ctx;
    expect(await minter.getPrice(0n)).toBe(toNano("0.5"));
    let r = await minter.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 0n, floor: toNano("1"), cap: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 0n, floor: toNano("4"), cap: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // floor above cap
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 0n, floor: toNano("0.01"), cap: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // floor under 0.05 TON
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 2n, floor: toNano("1"), cap: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // mythic dates have no band: they are auctioned
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 0n, floor: toNano("1"), cap: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    expect(await minter.getPrice(0n)).toBe(toNano("1"));                                        // 0.5 was under the new floor
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Reprice", tier: 0n, floor: toNano("0.05"), cap: toNano("0.3") });
    expect(await minter.getPrice(0n)).toBe(toNano("0.3"));                                      // pulled under the new cap
  });
});
