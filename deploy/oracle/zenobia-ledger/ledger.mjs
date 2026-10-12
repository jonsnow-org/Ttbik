// Zenobia ledger wallet.
//
// What this program can do with money (and nothing else):
//   1. Season posts: send ONE fixed tiny amount (0.001 TON/GRAM) from its own wallet TO ITS OWN ADDRESS, carrying
//      ZNB1:<season>:<sha256> as the comment.
//   2. Passport collection (only when the owner switched it on with agent/ZENOBIA_COLLECTION_ON): deploy the Caravan Passport
//      collection ONCE (0.04) and mint passports (0.03 each) by sending to the collection's own address, which is derived from the
//      committed contract code and this wallet's address. A mint goes only to the address the owner committed in agent/ZENOBIA_MINT_TO.
//   3. A hard ceiling on everything in (2): 0.12 in total, tracked in /state/passport.json. Past it nothing is sent.
// Each action is recorded BEFORE it is waited on, so a crash or a restart can never send twice.
// The key is generated here on first run and stays in /state (mode 600, a folder that belongs to this container only).
// It is never printed, logged or sent anywhere; only the public address is written to /state/address and status.json.
import fs from "node:fs";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4, internal, SendMode, beginCell, toNano, fromNano, Address, Cell, contractAddress } from "@ton/ton";

const NETWORK = process.env.ZNB_NETWORK === "testnet" ? "testnet" : "mainnet";
const DIR = process.env.ZNB_DIR || "/state";
const SITE = (process.env.ZNB_SITE || "https://ttbik.vercel.app").replace(/\/$/, "");
const EVERY_MS = Number(process.env.ZNB_EVERY_MS || 10 * 60_000);
const POST_AMOUNT = toNano("0.001"); // fixed: season posts have no other amount
const MIN_BALANCE = toNano("0.02"); // do not even try below this
const DEPLOY_VALUE = toNano("0.04"), MINT_VALUE = toNano("0.03"), ITEM_VALUE = toNano("0.02");
const MAX_PASSPORT_SPEND = toNano("0.12");
const DEPLOY_ON = process.env.ZNB_DEPLOY_COLLECTION === "1";
const PASSPORT_BASE = process.env.ZNB_PASSPORT_BASE || "";
const COLLECTION_JSON = process.env.ZNB_COLLECTION_JSON || "";
const TRIAL_TO = (process.env.ZNB_TRIAL_MINT_TO || "").trim();
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

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const postedFile = `${DIR}/posted.json`;
const passportFile = `${DIR}/passport.json`;
const posted = () => readJson(postedFile, {});
const pstate = () => readJson(passportFile, { spent: "0", collection: null, mints: {} });
const savePstate = (s) => fs.writeFileSync(passportFile, JSON.stringify(s));
const status = (extra = {}) => fs.writeFileSync(`${DIR}/status.json`, JSON.stringify({ address, network: NETWORK, updated: new Date().toISOString(), posted: posted(), passport: pstate(), ...extra }));

async function retry(fn) {
  for (let i = 0; i < 6; i++) {
    try { return await fn(); } catch (e) { if (!/429/.test(String(e?.message))) throw e; await sleep(2500 * (i + 1)); }
  }
  throw new Error("rate limited");
}

/** The one place that sends money. Only to this wallet itself or to the passport collection address. */
let collectionAddr = null;
async function send(to, value, body, init) {
  const ok = to.equals(wallet.address) || (collectionAddr && to.equals(collectionAddr));
  if (!ok) throw new Error("refusing to send to an address that is not ours");
  const seqno = await retry(() => wallet.getSeqno());
  await retry(() => wallet.sendTransfer({
    secretKey: kp.secretKey, seqno, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to, value, body, init, bounce: false })],
  }));
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    if ((await retry(() => wallet.getSeqno())) > seqno) return true;
  }
  return false;
}

// ---- 1. season posts -------------------------------------------------------------------------------------------------
async function seasonTick() {
  const res = await fetch(`${SITE}/api/zenobia/ledger/latest`, { headers: { accept: "application/json" } });
  if (!res.ok) { status({ note: `site answered ${res.status}` }); return; }
  const j = await res.json();
  if (!j.season || !/^\d{4}-W\d{2}$/.test(j.season) || !/^[0-9a-f]{64}$/.test(j.hash || "")) { status({ note: "no closed season yet" }); return; }
  if (posted()[j.season]) { status({ note: "up to date" }); return; }
  const balance = await retry(() => client.getBalance(wallet.address));
  if (balance < MIN_BALANCE) { status({ note: `waiting for funds (${fromNano(balance)})`, balance: fromNano(balance) }); return; }
  const p = posted(); p[j.season] = { hash: j.hash, at: new Date().toISOString(), unconfirmed: true };
  fs.writeFileSync(postedFile, JSON.stringify(p)); // recorded first: never double-send
  const body = beginCell().storeUint(0, 32).storeStringTail(`ZNB1:${j.season}:${j.hash}`).endCell();
  const confirmed = await send(wallet.address, POST_AMOUNT, body); // to ITS OWN address, always
  if (confirmed) { const q = posted(); q[j.season] = { hash: j.hash, at: new Date().toISOString() }; fs.writeFileSync(postedFile, JSON.stringify(q)); log("published", j.season, j.hash); }
  status({ note: confirmed ? "published " + j.season : "sent but not confirmed yet; will not resend" });
}

