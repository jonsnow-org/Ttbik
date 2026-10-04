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
          to: Address.parse(m.address), value: BigInt(m.amount), bounce: !m.stateInit,
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

    if ((process.env.STAGE || "launch") === "launch") {
      if (!state.secret) { state.secret = newSecret().toString(16).padStart(64, "0"); }
      const startAt = state.startAt ?? Math.floor(Date.now() / 1000) + 240;
      const revealAt = state.revealAt ?? startAt + 1200;
      state.startAt = startAt; state.revealAt = revealAt; save();
      const commit = await commitOf(BigInt("0x" + state.secret));
      const { steps, collection, minter } = await launchSteps(wallet.address, payout, SEASON_1, { startAt, commit, revealAt });
      state.collection = collection; state.minter = minter; save();
      log("collection", collection); log("minter", minter);
      const M = client.open(AtharMinter.fromAddress(Address.parse(minter)));
      const done = [
        async () => (await client.isContractDeployed(Address.parse(collection))) && (await client.isContractDeployed(Address.parse(minter))),
        async () => (await M.getPrice(1n)) > 0n && (await M.getMysteryInfo()).commitHash !== 0n,
        async () => { const i = await M.getMysteryInfo(); return i.poolSize > 0n && i.loaded === i.poolSize; },
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
      const C = client.open(AtharCollection.fromAddress(Address.parse(collection)));
      log("minter status", String(await M.getStatus()), "fees", JSON.stringify(Object.fromEntries(Object.entries(await M.getFees()).map(([k, v]) => [k, String(v)]))));
      log("price common/rare", String(await M.getPrice(0n)), String(await M.getPrice(1n)));
      log("LAUNCH DONE, final balance", await bal());
    }
  }, 3_600_000);
});
