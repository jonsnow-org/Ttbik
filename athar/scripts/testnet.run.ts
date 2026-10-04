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

    const client = new TonClient({ endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC", apiKey: process.env.TONCENTER_API_KEY });
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
        const seq = await retry(() => w.getSeqno());
        await retry(() => w.sendTransfer({ seqno: seq, secretKey: k.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
          messages: msgs.map((m) => internal({ to: Address.parse(m.address), value: BigInt(m.amount), bounce: !m.stateInit && !!m.payload, body: m.payload ? Cell.fromBase64(m.payload) : undefined })) }));
        for (let i = 0; i < 40; i++) { await sleep(4000); if ((await retry(() => w.getSeqno())) > seq) break; }
        await sleep(12000);        // let the contracts finish their follow-up messages
      };
      return { name, address: w.address, balance, send };
    }
    const upload = async (svg: string, tags: Record<string, string>) => {
      const { uploadPermanent, idToUint256 } = await import("../web/lib/arweave");
      const up = await uploadPermanent(Buffer.from(svg, "utf8"), "image/svg+xml", tags);
      return { id: up.id, ref: idToUint256(up.id) };
    };
    // a check waits (up to ~2 minutes) for the chain to catch up: contracts answer each other asynchronously
    const ok = async (what: string, cond: boolean | (() => Promise<boolean>), extra = "") => {
      let res = false;
      for (let i = 0; i < 24; i++) { res = typeof cond === "function" ? await cond().catch(() => false) : cond; if (res || typeof cond !== "function") break; await sleep(5000); }
      log(res ? "  PASS" : "  FAIL", what, extra); expect(res).toBe(true);
    };

    if (process.env.STAGE === "trade1") {
      const { buyMsg, ticketMsg, engraveMsg, bidMsg } = await import("../web/lib/tx");
      const { specialAuctionMsg } = await import("../web/lib/launch");
      const { renderPhotoArt } = await import("../web/lib/art");
      const { indexOf, ruleTier, TIER } = await import("../web/lib/dates");
      const { AtharCollection } = await import("../build/athar_AtharCollection");
      const { AtharItem } = await import("../build/athar_AtharItem");
      const { AtharMinter } = await import("../build/athar_AtharMinter");
      const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const Mn = client.open(AtharMinter.fromAddress(Address.parse(st.minter)));
      const Co = client.open(AtharCollection.fromAddress(Address.parse(st.collection)));
      const itemOf = async (i: number) => client.open(AtharItem.fromAddress(await retry(() => Co.getGetNftAddressByIndex(BigInt(i)))));
      const photos = JSON.parse(fs.readFileSync(path.join(DIR, "photos.json"), "utf8"));
      const alice = await actor("alice"), bob = await actor("bob");
      const admin = { send: sendGroup, address: wallet.address };
      for (const a of [alice, bob]) if ((await a.balance()) < 1.5) { await sendGroup([{ address: a.address.toString({ testOnly: true, bounceable: false }), amount: toNano("1.6").toString() }]); for (let i = 0; i < 20 && (await a.balance()) < 1.5; i++) await sleep(4000); }
      log("alice", alice.address.toString({ testOnly: true }), await alice.balance(), "bob", bob.address.toString({ testOnly: true }), await bob.balance());
      const free = async (from: number, tier: number, skip: Set<number>) => { const pool = new Set((require("../web/lib/seasons") as any).buildPool((require("../web/lib/seasons") as any).SEASON_1).dates); for (let i = from; ; i++) if (ruleTier(i) === tier && !pool.has(i) && !skip.has(i) && !(await retry(() => Mn.getIsTaken(BigInt(i))))) return i; };
      const used = new Set<number>();
      const payoutBal = async () => Number(await retry(() => client.getBalance(payout))) / 1e9;

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
      const svgB = renderPhotoArt({ index: b, tier: 0, season: 1, stage: 0, hands: 1, engravings: 0 }, photos.silver, { w: photos.W, h: photos.H });
      const upB = await upload(svgB, { "Athar-Date": String(b), "Athar-Kind": "photo-test" });
      log("  stored picture", `https://turbo-gateway.com/${upB.id}`);
      before = await payoutBal(); const priceB = Number(await retry(() => Mn.getPrice(0n))) / 1e9;
      await bob.send([buyMsg(st.minter, b, priceB, undefined, 2, upB.ref, 2, 0.3)]);
      await ok("B: silver purchase succeeded", () => Mn.getIsTaken(BigInt(b)));
      const ib = await itemOf(b);
      await ok("B: token carries the stored picture", async () => (await ib.getAthar()).mediaRef === upB.ref);
      await ok("B: payout received price + 0.30", async () => Math.abs((await payoutBal()) - before - priceB - 0.3) < 0.01, "");
      state.photoDate = b; state.photoId = upB.id; state.plainDate = a; save();

      // C. engrave and transfer: hands counter goes up
      await alice.send([engraveMsg((await itemOf(a)).address.toString(), "اختبار الشبكة التجريبية")]);
      await ok("C: engraving recorded", async () => (await ia.getAthar()).engravings != null);
      const { storeTransfer } = await import("../build/athar_AtharItem");
      const { beginCell } = await import("@ton/core");
      const xfer = beginCell().store(storeTransfer({ $$type: "Transfer", queryId: 0n, newOwner: bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 0n, forwardPayload: beginCell().endCell().beginParse() })).endCell().toBoc().toString("base64");
      await alice.send([{ address: ia.address.toString(), amount: toNano("0.1").toString(), payload: xfer }]);
      await ok("C: transfer moved ownership to bob", async () => (await ia.getGetNftData()).ownerAddress.equals(bob.address));
      await ok("C: hands counter is 2", async () => Number((await ia.getAthar()).hands) === 2);

      // D. a mythic date by rule: auction (1 hour), bids; settled in stage trade2
      const sp = (require("../web/lib/seasons") as any).SEASON_1.specials[0];
      const spIdx = (require("../web/lib/seasons") as any).specialIndex(sp);
      const goldArt = JSON.parse(fs.readFileSync(path.join(DIR, "gold_samples.json"), "utf8"))["1969-7-20"];
      const svgD = renderPhotoArt({ index: spIdx, tier: sp.tier, season: 1, stage: 0, hands: 1, engravings: 0 }, goldArt, { w: 640, h: 640 });
      const upD = await upload(svgD, { "Athar-Date": String(spIdx), "Athar-Kind": "special-gold-test" });
      const am = specialAuctionMsg(st.minter, (require("../web/lib/seasons") as any).SEASON_1, spIdx, upD.ref, "2", 1 / 24);
      await admin.send([am]);
      await ok("D: special auction started carrying the picture", async () => { const au = await Mn.getAuctionOf(BigInt(spIdx)); return !!au && au.mediaRef === upD.ref; });
      await alice.send([bidMsg(st.minter, spIdx, 2.1)]);
      await bob.send([bidMsg(st.minter, spIdx, 2.5)]);
      await ok("D: highest bid is bob's 2.5", async () => { const au2 = await Mn.getAuctionOf(BigInt(spIdx)); return !!au2 && au2.highBid === toNano("2.5"); });
      const au2 = await retry(() => Mn.getAuctionOf(BigInt(spIdx)));
      state.auctionDate = spIdx; state.auctionEnds = Number(au2!.endAt); save();
      log("  auction picture", `https://turbo-gateway.com/${upD.id}`, "ends", new Date(state.auctionEnds * 1000).toISOString());

      // E. a direct purchase of a special date must be refused
      const rej = await retry(() => Mn.getIsTaken(BigInt(spIdx)));
      await ok("E: special date is not taken before the auction ends", rej === false);

      // F. mystery tickets
      await alice.send([ticketMsg(st.minter, Number(await retry(() => Mn.getPrice(3n))) / 1e9)]);
      await bob.send([ticketMsg(st.minter, Number(await retry(() => Mn.getPrice(3n))) / 1e9)]);
      await ok("F: two tickets sold", async () => Number((await Mn.getMysteryInfo()).ticketsSold) === 2);
      log("TRADE1 DONE; balances admin/alice/bob", await bal(), await alice.balance(), await bob.balance());
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
