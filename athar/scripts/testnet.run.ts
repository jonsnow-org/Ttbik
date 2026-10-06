// Test-network rehearsal runner (never used on the real network). The wallets are throw-away test wallets; their words stay outside the repository.
//   TN_DIR=<folder with mnemonic.txt, payout_addr.txt> STAGE=launch npx jest --config jest.testnet.config.js    (publish + open the sale)
//   TN_DIR=... STAGE=trade  ...                                                                                (every kind, one date, a class, caps)
//   TN_DIR=... STAGE=auction ...                                                                               (a class auction and a bid)
//   TN_DIR=... STAGE=sweep ...                                                                                 (take back what the rehearsal parked in the contracts)
//   TN_DIR=... STAGE=settle ...                                                                                (after the class auction has ended)
process.env.NEXT_PUBLIC_TON_NETWORK = "testnet";
process.env.NEXT_PUBLIC_SITE_URL = process.env.TN_SITE || "https://athar-test.89-168-89-15.sslip.io";
process.env.NEXT_PUBLIC_ATHAR_DELAY_SEC = "300";
import fs from "fs";
import path from "path";
import { Address, beginCell, Cell, loadStateInit, toNano } from "@ton/core";
import { TonClient, WalletContractV4, internal, SendMode } from "@ton/ton";
import { mnemonicToPrivateKey, mnemonicNew } from "@ton/crypto";

const DIR = process.env.TN_DIR!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: any[]) => { const line = a.join(" "); console.log(line); fs.appendFileSync(path.join(DIR, "run.log"), line + "\n"); };

async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e: any) { last = e; await sleep(2500 + i * 1500); } }
  log("retry failed:", String(last?.response?.status), JSON.stringify(last?.response?.data || String(last)).slice(0, 300));
  throw last;
}
type M = { address: string; amount: string; payload?: string; stateInit?: string };

