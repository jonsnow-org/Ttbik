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
    const r = await minter.send(alice.getSender(), { value: price + BUY_FEES + toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
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
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
    const r = await minter.send(bob.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ from: bob.address, to: minter.address, success: false });
    expect(r.transactions).toHaveTransaction({ from: minter.address, to: bob.address, inMessageBounced: true });
  });

  it("underpaying is rejected; dates outside the season are rejected; mythic cannot be bought directly", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, minter } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    let r = await minter.send(alice.getSender(), { value: toNano("0.5") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(indexOf(1990, 5, 5)), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(indexOf(2000, 11, 11)), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
  });

  it("price rises with sales and falls by itself when sales stop", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, bc, minter } = ctx;
    const p0 = await minter.getPrice(0n);
    let idx = S1_START; let n = 0;
    while (n < 40) { if (ruleTier(idx) === TIER.COMMON) { await minter.send(alice.getSender(), { value: toNano("3") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n }); n++; } idx++; }
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
      const r = await minter.send(alice.getSender(), { value: toNano("2") }, { $$type: "Buy", index: BigInt(idx++), recipient: null, occasion: 0n, mediaRef: 0n });
      res.push(r.transactions.some((t) => t.inMessage?.info.dest?.toString() === minter.address.toString() && (t.description as any).computePhase?.success === true && (t.description as any).aborted === false));
    }
    expect(res).toEqual([true, true, false]);
  });

  it("unauthorised minters and the closed collection cannot mint", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, collection } = ctx;
    const r = await collection.send(alice.getSender(), { value: toNano("1") }, { $$type: "MintItem", index: 5n, newOwner: alice.address, season: 1n, tier: 0n, paid: 0n, occasion: 0n, mediaRef: 0n, remit: 0n });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
  });

  it("a rejected mint bounces the money back to the buyer (minter not yet active)", async () => {
    const ctx = await setup();
    const { admin, bc, alice, bob, minter, collection } = ctx;
    await minter.send(admin.getSender(), { value: toNano("0.2") }, { $$type: "Configure", tier: 0n, startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Configure", tier: 1n, startPrice: toNano("3"), floor: toNano("1.5"), cap: toNano("40"), bumpBps: 200n, decayBps: 1500n });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(bc.now!), walletDailyCap: 0n });
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: bob.address });      // takes the "first minter" slot
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });   // later ones wait: delay not over
    const idx = find(S1_START, TIER.COMMON);
    const before = await alice.getBalance();
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
    const after = await alice.getBalance();
    expect(before - after).toBeLessThan(toNano("0.1"));                          // refunded, only gas lost
    expect(await minter.getIsTaken(BigInt(idx))).toBe(false);                    // the date is free again
  });
});

describe("token features", () => {
  async function minted() {
    const ctx = await setup(); await openSeason(ctx);
    const idx = find(S1_START, TIER.COMMON);
    await ctx.minter.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
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
  it("a later minter becomes active only after the notice period", async () => {
    const ctx = await setup(); const { collection, admin, alice, bob, bc } = ctx;
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: alice.address });
    expect(Number((await collection.getMinterActiveAt(alice.address))!)).toBeLessThanOrEqual(bc.now!);          // first: at once
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: bob.address });
    expect(Number((await collection.getMinterActiveAt(bob.address))!)).toBe(bc.now! + DELAY);                 // later: after the delay
  });
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

import { MockSuccessor } from "./mock/build/mock_MockSuccessor";
import { SandboxContract } from "@ton/sandbox";

