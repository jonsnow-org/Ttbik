import { toNano } from "@ton/core";
import { setup, openSeason, itemOf, S1_START, ID } from "./helpers";
import { ruleTier, TIER } from "../lib/rules";

const common = () => { for (let i = S1_START; ; i++) if (ruleTier(i) === TIER.COMMON) return i; };

describe("the front-page state in one read", () => {
  it("season_view agrees with the individual getters", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, alice } = ctx;
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(common()), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    const v = await minter.getSeasonView();
    expect(v.status).toBe(1n); expect(v.sold).toBe(1n);
    expect(v.p0).toBe(await minter.getPrice(0n)); expect(v.p1).toBe(await minter.getPrice(1n)); expect(v.p2).toBe(await minter.getPrice(2n));
    const all = [v.k0, v.k1, v.k2, v.k3, v.k4, v.k5, v.k6, v.k7];
    for (let k = 0; k < 8; k++) { const ki = await minter.getKindInfo(BigInt(k)); expect(all[k].cap).toBe(ki.cap); expect(all[k].issued).toBe(ki.issued); expect(all[k].photo).toBe(ki.photo); }
    expect(all[0].issued).toBe(1n);
    expect(v.revealed).toBe(false); expect(v.pool).toBe(0n);
  });
});

describe("an id is minted once, whichever minter asks", () => {
  it("a second minter selling an id that already exists is refused by the collection, and the buyer gets the money back", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, collection, admin, alice, bob, bc } = ctx;
    const id = BigInt(common());
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: id, recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    expect(await collection.getTotalMinted()).toBe(1n);
    // the owner authorises a second seller (here: his own wallet, standing in for a new minter) after the notice period
    await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: bob.address });
    bc.now = bc.now! + 3700;
    const r = await collection.send(bob.getSender(), { value: toNano("1") }, { $$type: "MintItem", index: id, newOwner: bob.address, season: 1n, tier: 0n, paid: 0n, occasion: 0n, mediaRef: 0n, remit: 0n });
    expect(r.transactions).toHaveTransaction({ from: bob.address, to: collection.address, success: false });
    expect(r.transactions).toHaveTransaction({ from: collection.address, to: bob.address, inMessageBounced: true });
    expect(await collection.getTotalMinted()).toBe(1n);
  });
});

describe("one date, many kinds", () => {
  it("the same date can be bought as normal, silver and gold, each once; the app reads it all in one call", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, alice, bob, admin } = ctx;
    const date = common();
    let v = await minter.getDateView(BigInt(date));
    expect(v.taken).toBe(0n); expect(v.auction).toBe(0n); expect(v.reserved).toBe(0n);
    expect(v.p0).toBe(toNano("0.5")); expect(v.p1).toBe(toNano("1.5")); expect(v.p2).toBe(toNano("5"));
    for (const [who, k, pay] of [[alice, 0, "1"], [bob, 1, "2"], [alice, 2, "6"]] as const) {
      const r = await minter.send(who.getSender(), { value: toNano(pay) }, { $$type: "Buy", index: ID(k, date), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
      expect(r.transactions).toHaveTransaction({ to: minter.address, success: true });
    }
    v = await minter.getDateView(BigInt(date));
    expect(v.taken).toBe(0b111n);
    // each kind is its own token with its own owner and its own kind
    const owners = [alice, bob, alice];
    for (let k = 0; k < 3; k++) {
      const item = await itemOf(ctx, k * 65536 + date);
      expect((await item.getGetNftData()).ownerAddress.equals(owners[k].address)).toBe(true);
      expect((await item.getAthar()).tier).toBe(BigInt(k));
    }
    // a class of the same date, minted by the owner
    await minter.send(admin.getSender(), { value: toNano("0.2") }, { $$type: "AdminMint", index: ID(5, date), recipient: null, occasion: 0n, mediaRef: 0n });
    expect((await minter.getDateView(BigInt(date))).taken).toBe(0b100111n);
    expect(await ctx.collection.getTotalMinted()).toBe(4n);
  });
  it("a class token under auction shows in the date view, and the auctions can be listed", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { minter, admin } = ctx;
    const date = common();
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: ID(6, date), reserve: toNano("5"), duration: 3600n, mediaRef: 0n });
    await minter.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "StartAuction", index: ID(7, date + 3), reserve: toNano("5"), duration: 3600n, mediaRef: 0n });
    expect((await minter.getDateView(BigInt(date))).auction).toBe(1n << 6n);
    expect(await minter.getAuctionCount()).toBe(2n);
    expect(await minter.getAuctionIdAt(0n)).toBe(ID(6, date));
    expect(await minter.getAuctionIdAt(1n)).toBe(ID(7, date + 3));
    // restarting a void auction does not list it twice
  });
});