describe("testnet rehearsal", () => {
  it(process.env.STAGE || "launch", async () => {
    const { launchSteps, classAuctionMsg, setCapMsg, chunk } = await import("../web/lib/launch");
    const { SEASON_1, premiumOf } = await import("../web/lib/seasons");
    const { buyMsg, adminMintMsg, bidMsg, settleMsg } = await import("../web/lib/tx");
    const { idOf } = await import("../web/lib/kinds");
    const { indexOf, ruleTier, TIER } = await import("../web/lib/dates");
    const { AtharMinter } = await import("../build/athar_AtharMinter");
    const { AtharCollection } = await import("../build/athar_AtharCollection");
    const { AtharItem, storeTransfer } = await import("../build/athar_AtharItem");
    const { auctionOf, makeClient } = await import("../web/lib/chain");
    const { idToUint256 } = await import("../web/lib/ids");

    // The rehearsal uses the real season with every price scaled down (TN_SCALE, default 0.1): the test coins are few, the contract logic is the same
    // (the production numbers are exercised by the sandbox tests, launch.spec.ts above all).
    const K = Number(process.env.TN_SCALE || 0.1);
    const sc = (v: string) => String(Number((Number(v) * K).toFixed(6)));
    const DEF = { ...SEASON_1, kinds: SEASON_1.kinds.map((d) => ({ ...d, start: sc(d.start), floor: sc(d.floor), cap: sc(d.cap), specialFee: sc(d.specialFee), photoFee: sc(d.photoFee) })) as typeof SEASON_1.kinds,
      classAuction: { ...SEASON_1.classAuction, reserve: SEASON_1.classAuction.reserve.map(sc) as typeof SEASON_1.classAuction.reserve } };
    const client = makeClient() as TonClient;
    const kp = await mnemonicToPrivateKey(fs.readFileSync(path.join(DIR, "mnemonic.txt"), "utf8").trim().split(" "));
    const wallet = client.open(WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey }));
    const payout = Address.parse(fs.readFileSync(path.join(DIR, "payout_addr.txt"), "utf8").trim());
    const stateFile = path.join(DIR, "state.json");
    const state: any = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
    const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    const bal = async (a = wallet.address) => Number(await retry(() => client.getBalance(a))) / 1e9;
    log(new Date().toISOString(), "STAGE", process.env.STAGE, "admin", wallet.address.toString({ testOnly: true }), "balance", await bal());

    const sender = (w: any, secretKey: Buffer) => async (msgs: M[]) => {
      const seq = await retry(() => w.getSeqno());
      await retry(async () => w.sendTransfer({ seqno: await w.getSeqno(), secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: msgs.map((m) => internal({ to: Address.parse(m.address), value: BigInt(m.amount), bounce: !m.stateInit && !!m.payload,
          init: m.stateInit ? loadStateInit(Cell.fromBase64(m.stateInit).beginParse()) : undefined, body: m.payload ? Cell.fromBase64(m.payload) : undefined })) }));
      for (let i = 0; i < 40; i++) { await sleep(4000); if ((await retry(() => w.getSeqno())) > seq) break; }
      await sleep(12000);        // let the contracts finish their follow-up messages
    };
    const adminSend = sender(wallet, kp.secretKey);
    async function actor(name: string) {
      const f = path.join(DIR, `${name}_mnemonic.txt`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, (await mnemonicNew(24)).join(" "), { mode: 0o600 });
      const k = await mnemonicToPrivateKey(fs.readFileSync(f, "utf8").trim().split(" "));
      const w = client.open(WalletContractV4.create({ workchain: 0, publicKey: k.publicKey }));
      return { name, address: w.address, balance: () => bal(w.address), send: sender(w, k.secretKey) };
    }
    const ok = async (what: string, cond: boolean | (() => Promise<boolean>), extra = "") => {
      let res = false;
      for (let i = 0; i < 24; i++) { res = typeof cond === "function" ? await cond().catch(() => false) : cond; if (res || typeof cond !== "function") break; await sleep(5000); }
      log(res ? "  PASS" : "  FAIL", what, extra); expect(res).toBe(true);
    };
    const nano = (v: bigint) => Number(v) / 1e9;

    if (process.env.STAGE === "launch") {
      const startAt = Math.floor(Date.now() / 1000) + 90;
      const { steps, collection, minter } = await launchSteps(wallet.address, payout, DEF, { startAt });
      Object.assign(state, { collection, minter, startAt }); save();
      for (const s of steps) {
        log("step:", s.title);
        for (const g of chunk(s.messages, 4)) await adminSend(g);
        await sleep(15000);
      }
      const Mn = client.open(AtharMinter.fromAddress(Address.parse(minter)));
      const Co = client.open(AtharCollection.fromAddress(Address.parse(collection)));
      await ok("the sale is open", async () => (await Mn.getStatus()) === 1n);
      await ok("the minter is authorised in the collection", async () => (await Co.getMinterActiveAt(Mn.address)) !== null);
      for (let k = 0; k < 8; k++) {
        const ki = await retry(() => Mn.getKindInfo(BigInt(k)));
        const want = k < 3 ? SEASON_1.kinds[k].maxSupply : SEASON_1.classCaps[k - 3];
        await ok(`kind ${k}: cap ${want}`, Number(ki.cap) === want);
      }
      log("LAUNCH DONE; collection", collection, "minter", minter, "admin balance", await bal());
      return;
    }

    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const Mn = client.open(AtharMinter.fromAddress(Address.parse(st.minter)));
    const Co = client.open(AtharCollection.fromAddress(Address.parse(st.collection)));
    const itemOf = async (id: number) => client.open(AtharItem.fromAddress(await retry(() => Co.getGetNftAddressByIndex(BigInt(id)))));
    const payoutBal = () => bal(payout);

    if (process.env.STAGE === "trade") {
      const alice = await actor("alice"), bob = await actor("bob");
      for (const [a, want] of [[alice, 1.5], [bob, 2.2]] as const) { const have = await a.balance(); if (have < want) { log("fund", a.name, (want - have).toFixed(2)); await adminSend([{ address: a.address.toString({ testOnly: true, bounceable: false }), amount: toNano((want - have).toFixed(2)).toString() }]); } }
      log("alice", alice.address.toString({ testOnly: true }), await alice.balance(), "bob", bob.address.toString({ testOnly: true }), await bob.balance());
      const D = (() => { for (let i = indexOf(2002, 1, 1); ; i++) if (ruleTier(i) === TIER.COMMON) return i; })();
      const PHOTO_ID = "6bDdkiBuYA_lfqNqW3eIg4B4lenmwgwHzyMtpi8BADw";        // a picture stored earlier on the test network
      const price = async (k: number) => nano(await retry(() => Mn.getPriceOf(BigInt(idOf(k, D)))));

      // 1. the same date in all three direct kinds, three buyers' views
      let before = await payoutBal(); const p0 = await price(0);
      await alice.send([buyMsg(st.minter, idOf(0, D), p0)]);
      await ok("normal: taken", () => Mn.getIsTaken(BigInt(idOf(0, D))));
      await ok("normal: the payout wallet received about the price", async () => Math.abs((await payoutBal()) - before - p0) < 0.02);
      const p1 = await price(1), photoFee = nano((await retry(() => Mn.getKindInfo(1n))).photo);   // (the date is a plain one, so no premium)
      await bob.send([buyMsg(st.minter, idOf(1, D), p1, undefined, 2, idToUint256(PHOTO_ID), 1, photoFee)]);
      await ok("silver (with a photo): taken", () => Mn.getIsTaken(BigInt(idOf(1, D))));
      const p2 = await price(2);
      await alice.send([buyMsg(st.minter, idOf(2, D), p2)]);
      await ok("gold: taken", () => Mn.getIsTaken(BigInt(idOf(2, D))));
      await ok("the date reads taken in kinds 0, 1 and 2 only", async () => (await Mn.getDateView(BigInt(D))).taken === 7n);
      const owners = [alice, bob, alice];
      for (let k = 0; k < 3; k++) {
        const it = await itemOf(idOf(k, D));
        await ok(`kind ${k}: its own token, owner and kind recorded`, async () => { const d = await it.getGetNftData(); const a = await it.getAthar(); return d.ownerAddress.equals(owners[k].address) && Number(a.tier) === k; });
      }
      await ok("silver token carries the photo's id", async () => (await (await itemOf(idOf(1, D))).getAthar()).mediaRef === idToUint256(PHOTO_ID));
      await ok("the same kind of the same date cannot be bought twice", async () => {
        await bob.send([buyMsg(st.minter, idOf(0, D), p0)]);
        return (await (await itemOf(idOf(0, D))).getGetNftData()).ownerAddress.equals(alice.address);
      });

      // 2. a class cannot be bought directly; the owner mints one on the same date; a cap cannot be raised
      await bob.send([{ ...buyMsg(st.minter, idOf(4, D), 0.3), amount: toNano("0.6").toString() }]);
      await ok("a class token is not for direct sale", async () => !(await Mn.getIsTaken(BigInt(idOf(4, D)))));
      await adminSend([adminMintMsg(st.minter, idOf(4, D), bob.address.toString({ testOnly: true, bounceable: false }))]);
      await ok("the owner mints a rare class token of the same date to bob", async () => (await (await itemOf(idOf(4, D))).getGetNftData()).ownerAddress.equals(bob.address));
      await adminSend([setCapMsg(st.minter, 2, 9999)]);
      await ok("raising a cap is refused", async () => Number((await Mn.getKindInfo(2n)).cap) === SEASON_1.kinds[2].maxSupply);
      await ok("supply counts what was issued", async () => Number((await Mn.getKindInfo(2n)).issued) >= 1 && Number((await Mn.getKindInfo(4n)).issued) >= 1);

      // 3. a designed (special) date costs the kind's special fee on top; a patterned date costs its premium
      const sp = SEASON_1.specials[0]; const spIdx = indexOf(sp.y, sp.m, sp.d);
      const base0 = nano(await retry(() => Mn.getPrice(0n))); const [pn, pd] = premiumOf(spIdx);
      await ok("special date: price = curve x premium + special fee", async () => Math.abs(nano(await Mn.getPriceOf(BigInt(spIdx))) - (base0 * pn / pd + Number(DEF.kinds[0].specialFee))) < 0.001);

      // 4. a plain wallet transfer with the least a wallet attaches: the new owner is bob, the excess comes back to alice
      const it0 = await itemOf(idOf(0, D)); const aliceBefore = await alice.balance();
      const body = beginCell().store(storeTransfer({ $$type: "Transfer", queryId: 7n, newOwner: bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 1n, forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice() })).endCell().toBoc().toString("base64");
      await alice.send([{ address: it0.address.toString({ testOnly: true }), amount: toNano("0.06").toString(), payload: body }]);
      await ok("transfer: bob owns it", async () => (await it0.getGetNftData()).ownerAddress.equals(bob.address));
      await ok("transfer: only a little is lost by alice (the excess came back)", async () => aliceBefore - (await alice.balance()) < 0.03);

      log("TRADE DONE; alice", await alice.balance(), "bob", await bob.balance(), "admin", await bal());
      return;
    }

    if (process.env.STAGE === "auction") {
      const bob = await actor("bob");
      const D = (() => { for (let i = indexOf(2002, 1, 1); ; i++) if (ruleTier(i) === TIER.COMMON) return i; })();
      // an auction of a bronze class token on another date, with a bid (bronze: the cheapest opening bid)
      const E = D + 41, id = idOf(3, E), reserve = DEF.classAuction.reserve[0];
      await adminSend([classAuctionMsg(st.minter, id, 0n, reserve, 1)]);
      await ok("the class auction is listed", async () => Number(await Mn.getAuctionCount()) >= 2);
      await bob.send([bidMsg(st.minter, id, Number(reserve) + 0.1)]);
      await ok("bob's bid is the highest", async () => { const a = await auctionOf(Address.parse(st.minter), id); return !!a && a.highBidder?.equals(bob.address) === true; });
      state.auctionId = id; state.auctionEnds = Math.floor(Date.now() / 1000) + 3600 + 60; save();
      log("AUCTION DONE; settle after", new Date(state.auctionEnds * 1000).toISOString(), "bob", await bob.balance(), "admin", await bal());
      return;
    }

    if (process.env.STAGE === "sweep") {
      // give back what the rehearsal parked: the collection's surplus goes to the payout wallet (anyone may ask), the minter's dust to the admin
      const { sweepMsg } = await import("../web/lib/launch");
      await adminSend([{ address: st.collection, amount: toNano("0.05").toString(), payload: beginCell().storeUint(0x41540027, 32).endCell().toBoc().toString("base64") }, sweepMsg(st.minter)]);
      log("SWEEP DONE; admin", await bal(), "payout", await payoutBal());
      return;
    }

    if (process.env.STAGE === "settle") {
      const wait = state.auctionEnds * 1000 - Date.now();
      if (wait > 0) { log("auction not over yet, wait", Math.ceil(wait / 1000), "s"); }
      const bob = await actor("bob");
      let before = await payoutBal();
      await adminSend([settleMsg(st.minter, state.auctionId)]);
      await ok("the token went to the highest bidder", async () => (await (await itemOf(state.auctionId)).getGetNftData()).ownerAddress.equals(bob.address));
      await ok("its kind is bronze", async () => Number((await (await itemOf(state.auctionId)).getAthar()).tier) === 3);
      await ok("the payout wallet received the bid", async () => (await payoutBal()) - before > Number(DEF.classAuction.reserve[0]) * 0.9);
      log("SETTLE DONE");
    }
  });
});