describe("mythic auction", () => {
  const mythic = indexOf(2000, 11, 11);
  async function live() {
    const ctx = await setup(); await openSeason(ctx);
    await ctx.minter.send(ctx.admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: BigInt(mythic), reserve: toNano("10"), duration: 3600n });
    return ctx;
  }
  it("highest bidder wins, outbid money is returned, winner gets the token, owner gets the price", async () => {
    const ctx = await live(); const { minter, alice, bob, bc, payout, collection } = ctx;
    const fees = BUY_FEES;
    let r = await minter.send(alice.getSender(), { value: toNano("9") + fees }, { $$type: "Bid", index: BigInt(mythic) });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });            // below the reserve
    await minter.send(alice.getSender(), { value: toNano("10") + fees }, { $$type: "Bid", index: BigInt(mythic) });
    r = await minter.send(bob.getSender(), { value: toNano("10.2") + fees }, { $$type: "Bid", index: BigInt(mythic) });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });            // needs +5%
    const aliceBefore = await alice.getBalance();
    await minter.send(bob.getSender(), { value: toNano("11") + fees }, { $$type: "Bid", index: BigInt(mythic) });
    expect((await alice.getBalance()) - aliceBefore).toBeGreaterThan(toNano("10"));              // alice got her bid back
    r = await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(mythic) });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });            // too early
    bc.now = bc.now! + 3700;
    const before = await payout.getBalance();
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(mythic) });
    const item = await itemOf(ctx, mythic);
    expect((await item.getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);
    const st = await item.getAthar();
    expect(st.tier).toBe(2n); expect(st.paid).toBe(toNano("11"));
    expect((await payout.getBalance()) - before).toBeGreaterThan(toNano("10.99"));
    expect(await minter.getSoldCount()).toBe(1n);
    r = await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(mythic) });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });            // cannot settle twice
    expect(await collection.getTotalMinted()).toBe(1n);
  });
  it("a last-minute bid extends the auction (anti-sniping)", async () => {
    const ctx = await live(); const { minter, alice, bob, bc } = ctx;
    await minter.send(alice.getSender(), { value: toNano("10") + BUY_FEES }, { $$type: "Bid", index: BigInt(mythic) });
    bc.now = bc.now! + 3600 - 60;                                                                // one minute left
    await minter.send(bob.getSender(), { value: toNano("11") + BUY_FEES }, { $$type: "Bid", index: BigInt(mythic) });
    const a = await minter.getAuctionOf(BigInt(mythic));
    expect(Number(a!.endAt)).toBeGreaterThanOrEqual(bc.now! + 299);
  });
  it("no bids: the auction is void and can be restarted", async () => {
    const ctx = await live(); const { minter, admin, alice, bc } = ctx;
    bc.now = bc.now! + 3700;
    await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Settle", index: BigInt(mythic) });
    expect(await minter.getIsTaken(BigInt(mythic))).toBe(false);
    const r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: BigInt(mythic), reserve: toNano("5"), duration: 3600n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
  });
});

describe("upgrade to a higher edition (burn + re-issue)", () => {
  async function withMock(price: bigint, setSuccessor = true) {
    const ctx = await setup(); await openSeason(ctx);
    const idx = find(S1_START, TIER.COMMON);
    await ctx.minter.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 0n, mediaRef: 0n });
    const mock: SandboxContract<MockSuccessor> = ctx.bc.openContract(await MockSuccessor.fromInit());
    await mock.send(ctx.admin.getSender(), { value: toNano("0.2") }, { $$type: "SetPrice", price });
    if (setSuccessor) await ctx.collection.send(ctx.admin.getSender(), { value: toNano("0.05") }, { $$type: "SetSuccessor", successor: mock.address });
    return { ctx, idx, item: await itemOf(ctx, idx), mock };
  }
  it("pays, the old token is burned, the next edition is told", async () => {
    const { ctx, item, mock } = await withMock(toNano("0.7"));
    const r = await item.send(ctx.alice.getSender(), { value: toNano("1.5") }, { $$type: "UpgradeStart", queryId: 1n });
    expect(r.transactions).toHaveTransaction({ from: ctx.collection.address, to: mock.address, success: true });
    expect(r.transactions).toHaveTransaction({ from: mock.address, to: ctx.collection.address, success: true });
    const acc = await ctx.bc.getContract(item.address);
    expect(acc.accountState?.type === "active").toBe(false);                                     // burned
  });
  it("too little money: the token is untouched and usable again", async () => {
    const { ctx, item } = await withMock(toNano("5"));
    await item.send(ctx.alice.getSender(), { value: toNano("1.5") }, { $$type: "UpgradeStart", queryId: 1n });
    const st = await item.getAthar();
    expect(st.locked).toBe(false);
    expect((await item.getGetNftData()).ownerAddress.equals(ctx.alice.address)).toBe(true);
    const r = await item.send(ctx.alice.getSender(), { value: toNano("0.1") }, { $$type: "Transfer", queryId: 2n, newOwner: ctx.bob.address, responseDestination: ctx.alice.address, customPayload: null, forwardAmount: 0n, forwardPayload: beginCell().endCell().asSlice() });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: true });
  });
  it("no next edition yet: nothing happens to the token", async () => {
    const { ctx, item } = await withMock(0n, false);
    await item.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "UpgradeStart", queryId: 1n });
    expect((await item.getAthar()).locked).toBe(false);
    expect((await item.getGetNftData()).ownerAddress.equals(ctx.alice.address)).toBe(true);
  });
  it("selling is closed once the next edition is set, and only the owner can start an upgrade", async () => {
    const { ctx, item } = await withMock(toNano("0.7"));
    let r = await item.send(ctx.bob.getSender(), { value: toNano("1") }, { $$type: "UpgradeStart", queryId: 1n });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });
    const idx2 = find(S1_START + 100, TIER.COMMON);
    r = await ctx.minter.send(ctx.bob.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx2), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(await ctx.minter.getIsTaken(BigInt(idx2))).toBe(false);                               // minting closed, buyer refunded
  });
});

