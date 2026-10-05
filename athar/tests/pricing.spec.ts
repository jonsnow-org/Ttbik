import { fromNano, toNano, Dictionary } from "@ton/core";
import { setup, itemOf, S1_START, configureKinds, openSeason, ID } from "./helpers";
import { indexOf, ruleTier, TIER } from "../lib/rules";

const BUY_FEES = toNano("0.08");
const common = (from = S1_START) => { for (let i = from; ; i++) if (ruleTier(i) === TIER.COMMON) return i; };
const SPECIAL = indexOf(1969, 7, 20);        // outside the 2000-2007 range, a "special" date

// Whole calendar open, like in production: the range is the 36,525 dates; the designed (special) dates cost an extra fee.
async function open(opts?: { walletMax?: number; goldSupply?: number }) {
  const ctx = await setup();
  const { admin, collection, minter, bc } = ctx;
  await configureKinds(ctx);
  if (opts?.walletMax !== undefined || opts?.goldSupply !== undefined) {
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "Configure", kind: 2n, startPrice: toNano("5"), floor: toNano("2.5"), cap: toNano("80"), bumpBps: 16n, decayBps: 1500n,
      maxSupply: BigInt(opts?.goldSupply ?? 300), specialFee: toNano("10"), photoFee: toNano("0.6"), walletMax: BigInt(opts?.walletMax ?? 0) });
  }
  const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
  items.set(SPECIAL, 1);
  await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "AddSpecial", items });
  await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
  await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });
  bc.now = bc.now! + 1;
  return ctx;
}
const buy = (ctx: Awaited<ReturnType<typeof open>>, who: "alice" | "bob", id: bigint, value: string, style: bigint, mediaRef = 0n) =>
  ctx.minter.send(ctx[who].getSender(), { value: toNano(value) }, { $$type: "Buy", index: id, recipient: null, occasion: 0n, mediaRef, style });

