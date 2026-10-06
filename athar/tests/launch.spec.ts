// Rehearsal of the owner's "launch" button: runs the EXACT wallet requests the admin panel produces
// (deployments, configuration of the three direct kinds, the caps of the classes, opening) against the sandbox, then buys.
process.env.NEXT_PUBLIC_SITE_URL = "https://athar.example.com";
import { Blockchain } from "@ton/sandbox";
import { Address, beginCell, Cell, loadStateInit, toNano } from "@ton/core";
import { launchSteps, classAuctionMsg, setKindFeesMsg, setCapMsg, repriceMsg } from "../web/lib/launch";
import { SEASON_1 } from "../web/lib/seasons";
import { idOf } from "../web/lib/kinds";
import { ruleTier, TIER } from "../web/lib/dates";
import { AtharCollection } from "../build/athar_AtharCollection";
import { AtharMinter, storeBuy } from "../build/athar_AtharMinter";

describe("launch rehearsal (what the admin button does)", () => {
  it("publishes season 1 end to end and then sells", async () => {
    const bc = await Blockchain.create(); bc.now = 1_800_000_000;
    const admin = await bc.treasury("admin", { balance: toNano("100") });
    const payout = await bc.treasury("payout");
    const alice = await bc.treasury("alice");
    const startAt = bc.now + 600;
    const { steps, collection, minter } = await launchSteps(admin.address, payout.address, SEASON_1, { startAt });

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
    // what comes back: anyone can push the collection's surplus to the payout wallet, the admin sweeps the minter
    await bc.openContract(AtharCollection.fromAddress(Address.parse(collection))).send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Withdraw" });
    await bc.openContract(AtharMinter.fromAddress(Address.parse(minter))).send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Sweep" });
    const after = await admin.getBalance();
    console.log(`LAUNCH COST: attached ${Number(sent) / 1e9} TON in ${msgCount} messages; admin net spend after sweeping ${(Number(before - after) / 1e9).toFixed(3)} TON`);

    const col = bc.openContract(AtharCollection.fromAddress(Address.parse(collection)));
    const min = bc.openContract(AtharMinter.fromAddress(Address.parse(minter)));
    expect((await col.getPayoutAddress())!.equals(payout.address)).toBe(true);
    expect(await min.getStatus()).toBe(1n);
    expect((await col.getMinterActiveAt(min.address)) !== null).toBe(true);
    // every kind has its cap and fees, exactly as the season says
    for (let k = 0; k < 3; k++) {
      const d = SEASON_1.kinds[k], ki = await min.getKindInfo(BigInt(k));
      expect(ki.cap).toBe(BigInt(d.maxSupply)); expect(ki.photo).toBe(toNano(d.photoFee)); expect(ki.special).toBe(toNano(d.specialFee)); expect(ki.walletMax).toBe(BigInt(d.walletMax));
      expect(await min.getPrice(BigInt(k))).toBe(toNano(d.start));
    }
    for (let k = 3; k < 8; k++) expect((await min.getKindInfo(BigInt(k))).cap).toBe(BigInt(SEASON_1.classCaps[k - 3]));
    expect((await min.getDateView(0n)).special).toBe(false);
    const sp0 = SEASON_1.specials[0];
    expect(await min.getIsSpecial(BigInt(Date.UTC(sp0.y, sp0.m - 1, sp0.d) / 86400000 - Date.UTC(1950, 0, 1) / 86400000))).toBe(true);

    // before the opening time nothing sells
    let day = 18262; while (ruleTier(day) !== TIER.COMMON) day++;
    const buyBody = (id: bigint) => beginCell().store(storeBuy({ $$type: "Buy", index: id, recipient: null, occasion: 0n, mediaRef: 0n, style: 0n })).endCell();
    await alice.send({ to: min.address, value: toNano("1"), body: buyBody(BigInt(day)) });
    expect(await min.getIsTaken(BigInt(day))).toBe(false);
    bc.now = startAt + 5;
    await min.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(day), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    expect(await min.getIsTaken(BigInt(day))).toBe(true);
    // the same date in gold
    await min.send(alice.getSender(), { value: toNano("6") }, { $$type: "Buy", index: BigInt(idOf(2, day)), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    expect(await min.getIsTaken(BigInt(idOf(2, day)))).toBe(true);

    // a class auction the panel can start after launch, with a stored picture attached
    const cid = idOf(7, day);
    const am = classAuctionMsg(minter, cid, 42n, SEASON_1.classAuction.reserve[4], SEASON_1.classAuction.hours);
    const rr = await admin.send({ to: Address.parse(am.address), value: BigInt(am.amount), body: Cell.fromBase64(am.payload!) });
    expect(rr.transactions.some((t) => (t.description as any).computePhase?.success === true && t.inMessage?.info.dest?.toString() === min.address.toString())).toBe(true);
    const au = await min.getAuctionOf(BigInt(cid));
    expect(au!.mediaRef).toBe(42n); expect(au!.reserve).toBe(toNano(SEASON_1.classAuction.reserve[4]));
    expect(await min.getAuctionCount()).toBe(1n);

    // the settings the panel can change afterwards
    const send = async (m: { address: string; amount: string; payload?: string }) => admin.send({ to: Address.parse(m.address), value: BigInt(m.amount), body: Cell.fromBase64(m.payload!) });
    await send(setKindFeesMsg(minter, 1, "0.35", "4"));
    expect((await min.getKindInfo(1n)).photo).toBe(toNano("0.35"));
    await send(setCapMsg(minter, 2, 250));
    expect((await min.getKindInfo(2n)).cap).toBe(250n);
    await send(setCapMsg(minter, 2, 400));                                       // raising is refused
    expect((await min.getKindInfo(2n)).cap).toBe(250n);
    await send(repriceMsg(minter, 1, "1", "30"));
  });
});