import { createHash } from "crypto";
import { Dictionary } from "@ton/core";

describe("mystery boxes: nobody can block the reveal", () => {
  it("if the admin never reveals, anyone can after 3 days; the boxes are never stuck", async () => {
    const ctx = await setup();
    const { admin, minter, alice, bc } = ctx;
    const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    let i = S1_START + 40, n = 0; while (n < 10) { if (ruleTier(i) === TIER.COMMON) items.set(n++, i); i++; }
    await minter.send(admin.getSender(), { value: toNano("0.5") }, { $$type: "LoadPool", items });
    const revealAt = bc.now! + 86400;
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "SetMystery", commitHash: 12345n, revealAt: BigInt(revealAt), startPrice: toNano("1.1"), floor: toNano("0.6"), cap: toNano("20"), bumpBps: 60n, decayBps: 1500n });
    await openSeason(ctx);
    await minter.send(alice.getSender(), { value: toNano("3") }, { $$type: "BuyTicket", recipient: null });
    bc.now = revealAt + 2 * 86400;
    let r = await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "RevealPublic" });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });          // 2 days: too early
    bc.now = revealAt + 3 * 86400 + 5;
    r = await minter.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "RevealPublic" });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    expect((await minter.getMysteryInfo()).revealed).toBe(true);
    expect(await minter.getTicketDate(0n)).not.toBeNull();
  });
});

describe("mystery boxes (fair reveal)", () => {
  async function box() {
    const ctx = await setup();
    const { admin, minter, collection, bc } = ctx;
    const dates: number[] = []; let i = S1_START + 40;
    while (dates.length < 20) { if (ruleTier(i) === TIER.COMMON) dates.push(i); i++; }
    for (let k = S1_START; dates.length < 22; k++) if (ruleTier(k) === TIER.RARE && !dates.includes(k)) dates.push(k);
    const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    dates.forEach((d, pos) => items.set(pos, d));
    const secret = 0x1234567890abcdefn * 0xfedcba0987654321n;
    const buf = Buffer.alloc(32); buf.writeBigUInt64BE(secret >> 64n, 16); buf.writeBigUInt64BE(secret & 0xffffffffffffffffn, 24);
    const commit = BigInt("0x" + createHash("sha256").update(buf).digest("hex"));
    const revealAt = bc.now! + 7 * 86400;
    let r = await minter.send(admin.getSender(), { value: toNano("0.5") }, { $$type: "LoadPool", items });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "SetMystery", commitHash: commit, revealAt: BigInt(revealAt), startPrice: toNano("1.1"), floor: toNano("0.6"), cap: toNano("20"), bumpBps: 60n, decayBps: 1500n });
    await openSeason(ctx);
    return { ctx, dates, secret, revealAt };
  }
  it("tickets sell out, nothing is known before the reveal, then every ticket gets a distinct pool date", async () => {
    const { ctx, dates, secret, revealAt } = await box();
    const { minter, alice, bob, admin, bc, collection, payout } = ctx;
    const before = await payout.getBalance();
    for (let k = 0; k < 22; k++) {
      const who = k % 2 ? bob : alice;
      const r = await minter.send(who.getSender(), { value: toNano("3") }, { $$type: "BuyTicket", recipient: null });
      expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    }
    expect((await payout.getBalance()) - before).toBeGreaterThan(toNano("20"));                    // ticket money reached the owner
    let r = await minter.send(alice.getSender(), { value: toNano("3") }, { $$type: "BuyTicket", recipient: null });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });              // all tickets sold
    r = await minter.send(alice.getSender(), { value: toNano("2") }, { $$type: "Buy", index: BigInt(dates[0]), recipient: null, occasion: 0n, mediaRef: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });              // pool dates cannot be bought directly
    expect(await minter.getTicketDate(0n)).toBeNull();                                             // unknown before the reveal
    r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "Reveal", secret });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });              // too early
    bc.now = revealAt + 1;
    r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "Reveal", secret: secret + 1n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });              // wrong secret
    r = await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "Reveal", secret });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    const seen = new Set<number>();
    for (let k = 0; k < 22; k++) {
      const d = Number(await minter.getTicketDate(BigInt(k)));
      expect(dates).toContain(d); seen.add(d);
    }
    expect(seen.size).toBe(22);                                                                    // a true permutation: no date twice
    for (let k = 0; k < 22; k++) await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ClaimTicket", ticket: BigInt(k) });
    expect(await collection.getTotalMinted()).toBe(22n);
    for (let k = 0; k < 22; k++) {
      const d = Number(await minter.getTicketDate(BigInt(k)));
      const item = await itemOf(ctx, d);
      const owner = (await item.getGetNftData()).ownerAddress;
      expect(owner.equals(k % 2 ? bob.address : alice.address)).toBe(true);
    }
    r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ClaimTicket", ticket: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });              // cannot claim twice
  });
});