// ---- 2. the passport collection --------------------------------------------------------------------------------------
const codeOf = (name) => Cell.fromBase64(fs.readFileSync(new URL(`./contracts/${name}.boc.b64`, import.meta.url), "utf8").trim());

function collectionInit() {
  const content = beginCell()
    .storeRef(beginCell().storeUint(1, 8).storeBuffer(Buffer.from(COLLECTION_JSON)).endCell())
    .storeRef(beginCell().storeBuffer(Buffer.from(PASSPORT_BASE)).endCell())
    .endCell();
  const royalty = beginCell().storeUint(0, 16).storeUint(100, 16).storeAddress(wallet.address).endCell();
  const data = beginCell().storeAddress(wallet.address).storeUint(0, 64).storeRef(content).storeRef(codeOf("item")).storeRef(royalty).endCell();
  return { code: codeOf("collection"), data };
}

async function passportTick() {
  if (!DEPLOY_ON) return;
  if (!PASSPORT_BASE.startsWith("https://") || !COLLECTION_JSON.startsWith("https://")) { status({ note: "passport urls missing" }); return; }
  const init = collectionInit();
  collectionAddr = contractAddress(0, init);
  const s = pstate();
  const spent = BigInt(s.spent);

  // a) deploy the collection once
  if (!s.collection) {
    if (spent + DEPLOY_VALUE > MAX_PASSPORT_SPEND) { status({ note: "passport spend ceiling reached" }); return; }
    const balance = await retry(() => client.getBalance(wallet.address));
    if (balance < DEPLOY_VALUE + toNano("0.05")) { status({ note: `passport: waiting for funds (${fromNano(balance)})` }); return; }
    s.collection = { address: collectionAddr.toString({ testOnly: NETWORK === "testnet" }), sentAt: new Date().toISOString(), deployed: false };
    s.spent = String(spent + DEPLOY_VALUE);
    savePstate(s); // recorded first
    await send(collectionAddr, DEPLOY_VALUE, beginCell().endCell(), init);
    log("collection deploy sent", s.collection.address);
  }
  if (!s.collection.deployed) {
    for (let i = 0; i < 20 && !(await retry(() => client.isContractDeployed(collectionAddr))); i++) await sleep(5000);
    if (!(await retry(() => client.isContractDeployed(collectionAddr)))) {
      status({ note: Date.now() - Date.parse(s.collection.sentAt) > 30 * 60_000 ? "collection not deployed after 30 min: stopped, nothing resent" : "waiting for the collection to deploy" });
      return;
    }
    s.collection.deployed = true; savePstate(s); log("collection deployed", s.collection.address);
  }

  // b) the trial passport (index 0) to the address the owner committed
  if (!TRIAL_TO) return;
  let to;
  try { to = Address.parse(TRIAL_TO); } catch { status({ note: "trial mint address is not valid" }); return; }
  const idx = "0";
  if (!s.mints[idx]) {
    const sp = BigInt(s.spent);
    if (sp + MINT_VALUE > MAX_PASSPORT_SPEND) { status({ note: "passport spend ceiling reached" }); return; }
    const balance = await retry(() => client.getBalance(wallet.address));
    if (balance < MINT_VALUE + toNano("0.02")) { status({ note: `passport: waiting for funds (${fromNano(balance)})` }); return; }
    s.mints[idx] = { to: to.toString({ testOnly: NETWORK === "testnet", bounceable: false }), sentAt: new Date().toISOString() };
    s.spent = String(sp + MINT_VALUE);
    savePstate(s); // recorded first
    const itemContent = beginCell().storeBuffer(Buffer.from(`${idx}.json`)).endCell();
    const nftContent = beginCell().storeAddress(to).storeRef(itemContent).storeAddress(null).endCell(); // no authority: nobody can revoke it
    const body = beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(Number(idx), 64).storeCoins(ITEM_VALUE).storeRef(nftContent).endCell();
    await send(collectionAddr, MINT_VALUE, body);
    log("passport mint sent", idx);
  }
  if (!s.mints[idx].item) {
    const r = await retry(() => client.runMethod(collectionAddr, "get_nft_address_by_index", [{ type: "int", value: BigInt(idx) }]));
    const item = r.stack.readAddress();
    for (let i = 0; i < 20 && !(await retry(() => client.isContractDeployed(item))); i++) await sleep(5000);
    if (await retry(() => client.isContractDeployed(item))) { s.mints[idx].item = item.toString({ testOnly: NETWORK === "testnet" }); savePstate(s); log("passport minted", s.mints[idx].item); }
  }
}

status({ note: "started" });
for (;;) {
  try { await seasonTick(); } catch (e) { log("season tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "error: " + String(e?.message || e).slice(0, 120) }); }
  try { await passportTick(); } catch (e) { log("passport tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "passport error: " + String(e?.message || e).slice(0, 120) }); }
  if (process.env.ZNB_ONCE) break;
  await sleep(EVERY_MS);
}
