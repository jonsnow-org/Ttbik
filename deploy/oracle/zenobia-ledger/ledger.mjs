// Zenobia ledger wallet: publishes each closed season's result fingerprint on TON.
//
// The only thing this program can do with money: send ONE fixed tiny amount (0.001 TON) from its own wallet TO ITS OWN
// ADDRESS, carrying the text  ZNB1:<season>:<sha256>  as the comment. Nothing else is sent, to nobody else.
// The key is generated here on first run and stays in /state (mode 600, a folder that belongs to this container only).
// It is never printed, logged or sent anywhere; only the public address is written to /state/address and status.json.
import fs from "node:fs";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4, internal, SendMode, beginCell, toNano, fromNano } from "@ton/ton";

const NETWORK = process.env.ZNB_NETWORK === "testnet" ? "testnet" : "mainnet";
const DIR = process.env.ZNB_DIR || "/state";
const SITE = (process.env.ZNB_SITE || "https://ttbik.vercel.app").replace(/\/$/, "");
const EVERY_MS = Number(process.env.ZNB_EVERY_MS || 10 * 60_000);
const POST_AMOUNT = toNano("0.001"); // fixed: the program has no other amount
const MIN_BALANCE = toNano("0.02"); // do not even try below this
const endpoint = NETWORK === "testnet" ? "https://testnet.toncenter.com/api/v2/jsonRPC" : "https://toncenter.com/api/v2/jsonRPC";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const keyFile = `${DIR}/ledger.key`;
let words;
if (fs.existsSync(keyFile)) words = fs.readFileSync(keyFile, "utf8").trim().split(" ");
else {
  words = await mnemonicNew(24);
  fs.writeFileSync(keyFile, words.join(" "), { mode: 0o600 });
  log("new ledger key created (not shown)");
}
const kp = await mnemonicToPrivateKey(words);
words = null;
const client = new TonClient({ endpoint, apiKey: process.env.TONCENTER_API_KEY || undefined });
const wallet = client.open(WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey }));
const address = wallet.address.toString({ testOnly: NETWORK === "testnet", bounceable: false });
fs.writeFileSync(`${DIR}/address`, address + "\n");
log("ledger address:", address, NETWORK);

const postedFile = `${DIR}/posted.json`;
const posted = () => { try { return JSON.parse(fs.readFileSync(postedFile, "utf8")); } catch { return {}; } };
const status = (extra = {}) => fs.writeFileSync(`${DIR}/status.json`, JSON.stringify({ address, network: NETWORK, updated: new Date().toISOString(), posted: posted(), ...extra }));

async function retry(fn) {
  for (let i = 0; i < 6; i++) {
    try { return await fn(); } catch (e) { if (!/429/.test(String(e?.message))) throw e; await sleep(2500 * (i + 1)); }
  }
  throw new Error("rate limited");
}

async function tick() {
  const res = await fetch(`${SITE}/api/zenobia/ledger/latest`, { headers: { accept: "application/json" } });
  if (!res.ok) { status({ note: `site answered ${res.status}` }); return; }
  const j = await res.json();
  if (!j.season || !/^\d{4}-W\d{2}$/.test(j.season) || !/^[0-9a-f]{64}$/.test(j.hash || "")) { status({ note: "no closed season yet" }); return; }
  if (posted()[j.season]) { status({ note: "up to date" }); return; }
  const balance = await retry(() => client.getBalance(wallet.address));
  if (balance < MIN_BALANCE) { status({ note: `waiting for funds (${fromNano(balance)} TON)`, balance: fromNano(balance) }); return; }

  const seqno = await retry(() => wallet.getSeqno());
  const body = beginCell().storeUint(0, 32).storeStringTail(`ZNB1:${j.season}:${j.hash}`).endCell();
  await retry(() => wallet.sendTransfer({
    secretKey: kp.secretKey, seqno, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to: wallet.address, value: POST_AMOUNT, body, bounce: false })], // to ITS OWN address, always
  }));
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    if ((await retry(() => wallet.getSeqno())) > seqno) {
      const p = posted(); p[j.season] = { hash: j.hash, at: new Date().toISOString() };
      fs.writeFileSync(postedFile, JSON.stringify(p));
      log("published", j.season, j.hash);
      status({ note: "published " + j.season });
      return;
    }
  }
  status({ note: "sent but not confirmed yet; will not resend automatically until checked" });
  const p = posted(); p[j.season] = { hash: j.hash, at: new Date().toISOString(), unconfirmed: true };
  fs.writeFileSync(postedFile, JSON.stringify(p)); // never double-send
}

status({ note: "started" });
for (;;) {
  try { await tick(); } catch (e) { log("tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "error: " + String(e?.message || e).slice(0, 120) }); }
  if (process.env.ZNB_ONCE) break;
  await sleep(EVERY_MS);
}
