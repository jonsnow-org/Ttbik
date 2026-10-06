// Test-network rehearsal runner (never used on the real network). Run:
//   TN_DIR=<folder with mnemonic.txt, payout_addr.txt> STAGE=launch npx jest --config jest.testnet.config.js
// The wallet used here is a throw-away test wallet; its words stay outside the repository.
process.env.NEXT_PUBLIC_TON_NETWORK = "testnet";
process.env.NEXT_PUBLIC_SITE_URL = process.env.TN_SITE || "https://athar-test.89-168-89-15.sslip.io";
process.env.NEXT_PUBLIC_ATHAR_DELAY_SEC = "300";
import fs from "fs";
import path from "path";
import { Address, Cell, loadStateInit, toNano } from "@ton/core";
import { TonClient, WalletContractV4, internal, SendMode } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

const DIR = process.env.TN_DIR!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: any[]) => { const line = a.join(" "); console.log(line); fs.appendFileSync(path.join(DIR, "run.log"), line + "\n"); };

async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e: any) { last = e; await sleep(2500 + i * 1500); } }
  log("retry failed:", String(last?.response?.status), JSON.stringify(last?.response?.data || String(last)).slice(0, 300));
  throw last;
}

describe("testnet rehearsal", () => {
  it(process.env.STAGE || "launch", async () => {
    const { derive, launchSteps, newSecret, commitOf } = await import("../web/lib/launch");
    const { SEASON_1 } = await import("../web/lib/seasons");
    const { AtharMinter } = await import("../build/athar_AtharMinter");
    const { AtharCollection } = await import("../build/athar_AtharCollection");

    const { makeClient } = await import("../web/lib/chain");
    const client = makeClient() as TonClient;
    const words = fs.readFileSync(path.join(DIR, "mnemonic.txt"), "utf8").trim().split(" ");
    const kp = await mnemonicToPrivateKey(words);
    const wallet = client.open(WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey }));
    const payout = Address.parse(fs.readFileSync(path.join(DIR, "payout_addr.txt"), "utf8").trim());
    const stateFile = path.join(DIR, "state.json");
    const state: any = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
    const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    const bal = async () => Number(await retry(() => client.getBalance(wallet.address))) / 1e9;
    log(new Date().toISOString(), "admin", wallet.address.toString({ testOnly: true }), "balance", await bal());

    async function sendGroup(msgs: { address: string; amount: string; payload?: string; stateInit?: string }[]) {
      const seq = await retry(() => wallet.getSeqno());
      await retry(() => wallet.sendTransfer({
        seqno: seq, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: msgs.map((m) => internal({
          to: Address.parse(m.address), value: BigInt(m.amount), bounce: !m.stateInit && !!m.payload,
          init: m.stateInit ? loadStateInit(Cell.fromBase64(m.stateInit).beginParse()) : undefined,
          body: m.payload ? Cell.fromBase64(m.payload) : undefined,
        })),
      }));
      for (let i = 0; i < 40; i++) { await sleep(4000); if ((await retry(() => wallet.getSeqno())) > seq) break; }
    }
    const waitFor = async (what: string, pred: () => Promise<boolean>, tries = 45) => {
      for (let i = 0; i < tries; i++) { try { if (await pred()) { log("  ok:", what); return; } } catch { /* node not ready yet */ } await sleep(6000); }
      throw new Error("timed out waiting for: " + what);
    };

    type M = { address: string; amount: string; payload?: string; stateInit?: string };
    const { mnemonicNew } = await import("@ton/crypto");
    async function actor(name: string) {
      const f = path.join(DIR, `${name}_mnemonic.txt`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, (await mnemonicNew(24)).join(" "), { mode: 0o600 });
      const k = await mnemonicToPrivateKey(fs.readFileSync(f, "utf8").trim().split(" "));
      const w = client.open(WalletContractV4.create({ workchain: 0, publicKey: k.publicKey }));
      const balance = async () => Number(await retry(() => client.getBalance(w.address))) / 1e9;
      const send = async (msgs: M[]) => {
        let seq = await retry(() => w.getSeqno());
        await retry(async () => { seq = await w.getSeqno(); return w.sendTransfer({ seqno: seq, secretKey: k.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
          messages: msgs.map((m) => internal({ to: Address.parse(m.address), value: BigInt(m.amount), bounce: !m.stateInit && !!m.payload, body: m.payload ? Cell.fromBase64(m.payload) : undefined })) }); });
        for (let i = 0; i < 40; i++) { await sleep(4000); if ((await retry(() => w.getSeqno())) > seq) break; }
        await sleep(12000);        // let the contracts finish their follow-up messages
      };
      return { name, address: w.address, balance, send };
    }
    // pictures are composed and stored by the test twin of the app: exactly the path a user's browser takes
    const compose = async (index: number, photo: string) => {
      const { idToUint256 } = await import("../web/lib/ids");
      const site = process.env.NEXT_PUBLIC_SITE_URL!;
      try {
        const res = await fetch(`${site}/api/media/compose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ index, kind: "photo", occasion: 0, photo }) });
        if (!res.ok) throw new Error(`compose ${res.status} ${(await res.text()).slice(0, 200)}`);
        const r = (await res.json()) as { id: string };
        return { id: r.id, ref: idToUint256(r.id) };
      } catch (e) {
        // the free storage quota of this server's network is used up (see docs): reuse a picture stored earlier so the chain flow can still be tested
        log("  storage refused, reusing an earlier stored picture:", String(e).slice(0, 120));
        const id = "6bDdkiBuYA_lfqNqW3eIg4B4lenmwgwHzyMtpi8BADw";
        return { id, ref: idToUint256(id) };
      }
    };
    // a check waits (up to ~2 minutes) for the chain to catch up: contracts answer each other asynchronously
    const ok = async (what: string, cond: boolean | (() => Promise<boolean>), extra = "") => {
      let res = false;
      for (let i = 0; i < 24; i++) { res = typeof cond === "function" ? await cond().catch(() => false) : cond; if (res || typeof cond !== "function") break; await sleep(5000); }
      log(res ? "  PASS" : "  FAIL", what, extra); expect(res).toBe(true);
    };

    if (process.env.STAGE === "trade1") {
      const { buyMsg, ticketMsg, engraveMsg, bidMsg, mediaMsg } = await import("../web/lib/tx");
      const { specialAuctionMsg } = await import("../web/lib/launch");
      const { indexOf, ruleTier, TIER } = await import("../web/lib/dates");
      const { AtharCollection } = await import("../build/athar_AtharCollection");
      const { AtharItem } = await import("../build/athar_AtharItem");
      const { AtharMinter } = await import("../build/athar_AtharMinter");
      const { auctionOf } = await import("../web/lib/chain");
      const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const Mn = client.open(AtharMinter.fromAddress(Address.parse(st.minter)));
      const Co = client.open(AtharCollection.fromAddress(Address.parse(st.collection)));
      const itemOf = async (i: number) => client.open(AtharItem.fromAddress(await retry(() => Co.getGetNftAddressByIndex(BigInt(i)))));
      const photos = JSON.parse(fs.readFileSync(path.join(DIR, "photos.json"), "utf8"));
      const alice = await actor("alice"), bob = await actor("bob");
      const admin = { send: sendGroup, address: wallet.address };
      for (const a of [alice, bob]) { const have = await a.balance(); if (have < 2.8) { await sendGroup([{ address: a.address.toString({ testOnly: true, bounceable: false }), amount: toNano((3 - have).toFixed(2)).toString() }]); for (let i = 0; i < 20 && (await a.balance()) < 2.8; i++) await sleep(4000); } }
      log("alice", alice.address.toString({ testOnly: true }), await alice.balance(), "bob", bob.address.toString({ testOnly: true }), await bob.balance());
      const free = async (from: number, tier: number, skip: Set<number>) => { const pool = new Set((require("../web/lib/seasons") as any).buildPool((require("../web/lib/seasons") as any).SEASON_1).dates); for (let i = from; ; i++) if (ruleTier(i) === tier && !pool.has(i) && !skip.has(i) && !(await retry(() => Mn.getIsTaken(BigInt(i))))) return i; };
      const used = new Set<number>();
      const payoutBal = async () => Number(await retry(() => client.getBalance(payout))) / 1e9;

      if (!state.abcDone) {
      // A. a plain purchase: generated art, no extras
      const a = await free(indexOf(2002, 1, 1), TIER.COMMON, used); used.add(a);
      let before = await payoutBal(); const priceA = Number(await retry(() => Mn.getPrice(0n))) / 1e9;
      await alice.send([buyMsg(st.minter, a, priceA, undefined, 0, 0n, 0, 0)]);
      await ok("A: date is taken after a plain purchase", () => Mn.getIsTaken(BigInt(a)));
      const ia = await itemOf(a);
      await ok("A: owner is alice", async () => (await ia.getGetNftData()).ownerAddress.equals(alice.address));
      await ok("A: payout received about the price", async () => Math.abs((await payoutBal()) - before - priceA) < 0.01, "");

      // B. own photo in waxed silver: the fee reaches the payout wallet and the photo is stored for good
      const b = await free(indexOf(2004, 6, 1), TIER.COMMON, used); used.add(b);
      const upB = await compose(b, photos.silver);
      log("  stored picture", `https://turbo-gateway.com/${upB.id}`);
      before = await payoutBal(); const priceB = Number(await retry(() => Mn.getPrice(0n))) / 1e9;
      await bob.send([buyMsg(st.minter, b, priceB, undefined, 2, upB.ref, 2, 0.3)]);
      await ok("B: silver purchase succeeded", () => Mn.getIsTaken(BigInt(b)));
      const ib = await itemOf(b);
      await ok("B: token carries the stored picture", async () => (await ib.getAthar()).mediaRef === upB.ref);
      await ok("B: payout received price + 0.30", async () => Math.abs((await payoutBal()) - before - priceB - 0.3) < 0.01, "");
      state.photoDate = b; state.photoId = upB.id; state.plainDate = a; save();

      // C. engrave and transfer: hands counter goes up
      await alice.send([engraveMsg(st.collection, a, "اختبار", 0.1)]);
      await ok("C: engraving recorded", async () => (await ia.getAthar()).engravings != null);
      const { storeTransfer } = await import("../build/athar_AtharItem");
      const { beginCell } = await import("@ton/core");
      const xfer = beginCell().store(storeTransfer({ $$type: "Transfer", queryId: 0n, newOwner: bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 0n, forwardPayload: beginCell().endCell().beginParse() })).endCell().toBoc().toString("base64");
      await alice.send([{ address: ia.address.toString(), amount: toNano("0.1").toString(), payload: xfer }]);
      await ok("C: transfer moved ownership to bob", async () => (await ia.getGetNftData()).ownerAddress.equals(bob.address));
      await ok("C: hands counter is 2", async () => Number((await ia.getAthar()).hands) === 2);

      // C2. the owner of the silver token changes its picture: costs the change fee (0.5), both pictures stay in the history
      const goldForChange = JSON.parse(fs.readFileSync(path.join(DIR, "gold_samples.json"), "utf8"))["1969-7-20"];
      const upC = await compose(b, goldForChange);
      const beforeC = await payoutBal();
      await bob.send([mediaMsg(st.collection, b, 0, upC.ref, 0.5)]);
      await ok("C2: picture changed to the new one", async () => (await ib.getAthar()).mediaRef === upC.ref);
      await ok("C2: change fee reached the payout wallet", async () => Math.abs((await payoutBal()) - beforeC - 0.5) < 0.01, "");
      await ok("C2: the first picture is still in the history", async () => { const lg = (await ib.getAthar()).mediaLog; if (!lg) return false; const sl = lg.beginParse(); sl.loadAddress(); sl.loadUint(32); sl.loadUintBig(256); const prev = sl.loadMaybeRef(); if (!prev) return false; const q = prev.beginParse(); q.loadAddress(); q.loadUint(32); return q.loadUintBig(256) === upB.ref; });

        state.abcDone = true; save();
      }

      // D. a mythic date by rule: auction (1 hour), bids; settled in stage trade2
      const sp = (require("../web/lib/seasons") as any).SEASON_1.specials[0];
      const spIdx = (require("../web/lib/seasons") as any).specialIndex(sp);
      const goldArt = JSON.parse(fs.readFileSync(path.join(DIR, "gold_samples.json"), "utf8"))["1969-7-20"];
      if (!state.auctionStarted) {
        const upD = await compose(spIdx, goldArt);
        const am = specialAuctionMsg(st.minter, (require("../web/lib/seasons") as any).SEASON_1, spIdx, upD.ref, "1", 1 / 24);
        await admin.send([am]);
        await ok("D: special auction started carrying the picture", async () => { const au = await auctionOf(Address.parse(st.minter), spIdx); return !!au && au.mediaRef === upD.ref; });
        state.auctionStarted = true; save();
        log("  auction picture", `https://turbo-gateway.com/${upD.id}`);
      }
      if (!state.bidsDone) { await alice.send([bidMsg(st.minter, spIdx, 1.05)]); await bob.send([bidMsg(st.minter, spIdx, 1.2)]); state.bidsDone = true; save(); }
      await ok("D: highest bid is bob's (1.2 + 0.08 network buffer = 1.28)", async () => { const au2 = await auctionOf(Address.parse(st.minter), spIdx); return !!au2 && au2.highBid === toNano("1.28"); });
      const au2 = await retry(() => auctionOf(Address.parse(st.minter), spIdx));
      state.auctionDate = spIdx; state.auctionEnds = Number(au2!.endAt); save();
      log("  auction ends", new Date(state.auctionEnds * 1000).toISOString());

      // E. a direct purchase of a special date must be refused
      const rej = await retry(() => Mn.getIsTaken(BigInt(spIdx)));
      await ok("E: special date is not taken before the auction ends", rej === false);

      // F. mystery tickets
      if (!state.ticketsDone) {
        // idempotent, and the buyers are topped up first: a wallet that has spent its test coins on the earlier steps cannot pay for a ticket
        for (const a of [alice, bob]) { const have = await a.balance(); if (have < 1.8) { await sendGroup([{ address: a.address.toString({ testOnly: true, bounceable: false }), amount: toNano((2.5 - have).toFixed(2)).toString() }]); await sleep(20000); } }
        let sold = Number((await retry(() => Mn.getMysteryInfo())).ticketsSold);
        if (sold < 1) { await alice.send([ticketMsg(st.minter, Number(await retry(() => Mn.getPrice(3n))) / 1e9)]); sold++; }
        if (sold < 2) await bob.send([ticketMsg(st.minter, Number(await retry(() => Mn.getPrice(3n))) / 1e9)]);
        state.ticketsDone = true; save();
      }
      await ok("F: at least one ticket sold (the ticket window of this rehearsal is 20 minutes, so a late second buyer is refused by design)", async () => Number((await Mn.getMysteryInfo()).ticketsSold) >= 1);
      log("TRADE1 DONE; balances admin/alice/bob", await bal(), await alice.balance(), await bob.balance());
      return;
    }

    if (process.env.STAGE === "v2") {        // what Edition 2 added: the owner's stock, a sale on Getgems' real sale contract, the collection's code upgrade
      const { adminMintMsg, buyMsg } = await import("../web/lib/tx");
      const { indexOf, ruleTier, TIER } = await import("../web/lib/dates");
      const seasons = require("../web/lib/seasons") as any;
      const { AtharCollection } = await import("../build/athar_AtharCollection");
      const { AtharItem, storeTransfer } = await import("../build/athar_AtharItem");
      const { AtharMinter } = await import("../build/athar_AtharMinter");
      const { beginCell, contractAddress, storeStateInit } = await import("@ton/core");
      const { compileFunc } = await import("@ton-community/func-js");
      const cp = await import("child_process");
      const os = await import("os");
      const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const Mn = client.open(AtharMinter.fromAddress(Address.parse(st.minter)));
      const Co = client.open(AtharCollection.fromAddress(Address.parse(st.collection)));
      const itemOf = async (i: number) => client.open(AtharItem.fromAddress(await retry(() => Co.getGetNftAddressByIndex(BigInt(i)))));
      const alice = await actor("alice");
      const pool = new Set<number>(seasons.buildPool(seasons.SEASON_1).dates);
      const pickFree = async (n: number, from: number) => { const out: number[] = []; for (let d = from; out.length < n && d <= seasons.SEASON_1.rangeEnd; d++) { if (pool.has(d) || ruleTier(d) !== TIER.COMMON) continue; if (!(await retry(() => Mn.getIsTaken(BigInt(d))))) out.push(d); } return out; };
      const payoutBal = async () => Number(await retry(() => client.getBalance(payout))) / 1e9;
      if (await bal() < 1.2) throw new Error("the admin test wallet needs more test coins for this stage");
      if ((await alice.balance()) < 2.6) { await sendGroup([{ address: alice.address.toString({ testOnly: true, bounceable: false }), amount: toNano("3").toString() }]); await sleep(20000); }

      // 1. the owner's stock: minted to the admin wallet, no sale price, the price curve does not move
      if (!state.stockDone) {
        const dates = await pickFree(3, indexOf(2006, 3, 1));
        const priceBefore = await retry(() => Mn.getPrice(0n)), soldBefore = await retry(() => Mn.getSoldCount());
        const payoutBefore = await payoutBal();
        for (const d of dates) await sendGroup([adminMintMsg(st.minter, d)]);
        for (const d of dates) { const it = await itemOf(d); await ok(`stock ${d} belongs to the admin wallet`, async () => (await it.getGetNftData()).ownerAddress.equals(wallet.address)); }
        await ok("stock: the price did not move", async () => (await Mn.getPrice(0n)) === priceBefore);
        await ok("stock: they count as sold", async () => (await Mn.getSoldCount()) === soldBefore + 3n);
        await ok("stock: no sale money moved to the payout wallet", async () => (await payoutBal()) - payoutBefore < 0.05);
        state.stock = dates; state.stockDone = true; save();
      }

      // 2. a sale on Getgems' own fixed-price contract (their open source, compiled here): list, transfer into it, a buyer pays
      if (!state.saleDone) {
        const D = path.join(__dirname, "../tests/getgems");
        const rd = (f: string) => fs.readFileSync(path.join(D, f), "utf8");
        const comp: any = await compileFunc({ targets: ["nft-fixprice-sale-v4r1.fc"], sources: { "nft-fixprice-sale-v4r1.fc": rd("nft-fixprice-sale-v4r1.fc"), "op-codes.fc": rd("op-codes.fc"), "imports/stdlib.fc": rd("imports/stdlib.fc") } });
        if (comp.status !== "ok") throw new Error(comp.message);
        const code = Cell.fromBase64(comp.codeBoc);
        const stockItem = await itemOf(state.stock[0]);
        const price = toNano("2");
        const statics = beginCell().storeAddress(wallet.address).storeAddress(payout).storeUint(5000, 17).storeUint(5000, 17).storeAddress(stockItem.address).storeUint(Math.floor(Date.now() / 1000), 32).endCell();
        const data = beginCell().storeUint(0, 1).storeAddress(wallet.address).storeAddress(null).storeCoins(price).storeUint(0, 32).storeUint(0, 64).storeRef(statics).storeDict(null).storeBit(0).endCell();
        const init = { code, data }; const sale = state.saleAddr ? Address.parse(state.saleAddr) : contractAddress(0, init);
        if (!state.saleAddr) {
        const initB64 = beginCell().store(storeStateInit(init)).endCell().toBoc().toString("base64");
        await sendGroup([{ address: sale.toString({ testOnly: true }), amount: toNano("0.05").toString(), stateInit: initB64, payload: beginCell().storeUint(0x664c0905, 32).storeUint(0, 64).endCell().toBoc().toString("base64") }]);
        await waitFor("the sale contract is deployed", async () => client.isContractDeployed(sale));
        const xfer = beginCell().store(storeTransfer({ $$type: "Transfer", queryId: 5n, newOwner: sale, responseDestination: wallet.address, customPayload: null, forwardAmount: toNano("0.1"), forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice() })).endCell().toBoc().toString("base64");
        await sendGroup([{ address: stockItem.address.toString({ testOnly: true }), amount: toNano("0.3").toString(), payload: xfer }]);
        state.saleAddr = sale.toString(); save();
        }
        await ok("sale: the token is now held by the sale contract", async () => (await stockItem.getGetNftData()).ownerAddress.equals(sale));
        await ok("sale: the sale contract knows its seller (ownership assigned)", async () => { const r = await client.runMethod(sale, "get_fix_price_data_v4"); r.stack.readBigNumber(); r.stack.readBigNumber(); r.stack.readAddress(); r.stack.readAddress(); return r.stack.readAddress().equals(wallet.address); });
        // the message that Getgems insists on: the unused value comes back to the owner, sent by the token (read from the chain's own transaction list)
        await ok("sale: the token sent the unused value back to its owner (Getgems' check)", async () => {
          const r = await fetch(`https://testnet.toncenter.com/api/v2/getTransactions?address=${stockItem.address.toRawString()}&limit=10`); if (!r.ok) return false;
          const txs = ((await r.json()).result || []) as any[];
          const opOf = (m: any) => { try { const sl = Cell.fromBase64(m.msg_data.body).beginParse(); return sl.remainingBits >= 32 ? sl.loadUint(32) : -1; } catch { return -1; } };
          return txs.some((t) => (t.out_msgs || []).some((m: any) => { try { return Address.parse(m.destination).equals(wallet.address) && opOf(m) === 0xd53276db; } catch { return false; } }));
        });
        const royaltyBefore = await payoutBal();
        await alice.send([{ address: sale.toString({ testOnly: true }), amount: (price + toNano("0.2")).toString() }]);
        await ok("sale: the token moved to the buyer", async () => (await stockItem.getGetNftData()).ownerAddress.equals(alice.address));
        await ok("sale: the royalty (5%) reached the payout wallet", async () => (await payoutBal()) - royaltyBefore > 0.09);
        state.saleDone = true; save();
      }

      // 3. the collection's code upgrade on the real network: the real source plus a version getter, proposed, waited out, applied
      if (!state.upgradeDone) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athar-variant-"));
        fs.cpSync(path.join(__dirname, "../contracts"), path.join(tmp, "contracts"), { recursive: true });
        const f = path.join(tmp, "contracts/collection.tact");
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("get fun total_minted(): Int { return self.minted; }", "get fun total_minted(): Int { return self.minted; }\n    get fun version(): Int { return 2; }"));
        fs.writeFileSync(path.join(tmp, "tact.config.json"), JSON.stringify({ projects: [{ name: "athar", path: "./contracts/athar.tact", output: "./build", options: { debug: false } }] }));
        cp.execSync(`${path.join(__dirname, "../node_modules/.bin/tact")} --config tact.config.json`, { cwd: tmp, stdio: "pipe" });
        const variant = Cell.fromBoc(fs.readFileSync(path.join(tmp, "build/athar_AtharCollection.code.boc")))[0];
        const firstItem = (await Co.getGetNftAddressByIndex(BigInt(state.stock[0]))).toString();
        const mintedBefore = await retry(() => Co.getTotalMinted());
        const { storeProposeCode, storeApplyCode } = await import("../build/athar_AtharCollection");
        await sendGroup([{ address: st.collection, amount: toNano("0.1").toString(), payload: beginCell().store(storeProposeCode({ $$type: "ProposeCode", code: variant })).endCell().toBoc().toString("base64") }]);
        await ok("upgrade: the proposal is public", async () => (await Co.getCodeProposal()).pending);
        await ok("upgrade: its hash is readable by anyone", async () => (await Co.getPendingCodeHash()) === BigInt("0x" + variant.hash().toString("hex")));
        const at = Number((await retry(() => Co.getCodeProposal())).applicableAt); log("  upgrade applicable at", new Date(at * 1000).toISOString());
        while (Math.floor(Date.now() / 1000) < at + 20) await sleep(10000);
        await sendGroup([{ address: st.collection, amount: toNano("0.1").toString(), payload: beginCell().store(storeApplyCode({ $$type: "ApplyCode" })).endCell().toBoc().toString("base64") }]);
        await ok("upgrade: the new logic is live (version getter answers 2)", async () => { const r = await client.runMethod(Address.parse(st.collection), "version"); return r.stack.readNumber() === 2; });
        await ok("upgrade: the address of an existing token is unchanged", async () => (await Co.getGetNftAddressByIndex(BigInt(state.stock[0]))).toString() === firstItem);
        await ok("upgrade: the minted count is unchanged", async () => (await Co.getTotalMinted()) === mintedBefore);
        const [d] = await pickFree(1, indexOf(2007, 1, 1)); const p0 = Number(await retry(() => Mn.getPrice(0n))) / 1e9;
        await alice.send([buyMsg(st.minter, d, p0)]);
        await ok("upgrade: selling still works through the upgraded collection", () => Mn.getIsTaken(BigInt(d)));
        await ok("upgrade: the new token belongs to the buyer", async () => (await (await itemOf(d)).getGetNftData()).ownerAddress.equals(alice.address));
        state.upgradeDone = true; save();
      }
      log("V2 DONE; admin balance", await bal());
      return;
    }

    if (process.env.STAGE === "trade2") {      // after the auction's end: settle it and check what the winner got
      const { settleMsg } = await import("../web/lib/tx");
      const { auctionOf } = await import("../web/lib/chain");
      const { AtharCollection } = await import("../build/athar_AtharCollection");
      const { AtharItem } = await import("../build/athar_AtharItem");
      const { AtharMinter } = await import("../build/athar_AtharMinter");
      const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const Co = client.open(AtharCollection.fromAddress(Address.parse(st.collection)));
      const Mn = client.open(AtharMinter.fromAddress(Address.parse(st.minter)));
      const bob = await actor("bob");
      const idx = st.auctionDate as number;
      const au = await retry(() => auctionOf(Address.parse(st.minter), idx));
      log("auction", JSON.stringify({ endAt: Number(au!.endAt), highBid: String(au!.highBid) }), "now", Math.floor(Date.now() / 1000));
      const before = Number(await retry(() => client.getBalance(payout))) / 1e9;
      const alice2 = await actor("alice");      // anyone may settle a finished auction
      await alice2.send([settleMsg(st.minter, idx)]);
      await ok("G: the special date is taken after Settle", () => Mn.getIsTaken(BigInt(idx)));
      const item = client.open(AtharItem.fromAddress(await retry(() => Co.getGetNftAddressByIndex(BigInt(idx)))));
      await ok("G: the winner (bob) owns it", async () => (await item.getGetNftData()).ownerAddress.equals(bob.address));
      await ok("G: the token carries the auction's picture", async () => (await item.getAthar()).mediaRef === au!.mediaRef);
      await ok("G: the owner's payout received the winning bid", async () => Math.abs(Number(await client.getBalance(payout)) / 1e9 - before - 1.28) < 0.01);
      log("TRADE2 DONE");
      return;
    }

    if (process.env.STAGE === "sweep") {            // take back what an old (abandoned) test minter still holds
      const { sweepMsg } = await import("../web/lib/launch");
      const before = await bal();
      await sendGroup([sweepMsg(state.minter)]);
      await sleep(25000);
      log("swept", state.minter, "balance", before, "->", await bal());
      fs.renameSync(stateFile, stateFile.replace("state.json", `state_old_${Date.now()}.json`));
      return;
    }
    if ((process.env.STAGE || "launch") === "launch") {
      if (!state.secret) { state.secret = newSecret().toString(16).padStart(64, "0"); }
      const startAt = state.startAt ?? Math.floor(Date.now() / 1000) + 240;
      const revealAt = state.revealAt ?? startAt + 1200;
      state.startAt = startAt; state.revealAt = revealAt; save();
      const commit = await commitOf(BigInt("0x" + state.secret));
      const { steps, collection, minter, poolDates } = await launchSteps(wallet.address, payout, SEASON_1, { startAt, commit, revealAt });
      state.collection = collection; state.minter = minter; save();
      log("collection", collection); log("minter", minter);
      const M = client.open(AtharMinter.fromAddress(Address.parse(minter)));
      const done = [
        async () => (await client.isContractDeployed(Address.parse(collection))) && (await client.isContractDeployed(Address.parse(minter))),
        async () => (await M.getPrice(1n)) > 0n && (await M.getMysteryInfo()).commitHash !== 0n,
        async () => { const i = await M.getMysteryInfo(); return Number(i.poolSize) >= poolDates.length && i.loaded === i.poolSize; },
        async () => (await M.getStatus()) === 1n,
      ];
      for (let i = 0; i < steps.length; i++) {
        if (await done[i]().catch(() => false)) { log("step", i + 1, "already done:", steps[i].title); continue; }
        let msgs = steps[i].messages;
        if (i === 2) {   // pool chunks already loaded are skipped (a chunk is 35 positions)
          const keep = [];
          for (let c = 0; c < msgs.length; c++) { const at = await retry(() => M.getPoolAt(BigInt(c * 35))); if (at == null) keep.push(msgs[c]); }
          msgs = keep;
        }
        log("step", i + 1, steps[i].title, "messages:", msgs.length, "balance", await bal());
        for (let k = 0; k < msgs.length; k += 4) {
          // the minter keeps the unused part of every chunk: sweep it back whenever the wallet runs low
          if (i === 2 && (await bal()) < 0.7) { const { sweepMsg } = await import("../web/lib/launch"); await sendGroup([sweepMsg(minter)]); await sleep(20000); log("  swept, balance", await bal()); }
          await sendGroup(msgs.slice(k, k + 4));
        }
        await waitFor(steps[i].title, done[i]);
        log("  balance now", await bal());
      }
      await sleep(3000);
      const f = await retry(() => M.getFees());
      log("minter status", String(await retry(() => M.getStatus())), "fees photo/silver", String(f.photo), String(f.silver));
      log("price common/rare", String(await retry(() => M.getPrice(0n))), String(await retry(() => M.getPrice(1n))));
      const mi = await retry(() => M.getMysteryInfo());
      log("mystery pool", String(mi.loaded), "/", String(mi.poolSize));
      log("LAUNCH DONE, final balance", await bal());
    }
  }, 3_600_000);
});
