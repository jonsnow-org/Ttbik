// Rehearsal of the owner's "launch" button: runs the EXACT wallet requests the admin panel produces
// (deployments, configuration, 500-date pool in chunks, opening) against the sandbox, then buys.
process.env.NEXT_PUBLIC_SITE_URL = "https://athar.example.com";
import { Blockchain } from "@ton/sandbox";
import { Address, Cell, loadStateInit, toNano } from "@ton/core";
import { createHash } from "crypto";
import { launchSteps, auctionMsgs } from "../web/lib/launch";
import { SEASON_1, buildPool, seasonTier } from "../web/lib/seasons";
import { AtharCollection } from "../build/athar_AtharCollection";
import { AtharMinter } from "../build/athar_AtharMinter";
import { AtharItem } from "../build/athar_AtharItem";

describe("launch rehearsal (what the admin button does)", () => {
  it("publishes season 1 end to end and then sells", async () => {
    const bc = await Blockchain.create(); bc.now = 1_800_000_000;
    const admin = await bc.treasury("admin", { balance: toNano("100") });
    const payout = await bc.treasury("payout");
    const alice = await bc.treasury("alice");
    const secret = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890n;
    const buf = Buffer.from(secret.toString(16).padStart(64, "0"), "hex");
    const commit = BigInt("0x" + createHash("sha256").update(buf).digest("hex"));
    const startAt = bc.now + 600, revealAt = startAt + 7 * 86400;
    const { steps, collection, minter, poolDates } = await launchSteps(admin.address, payout.address, SEASON_1, { startAt, commit, revealAt });
    expect(poolDates.length).toBe(500);

    const before = await admin.getBalance();
    let msgCount = 0;
    for (const step of steps) {
      for (const m of step.messages) {                                      // one message at a time = the most conservative wallet
        const r = await admin.send({ to: Address.parse(m.address), value: BigInt(m.amount), bounce: true,
          init: m.stateInit ? loadStateInit(Cell.fromBase64(m.stateInit).beginParse()) : undefined,
          body: m.payload ? Cell.fromBase64(m.payload) : undefined });
        msgCount++;
        const bad = r.transactions.filter((t) => (t.description as any).computePhase?.type === "vm" && !(t.description as any).computePhase.success);
        if (bad.length) throw new Error(`step "${step.title}" message ${msgCount} failed: exit ${(bad[0].description as any).computePhase.exitCode}`);
      }
    }
    const sent = steps.flatMap((x) => x.messages).reduce((a, m) => a + BigInt(m.amount), 0n);
    const cBal = (await bc.getContract(Address.parse(collection))).balance, mBal = (await bc.getContract(Address.parse(minter))).balance;
    // what comes back: anyone can push the collection's surplus to the payout wallet, the admin sweeps the minter
    await bc.openContract(AtharCollection.fromAddress(Address.parse(collection))).send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Withdraw" });
    await bc.openContract(AtharMinter.fromAddress(Address.parse(minter))).send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    const after = await admin.getBalance();
    const back = (await bc.getContract(Address.parse(collection))).balance;
    console.log(`LAUNCH COST: attached ${Number(sent) / 1e9} TON in ${msgCount} messages; admin net spend after sweeping ${(Number(before - after) / 1e9).toFixed(3)} TON; left in collection ${Number(back) / 1e9}, in minter ${Number((await bc.getContract(Address.parse(minter))).balance) / 1e9}; (before sweep: collection ${Number(cBal) / 1e9}, minter ${Number(mBal) / 1e9})`);

    const col = bc.openContract(AtharCollection.fromAddress(Address.parse(collection)));
    const min = bc.openContract(AtharMinter.fromAddress(Address.parse(minter)));
    expect((await col.getPayoutAddress())!.equals(payout.address)).toBe(true);
    expect(await min.getStatus()).toBe(1n);
    const info = await min.getMysteryInfo();
    expect(info.poolSize).toBe(500n); expect(info.loaded).toBe(500n);
    expect(info.commitHash).toBe(commit);
    expect((await col.getMinterActiveAt(min.address)) !== null).toBe(true);

    // before the opening time nothing sells
    const idx = SEASON_1.rangeStart + 100;
    expect(seasonTier(SEASON_1, idx)).toBeLessThan(2);
    const pool = new Set(poolDates);
    let day = SEASON_1.rangeStart; while (pool.has(day) || seasonTier(SEASON_1, day) !== 0) day++;
    let r = await alice.send({ to: min.address, value: toNano("1"), body: (await import("@ton/core")).beginCell().store((await import("../build/athar_AtharMinter")).storeBuy({ $$type: "Buy", index: BigInt(day), recipient: null })).endCell() });
    expect(await min.getIsTaken(BigInt(day))).toBe(false);
    bc.now = startAt + 5;
    await min.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(day), recipient: null });
    expect(await min.getIsTaken(BigInt(day))).toBe(true);
    await min.send(alice.getSender(), { value: toNano("3") }, { $$type: "BuyTicket", recipient: null });
    expect((await min.getMysteryInfo()).ticketsSold).toBe(1n);

    // mythic auctions the panel can start after launch
    const am = auctionMsgs(minter, SEASON_1);
    expect(am.length).toBeGreaterThan(20);
    const first = am[0];
    const rr = await admin.send({ to: Address.parse(first.address), value: BigInt(first.amount), body: Cell.fromBase64(first.payload!) });
    const au = await min.getAuctionOf(BigInt(rr.transactions.length ? 0 : 0) + BigInt(SEASON_1.rangeStart));
    expect(rr.transactions.some((t) => (t.description as any).computePhase?.success === true && t.inMessage?.info.dest?.toString() === min.address.toString())).toBe(true);
  });
});