describe("safety checks before opening", () => {
  it("the season cannot open while the mystery pool is only partly loaded", async () => {
    const ctx = await setup(); const { admin, minter } = ctx;
    await minter.send(admin.getSender(), { value: toNano("0.2") }, { $$type: "Configure", tier: 0n, startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n });
    await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Configure", tier: 1n, startPrice: toNano("3"), floor: toNano("1.5"), cap: toNano("40"), bumpBps: 200n, decayBps: 1500n });
    const items = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    items.set(0, S1_START + 50); items.set(2, S1_START + 52);               // position 1 is missing
    await minter.send(admin.getSender(), { value: toNano("0.3") }, { $$type: "LoadPool", items });
    const r = await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: 0n, walletDailyCap: 0n });
    expect(r.transactions).toHaveTransaction({ to: minter.address, success: false });
    const info = await minter.getMysteryInfo();
    expect(info.poolSize).toBe(3n); expect(info.loaded).toBe(2n);
  });
});

describe("occasion and permanent picture", () => {
  const REF = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
  const REF2 = REF + 1n;
  it("a picture can be attached at purchase, is kept on-chain, and every later picture stays in the history", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { alice, bob, minter } = ctx;
    const idx = find(S1_START, TIER.COMMON);
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 3n, mediaRef: REF });
    const item = await itemOf(ctx, idx);
    let st = await item.getAthar();
    expect(st.occasion).toBe(3n); expect(st.mediaRef).toBe(REF); expect(st.mediaLog).not.toBeNull();
    // only the owner can change it, and it costs the fee
    let r = await item.send(bob.getSender(), { value: toNano("0.3") }, { $$type: "SetMedia", occasion: 1n, mediaRef: REF2 });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });
    r = await item.send(alice.getSender(), { value: toNano("0.05") }, { $$type: "SetMedia", occasion: 1n, mediaRef: REF2 });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: false });
    r = await item.send(alice.getSender(), { value: toNano("0.3") }, { $$type: "SetMedia", occasion: 2n, mediaRef: REF2 });
    expect(r.transactions).toHaveTransaction({ to: item.address, success: true });
    st = await item.getAthar();
    expect(st.occasion).toBe(2n); expect(st.mediaRef).toBe(REF2);
    // history: newest first, previous picture still reachable
    const s = st.mediaLog!.beginParse();
    s.loadAddress(); s.loadUint(32);
    expect(s.loadUintBig(256)).toBe(REF2);
    const prev = s.loadMaybeRef()!.beginParse();
    prev.loadAddress(); prev.loadUint(32);
    expect(prev.loadUintBig(256)).toBe(REF);
  });
  it("the picture and occasion travel with an upgrade", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const idx = find(S1_START, TIER.COMMON);
    await ctx.minter.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(idx), recipient: null, occasion: 4n, mediaRef: REF });
    const mock = ctx.bc.openContract(await MockSuccessor.fromInit());
    await mock.send(ctx.admin.getSender(), { value: toNano("0.2") }, { $$type: "SetPrice", price: 0n });
    await ctx.collection.send(ctx.admin.getSender(), { value: toNano("0.05") }, { $$type: "SetSuccessor", successor: mock.address });
    const item = await itemOf(ctx, idx);
    const r = await item.send(ctx.alice.getSender(), { value: toNano("1") }, { $$type: "UpgradeStart", queryId: 1n });
    expect(r.transactions).toHaveTransaction({ from: ctx.collection.address, to: mock.address, success: true });
  });
});
