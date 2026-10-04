import { toNano, Dictionary } from "@ton/core";
import { setup, itemOf, S1_START } from "./helpers";
import { indexOf, ruleTier, TIER } from "../lib/rules";

const BUY_FEES = toNano("0.15");
const common = () => { for (let i = S1_START; ; i++) if (ruleTier(i) === TIER.COMMON) return i; };
const SPECIAL = indexOf(1969, 7, 20);        // outside the 2000-2007 range, a "special" date

async function open(fees?: { photo: string; silver: string }) {
  const ctx = await setup();
  const { admin, collection, minter, bc } = ctx;
  await minter.send(admin.getSender(), { value: toNano("0.2") }, { $$type: "Configure", tier: 0n, startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n });
  await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Configure", tier: 1n, startPrice: toNano("3"), floor: toNano("1.5"), cap: toNano("40"), bumpBps: 200n, decayBps: 1500n });
  const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
  items.set(SPECIAL, 1);                    // tier 1 (rare) on purpose: it must still be auction-only
  await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "AddSpecial", items });
  if (fees) await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetFees", photoFee: toNano(fees.photo), silverFee: toNano(fees.silver) });
  await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
  await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });
  bc.now = bc.now! + 1;
  return ctx;
}
const buy = (ctx: Awaited<ReturnType<typeof open>>, who: "alice" | "bob", index: number, value: string, style: bigint, mediaRef = 0n) =>
  ctx.minter.send(ctx[who].getSender(), { value: toNano(value) }, { $$type: "Buy", index: BigInt(index), recipient: null, occasion: 0n, mediaRef, style });

describe("feature prices", () => {
  it("only the admin sets fees, within bounds, silver never below photo", async () => {
    const ctx = await open();
    const { minter, alice, admin } = ctx;
    let r = await minter.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "SetFees", photoFee: toNano("0.1"), silverFee: toNano("0.2") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetFees", photoFee: toNano("3"), silverFee: toNano("3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetFees", photoFee: toNano("0.3"), silverFee: toNano("0.1") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetFees", photoFee: toNano("0.15"), silverFee: toNano("0.3") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    const f = await minter.getFees();
    expect(f.photo).toBe(toNano("0.15")); expect(f.silver).toBe(toNano("0.3"));
  });

  it("generated art is free; a photo and the silver treatment add their fee, and that fee reaches the payout wallet", async () => {
    const ctx = await open({ photo: "0.15", silver: "0.3" });
    const { payout, minter } = ctx;
    const idx = common();
    const price = await minter.getPrice(0n);
    // too little for the silver style: refused, nothing minted
    let r = await buy(ctx, "alice", idx, "0.5", 2n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    expect(await minter.getIsTaken(BigInt(idx))).toBe(false);
    // exact amount for style 2
    const before = await payout.getBalance();
    r = await buy(ctx, "alice", idx, ((Number(price + toNano("0.3") + BUY_FEES) / 1e9) + 0.5).toString(), 2n, 7n);
    expect(await minter.getIsTaken(BigInt(idx))).toBe(true);
    const got = (await payout.getBalance()) - before;
    expect(got).toBeGreaterThan(price + toNano("0.3") - toNano("0.001"));
    expect(got).toBeLessThanOrEqual(price + toNano("0.3"));
    const st = await (await itemOf(ctx, idx)).getAthar();
    expect(st.paid).toBe(price);                      // the token records the date's own price, not the feature fee
    expect(st.mediaRef).toBe(7n);
    // style 0 costs nothing extra
    const idx2 = idx + 1; let j = idx2; while (ruleTier(j) !== TIER.COMMON) j++;
    const p2 = await minter.getPrice(0n);
    const b2 = await payout.getBalance();
    await buy(ctx, "bob", j, ((Number(p2 + BUY_FEES) / 1e9) + 0.2).toString(), 0n);
    expect((await payout.getBalance()) - b2).toBeLessThanOrEqual(p2);
    // an unknown style is refused
    let k = j + 1; while (ruleTier(k) !== TIER.COMMON) k++;
    r = await buy(ctx, "bob", k, "2", 3n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
  });
});

describe("special (gold) dates", () => {
  it("cannot be bought directly, even when their tier is rare", async () => {
    const ctx = await open({ photo: "0.15", silver: "0.3" });
    const r = await buy(ctx, "alice", SPECIAL, "5", 0n);
    expect(r.transactions).toHaveTransaction({ to: ctx.minter.address, success: false });
    expect(await ctx.minter.getIsTaken(BigInt(SPECIAL))).toBe(false);
  });

  it("are sold by a long auction that carries the admin's picture, which the winner's token keeps", async () => {
    const ctx = await open({ photo: "0.15", silver: "0.3" });
    const { minter, admin, alice, bc } = ctx;
    const REF = 123456789n;
    let r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: BigInt(SPECIAL), reserve: toNano("25"), duration: BigInt(400 * 86400), mediaRef: REF });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // longer than a year
    r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: BigInt(SPECIAL), reserve: toNano("25"), duration: BigInt(90 * 86400), mediaRef: REF });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    const au = await minter.getAuctionOf(BigInt(SPECIAL));
    expect(au!.mediaRef).toBe(REF);
    await minter.send(alice.getSender(), { value: toNano("26") + BUY_FEES }, { $$type: "Bid", index: BigInt(SPECIAL) });
    bc.now = bc.now! + 91 * 86400;
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(SPECIAL) });
    const item = await itemOf(ctx, SPECIAL);
    expect((await item.getGetNftData()).ownerAddress.equals(alice.address)).toBe(true);
    const st = await item.getAthar();
    expect(st.mediaRef).toBe(REF);
    expect(st.tier).toBe(1n);                          // keeps its own tier
  });
});