describe("per-kind fees", () => {
  it("only the admin sets them, within bounds, for the direct kinds only", async () => {
    const ctx = await open();
    const { minter, alice, admin } = ctx;
    let r = await minter.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "SetKindFees", kind: 1n, photoFee: toNano("0.1"), specialFee: toNano("2") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetKindFees", kind: 1n, photoFee: toNano("3"), specialFee: toNano("2") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // photo above 2 TON
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetKindFees", kind: 4n, photoFee: toNano("0.1"), specialFee: toNano("2") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // a class is not sold directly
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetKindFees", kind: 1n, photoFee: toNano("0.35"), specialFee: toNano("4") });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    const f = await minter.getKindInfo(1n);
    expect(f.photo).toBe(toNano("0.35")); expect(f.special).toBe(toNano("4"));
  });

  it("generated art is free; an own photo adds its kind's fee, and that fee reaches the payout wallet", async () => {
    const ctx = await open();
    const { payout, minter } = ctx;
    const date = common();
    const id = ID(1, date);                                                                    // silver
    const price = await minter.getPriceOf(id);
    expect(price).toBe(await minter.getPrice(1n));                                             // a plain date: no premium
    let r = await buy(ctx, "alice", id, "1.6", 1n);                                            // silver 1.5 + photo 0.3 + fees: too little
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    expect(await minter.getIsTaken(id)).toBe(false);
    const before = await payout.getBalance();
    r = await buy(ctx, "alice", id, fromNano(price + toNano("0.3") + BUY_FEES + toNano("0.5")), 1n, 7n);
    expect(await minter.getIsTaken(id)).toBe(true);
    const got = (await payout.getBalance()) - before;
    expect(got).toBeGreaterThan(price + toNano("0.3") - toNano("0.001"));
    expect(got).toBeLessThanOrEqual(price + toNano("0.3"));
    const st = await (await itemOf(ctx, Number(id))).getAthar();
    expect(st.paid).toBe(price);                      // the token records the kind's own price, not the photo fee
    expect(st.mediaRef).toBe(7n); expect(st.tier).toBe(1n);
    // style 0 costs nothing extra
    const id2 = ID(1, common(date + 1));
    const p2 = await minter.getPriceOf(id2);
    const b2 = await payout.getBalance();
    await buy(ctx, "bob", id2, fromNano(p2 + BUY_FEES + toNano("0.2")), 0n);
    expect((await payout.getBalance()) - b2).toBeLessThanOrEqual(p2);
    // a style that no longer exists is refused (the silver treatment is a kind now, not a style)
    r = await buy(ctx, "bob", ID(1, common(date + 5)), "5", 2n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
  });
});

describe("price of a date", () => {
  it("a patterned date costs more than a plain one, in every direct kind: rare pattern x1.5, mythic pattern x2", async () => {
    const ctx = await open();
    const { minter } = ctx;
    const find = (t: number) => { for (let i = S1_START; ; i++) if (ruleTier(i) === t) return i; };
    for (let k = 0; k < 3; k++) {
      const base = await minter.getPrice(BigInt(k));
      expect(await minter.getPriceOf(ID(k, common()))).toBe(base);
      expect(await minter.getPriceOf(ID(k, find(TIER.RARE)))).toBe(base * 3n / 2n);
      expect(await minter.getPriceOf(ID(k, find(TIER.MYTHIC)))).toBe(base * 2n);
    }
  });
  it("a class token is never for direct sale", async () => {
    const ctx = await open();
    expect(await ctx.minter.getPriceOf(ID(4, common()))).toBe(0n);
    const r = await buy(ctx, "alice", ID(4, common()), "50", 0n);
    expect(r.transactions).toHaveTransaction({ to: ctx.minter.address, success: false });
  });
});

describe("designed (special) dates", () => {
  it("are sold directly in the three kinds at the kind's special fee on top, and the same date can be bought in each kind", async () => {
    const ctx = await open();
    const { minter, payout } = ctx;
    const base0 = await minter.getPrice(0n);
    const p0 = await minter.getPriceOf(ID(0, SPECIAL));
    const rule = ruleTier(SPECIAL);
    const premium = rule === TIER.MYTHIC ? base0 * 2n : rule === TIER.RARE ? base0 * 3n / 2n : base0;
    expect(p0).toBe(premium + toNano("1"));                                                    // normal: +1
    expect(await minter.getPriceOf(ID(2, SPECIAL))).toBeGreaterThan(toNano("10"));            // gold: +10
    const before = await payout.getBalance();
    await buy(ctx, "alice", ID(0, SPECIAL), fromNano(p0 + BUY_FEES + toNano("0.5")), 0n);
    expect(await minter.getIsTaken(ID(0, SPECIAL))).toBe(true);
    expect((await payout.getBalance()) - before).toBeGreaterThan(p0 - toNano("0.001"));
    const pg = await minter.getPriceOf(ID(2, SPECIAL));
    await buy(ctx, "bob", ID(2, SPECIAL), fromNano(pg + BUY_FEES + toNano("0.5")), 0n);
    expect(await minter.getIsTaken(ID(2, SPECIAL))).toBe(true);                                // gold of the same date
    const r = await buy(ctx, "bob", ID(0, SPECIAL), "20", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // normal of that date is taken
  });

  it("a class token of a special date is sold by a long auction that carries the admin's picture, which the winner's token keeps", async () => {
    const ctx = await open();
    const { minter, admin, alice, bc } = ctx;
    const REF = 123456789n, id = ID(6, SPECIAL);                                               // diamond
    let r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: id, reserve: toNano("25"), duration: BigInt(400 * 86400), mediaRef: REF });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // longer than a year
    r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: id, reserve: toNano("25"), duration: BigInt(90 * 86400), mediaRef: REF });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    const au = await minter.getAuctionOf(id);
    expect(au!.mediaRef).toBe(REF);
    await minter.send(alice.getSender(), { value: toNano("26") + BUY_FEES }, { $$type: "Bid", index: id });
    bc.now = bc.now! + 91 * 86400;
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: id });
    const item = await itemOf(ctx, Number(id));
    expect((await item.getGetNftData()).ownerAddress.equals(alice.address)).toBe(true);
    const st = await item.getAthar();
    expect(st.mediaRef).toBe(REF);
    expect(st.tier).toBe(6n);
  });
  it("direct kinds cannot be auctioned", async () => {
    const ctx = await open();
    const r = await ctx.minter.send(ctx.admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: ID(2, common()), reserve: toNano("5"), duration: 3600n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ to: ctx.minter.address, success: false });
  });
});

