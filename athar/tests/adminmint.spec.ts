import { toNano } from "@ton/core";
import { setup, openSeason, itemOf, S1_START } from "./helpers";
import { ruleTier, TIER } from "../lib/rules";

// The owner's own stock: dates minted to his wallet without the sale price, without moving the price curve or the wallet limit.
const find = (from: number, tier: number, n = 1) => { const out: number[] = []; for (let i = from; out.length < n && i < from + 6000; i++) if (ruleTier(i) === tier) out.push(i); return out; };
const MINT = (index: number, extra: any = {}) => ({ $$type: "AdminMint" as const, index: BigInt(index), recipient: null, occasion: 0n, mediaRef: 0n, ...extra });

describe("AdminMint (the owner's stock)", () => {
  it("mints to the admin without the price; the curve, the wallet limit and the payout do not move; only the fees are spent", async () => {
    const ctx = await setup(); await openSeason(ctx, { walletCap: 2 });
    const { admin, payout, minter } = ctx;
    const dates = find(S1_START, TIER.COMMON, 5);
    const priceBefore = await minter.getPrice(0n), soldBefore = await minter.getSoldCount();
    const payoutBefore = await payout.getBalance(), adminBefore = await admin.getBalance();
    for (const idx of dates) {
      const r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(idx));
      expect(r.transactions).toHaveTransaction({ from: admin.address, to: minter.address, success: true });
      const d = await (await itemOf(ctx, idx)).getGetNftData();
      expect(d.isInitialized).toBe(true);
      expect(d.ownerAddress.equals(admin.address)).toBe(true);
    }
    expect(await minter.getPrice(0n)).toBe(priceBefore);                       // no bump
    expect(await minter.getSoldCount()).toBe(soldBefore + 5n);                // but they are sold: nobody else can have these dates
    expect(await minter.getIsTaken(BigInt(dates[0]))).toBe(true);
    expect((await payout.getBalance()) - payoutBefore).toBeLessThan(toNano("0.001"));      // no sale money moved
    const spent = adminBefore - (await admin.getBalance());
    expect(spent).toBeGreaterThan(toNano("0.38")); expect(spent).toBeLessThan(toNano("0.45"));   // 5 x about 0.08 (0.03 of it stays inside each token as its storage)
  });
  it("can go to another wallet, with an occasion, and past the wallet limit", async () => {
    const ctx = await setup(); await openSeason(ctx, { walletCap: 1 });
    const { admin, bob, minter } = ctx;
    const [a, b, c] = find(S1_START, TIER.COMMON, 3);
    await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(a, { recipient: bob.address, occasion: 2n }));
    expect((await (await itemOf(ctx, a)).getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);
    expect((await (await itemOf(ctx, a)).getAthar()).occasion).toBe(2n);
    await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(b));
    const r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(c));       // the limit of 1 per day does not apply to the admin's stock
    expect(r.transactions).toHaveTransaction({ from: admin.address, to: minter.address, success: true });
  });
  it("only the admin; not before opening; the same date never twice; not a mythic date (those go by auction); not outside the season; not with too little", async () => {
    const ctx = await setup();
    const { admin, alice, minter } = ctx;
    const [d1] = find(S1_START, TIER.COMMON, 1);
    let r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // not open yet
    await openSeason(ctx);
    r = await minter.send(alice.getSender(), { value: toNano("0.2") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // not the admin
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // fees not covered
    r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // taken
    const [m1] = find(S1_START, TIER.MYTHIC, 1);
    r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(m1));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // mythic: by auction
    r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(S1_START - 400));
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });                    // outside the season
  });
  it("a refused mint frees the date and gives the fees back", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { admin, collection, minter, bc } = ctx;
    const [d1] = find(S1_START, TIER.COMMON, 1);
    // the collection stops accepting this minter: its mint bounces
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "RemoveMinter", minter: minter.address });
    const before = await admin.getBalance();
    const r = await minter.send(admin.getSender(), { value: toNano("0.2") }, MINT(d1));
    expect(r.transactions).toHaveTransaction({ from: minter.address, to: collection.address, success: false });
    expect(await minter.getIsTaken(BigInt(d1))).toBe(false);
    expect(before - (await admin.getBalance())).toBeLessThan(toNano("0.06"));                         // only gas lost, the fees came back
  });
});