describe("supply caps and wallet limits", () => {
  it("a kind sells out at its cap, and an announced cap can only be lowered, never raised, even by the admin", async () => {
    const ctx = await open({ goldSupply: 2 });
    const { minter, admin } = ctx;
    for (let k = 0; k < 2; k++) await buy(ctx, k ? "bob" : "alice", ID(2, common(S1_START + k * 5)), "9", 0n);
    expect((await minter.getKindInfo(2n)).issued).toBe(2n);
    let r = await buy(ctx, "alice", ID(2, common(S1_START + 50)), "9", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // sold out
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetCap", kind: 2n, cap: 5n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // raising is refused once open
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetCap", kind: 7n, cap: 20n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // also a class cap
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetCap", kind: 7n, cap: 4n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });           // lowering is allowed
    expect((await minter.getKindInfo(7n)).cap).toBe(4n);
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetCap", kind: 2n, cap: 1n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // below what is already issued
  });
  it("a wallet cannot buy more than its limit of a kind", async () => {
    const ctx = await open({ walletMax: 1 });
    const { minter } = ctx;
    let r = await buy(ctx, "alice", ID(2, common()), "9", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    r = await buy(ctx, "alice", ID(2, common(S1_START + 10)), "9", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // second gold for the same wallet
    r = await buy(ctx, "alice", ID(0, common(S1_START + 10)), "2", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });           // normal is a different kind
    r = await buy(ctx, "bob", ID(2, common(S1_START + 10)), "9", 0n);
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });           // another wallet is free to
  });
  it("the sale cannot open before every kind has a cap", async () => {
    const ctx = await setup();
    const { admin, minter } = ctx;
    for (let k = 0; k < 3; k++) await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "Configure", kind: BigInt(k), startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n, maxSupply: 100n, specialFee: 0n, photoFee: 0n, walletMax: 0n });
    const r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: 0n, walletDailyCap: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // the classes have no cap yet
    expect(await minter.getStatus()).toBe(0n);
  });
});

describe("a half-loaded mystery pool can never open the sale", () => {
  it("Open refuses until every declared pool entry has arrived", async () => {
    const ctx = await setup();
    const { admin, minter, bc } = ctx;
    await configureKinds(ctx);
    const dates: bigint[] = []; for (let i = S1_START + 100; dates.length < 10; i++) if (ruleTier(i) === TIER.COMMON) dates.push(ID(dates.length % 2 ? 3 : 0, i));
    const load = (from: number, to: number) => { const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32)); for (let k = from; k < to; k++) items.set(k, Number(dates[k])); return minter.send(admin.getSender(), { value: toNano("0.3") }, { $$type: "LoadPool", items }); };
    await load(0, 3);
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "SetMystery", commitHash: 1n, revealAt: BigInt(bc.now! + 86400), startPrice: toNano("1.1"), floor: toNano("0.6"), cap: toNano("20"), bumpBps: 60n, decayBps: 1500n, poolExpected: 10n });
    let r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });           // 3 of 10 loaded: the pool is contiguous but incomplete
    expect(await minter.getStatus()).toBe(0n);
    await load(3, 10);
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    expect(await minter.getStatus()).toBe(1n);
  });
});
void openSeason;
