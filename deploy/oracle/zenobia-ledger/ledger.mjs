// Zenobia ledger wallet.
//
// What this program can do with money (and nothing else):
//   1. Season posts: send ONE fixed tiny amount (0.001 TON/GRAM) from its own wallet TO ITS OWN ADDRESS, carrying
//      ZNB1:<season>:<sha256> as the comment.
//   2. Passport collection (only when the owner switched it on with agent/ZENOBIA_COLLECTION_ON): deploy the Caravan Passport
//      collection ONCE (0.04) and mint passports (0.03 each) by sending to the collection's own address, which is derived from the
//      committed contract code and this wallet's address. A mint goes only to the address the owner committed in agent/ZENOBIA_MINT_TO.
//   3. A hard ceiling on the deploy and the trial passport in (2): 0.12 in total, tracked in /state/passport.json. Past it nothing is sent.
//   4. Public passports (only while the owner has them open in the bot with /passports on): each one is 0.03, minted to the verified wallet
//      of the person who asked, strictly in order. Hard limits: 1.0 in total and 20 per day. It also stops when the balance is low.
//   5. Silk Road Passports (only when the owner switched them on with agent/ZENOBIA_SILK_ON): deploy the passport collection ONCE (0.04) and mint
//      each passport that its buyer PAID for. The ledger checks the payment itself on the chain (sender, exact comment, amount >= the tier price)
//      before it mints, and mints to the payer's address. A payment it cannot honour (sold out, or short of the price) is returned to its sender,
//      minus a small fee, once. Hard limits: 2500 passports, 150 per day.
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
const OPS_KEY = process.env.ZNB_OPS_KEY || ""; // the same token-derived key the Oracle health report already uses
const PUBLIC_MAX_SPEND = toNano("1"), PUBLIC_PER_DAY = 20;
const PUBLIC_SBT_ON = process.env.ZNB_PUBLIC_SBT === "1"; // the old free queue: off (holders now buy Silk Road Passports and pay for them)
const SILK_ON = process.env.ZNB_SILK_ON === "1";
const SILK_BASE = process.env.ZNB_SILK_BASE || "";
const SILK_JSON = process.env.ZNB_SILK_COLLECTION_JSON || "";
const SILK_ROYALTY_TO = (process.env.ZNB_SILK_ROYALTY_TO || process.env.ZNB_TRIAL_MINT_TO || "").trim();
const SILK_CAP = 2500, SILK_PER_DAY = 150, SILK_DEPLOY_VALUE = toNano("0.04"), SILK_REFUND_FEE = toNano("0.02");
/** 1-500: 1, 501-1500: 2, 1501-2500: 3 (GRAM). Keep in sync with src/lib/zenobiaSilk.ts */
const silkPrice = (idx) => (idx < 500 ? toNano("1") : idx < 1500 ? toNano("2") : toNano("3"));
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
let silkAddr = null;
async function send(to, value, body, init, refundOk = false) {
  const ok = to.equals(wallet.address) || (collectionAddr && to.equals(collectionAddr)) || (silkAddr && to.equals(silkAddr)) || refundOk; // refundOk: returning a payer's own payment
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

// ---- 4. public passports (the queue lives on the site; it is empty unless the owner opened passports in the bot) -------------
async function finishMint(s, idx) {
  const m = s.mints[idx];
  if (!m.item) {
    const r = await retry(() => client.runMethod(collectionAddr, "get_nft_address_by_index", [{ type: "int", value: BigInt(idx) }]));
    const item = r.stack.readAddress();
    for (let i = 0; i < 20 && !(await retry(() => client.isContractDeployed(item))); i++) await sleep(5000);
    if (!(await retry(() => client.isContractDeployed(item)))) return false;
    m.item = item.toString({ testOnly: NETWORK === "testnet" });
    savePstate(s);
  }
  if (!m.told) {
    const res = await fetch(`${SITE}/api/zenobia/ledger/minted`, { method: "POST", headers: { "content-type": "application/json", "x-ops-key": OPS_KEY }, body: JSON.stringify({ idx: Number(idx), item: m.item }) });
    if (res.ok) { m.told = true; savePstate(s); }
  }
  return true;
}

async function queueTick() {
  if (!PUBLIC_SBT_ON || !OPS_KEY || !DEPLOY_ON || !collectionAddr) return;
  const s = pstate();
  if (!s.collection?.deployed) return;
  const res = await fetch(`${SITE}/api/zenobia/ledger/queue`, { headers: { accept: "application/json", "x-ops-key": OPS_KEY } });
  if (!res.ok) return;
  const q = await res.json();
  // finish anything already sent (a restart between the send and the notice must never send again)
  for (const idx of Object.keys(s.mints)) if (idx !== "0" && !s.mints[idx].told) await finishMint(s, idx);
  if (!q.open || !Array.isArray(q.items)) return;
  const cd = await retry(() => client.runMethod(collectionAddr, "get_collection_data"));
  let next = cd.stack.readBigNumber();
  const today = new Date().toISOString().slice(0, 10);
  for (const it of q.items.slice(0, 3)) {
    const idx = String(it.idx);
    if (s.mints[idx]) continue;
    if (BigInt(idx) !== next) { status({ note: `passport ${idx} waits: the next index on-chain is ${next}` }); break; } // strictly in order
    let to;
    try { to = Address.parse(String(it.wallet)); } catch { status({ note: `passport ${idx}: invalid wallet, skipped` }); break; }
    const day = s.publicDay?.day === today ? s.publicDay : { day: today, n: 0 };
    const pubSpent = BigInt(s.publicSpent || "0");
    if (day.n >= PUBLIC_PER_DAY || pubSpent + MINT_VALUE > PUBLIC_MAX_SPEND) { status({ note: "public passport limit reached" }); break; }
    const balance = await retry(() => client.getBalance(wallet.address));
    if (balance < MINT_VALUE + toNano("0.02")) { status({ note: `public passports: waiting for funds (${fromNano(balance)})` }); break; }
    s.mints[idx] = { to: to.toString({ testOnly: NETWORK === "testnet", bounceable: false }), sentAt: new Date().toISOString() };
    s.publicSpent = String(pubSpent + MINT_VALUE); s.spent = String(BigInt(s.spent) + MINT_VALUE);
    s.publicDay = { day: today, n: day.n + 1 };
    savePstate(s); // recorded first
    const itemContent = beginCell().storeBuffer(Buffer.from(`${idx}.json`)).endCell();
    const nftContent = beginCell().storeAddress(to).storeRef(itemContent).storeAddress(null).endCell(); // no authority
    const body = beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(Number(idx), 64).storeCoins(ITEM_VALUE).storeRef(nftContent).endCell();
    await send(collectionAddr, MINT_VALUE, body);
    log("public passport mint sent", idx);
    next += 1n;
    await finishMint(s, idx);
  }
}


// ---- 5. Silk Road Passports: paid by the buyer, minted to the payer ---------------------------------------------------------
const silkFile = `${DIR}/silk.json`;
const sstate = () => readJson(silkFile, { collection: null, claims: {}, day: null });
const saveSstate = (s) => fs.writeFileSync(silkFile, JSON.stringify(s));

function silkInit() {
  const content = beginCell()
    .storeRef(beginCell().storeUint(1, 8).storeBuffer(Buffer.from(SILK_JSON)).endCell())
    .storeRef(beginCell().storeBuffer(Buffer.from(SILK_BASE)).endCell())
    .endCell();
  const royaltyTo = SILK_ROYALTY_TO ? Address.parse(SILK_ROYALTY_TO) : wallet.address;
  const royalty = beginCell().storeUint(7, 16).storeUint(100, 16).storeAddress(royaltyTo).endCell(); // 7% on every resale
  const data = beginCell().storeAddress(wallet.address).storeUint(0, 64).storeRef(content).storeRef(codeOf("silk-item")).storeRef(royalty).endCell();
  return { code: codeOf("silk-collection"), data };
}

/** A payment on the chain: from `from`, with exactly this comment, and the value it carried. */
async function findPayment(from, comment) {
  const txs = await retry(() => client.getTransactions(wallet.address, { limit: 60 }));
  for (const t of txs) {
    const m = t.inMessage;
    if (!m || m.info.type !== "internal" || !m.info.src || !m.info.src.equals(from)) continue;
    try {
      const sl = m.body.beginParse();
      if (sl.remainingBits < 32 || sl.loadUint(32) !== 0 || sl.loadStringTail() !== comment) continue;
    } catch { continue; }
    return { value: m.info.value.coins, hash: t.hash().toString("hex") };
  }
  return null;
}

async function silkFinish(s, id) {
  const c = s.claims[id];
  if (c.refunded || !c.sentAt) return;
  if (!c.item) {
    const r = await retry(() => client.runMethod(silkAddr, "get_nft_address_by_index", [{ type: "int", value: BigInt(c.idx) }]));
    const item = r.stack.readAddress();
    for (let i = 0; i < 20 && !(await retry(() => client.isContractDeployed(item))); i++) await sleep(5000);
    if (!(await retry(() => client.isContractDeployed(item)))) return;
    c.item = item.toString({ testOnly: NETWORK === "testnet" }); saveSstate(s);
  }
  if (!c.told) {
    const res = await fetch(`${SITE}/api/zenobia/silk/minted`, { method: "POST", headers: { "content-type": "application/json", "x-ops-key": OPS_KEY }, body: JSON.stringify({ id: Number(id), idx: c.idx, item: c.item }) });
    if (res.ok) { c.told = true; saveSstate(s); }
  }
}

async function silkTick() {
  if (!SILK_ON) return;
  if (!SILK_BASE.startsWith("https://") || !SILK_JSON.startsWith("https://")) { status({ note: "silk urls missing" }); return; }
  const init = silkInit();
  silkAddr = contractAddress(0, init);
  const s = sstate();
  if (!s.collection) {
    const balance = await retry(() => client.getBalance(wallet.address));
    if (balance < SILK_DEPLOY_VALUE + toNano("0.03")) { status({ note: `silk: waiting for funds (${fromNano(balance)})` }); return; }
    s.collection = { address: silkAddr.toString({ testOnly: NETWORK === "testnet" }), sentAt: new Date().toISOString(), deployed: false };
    saveSstate(s); // recorded first
    await send(silkAddr, SILK_DEPLOY_VALUE, beginCell().endCell(), init);
    log("silk collection deploy sent", s.collection.address);
  }
  if (!s.collection.deployed) {
    for (let i = 0; i < 20 && !(await retry(() => client.isContractDeployed(silkAddr))); i++) await sleep(5000);
    if (!(await retry(() => client.isContractDeployed(silkAddr)))) { status({ note: "waiting for the silk collection to deploy" }); return; }
    s.collection.deployed = true; saveSstate(s); log("silk collection deployed", s.collection.address);
  }
  if (!OPS_KEY) return;
  for (const id of Object.keys(s.claims)) if (!s.claims[id].told) await silkFinish(s, id); // a restart between the send and the notice never resends
  const res = await fetch(`${SITE}/api/zenobia/silk/queue`, { headers: { accept: "application/json", "x-ops-key": OPS_KEY } });
  if (!res.ok) return;
  const q = await res.json();
  if (!Array.isArray(q.claims)) return;
  for (const cl of q.claims.slice(0, 5)) {
    const id = String(cl.id);
    if (s.claims[id]) continue;
    let from;
    try { from = Address.parse(String(cl.wallet)); } catch { continue; }
    const pay = await findPayment(from, `SILK-${id}`);
    if (!pay) continue; // not paid (yet): nothing is spent
    const cd = await retry(() => client.runMethod(silkAddr, "get_collection_data"));
    const next = Number(cd.stack.readBigNumber());
    if (next >= SILK_CAP || pay.value < silkPrice(next)) {
      // cannot honour it: give the money back to its sender, once, minus a small fee
      const back = pay.value - SILK_REFUND_FEE;
      s.claims[id] = { refunded: true, hash: pay.hash, sentAt: new Date().toISOString() };
      saveSstate(s); // recorded first
      if (back > 0n) { await send(from, back, beginCell().storeUint(0, 32).storeStringTail("ZNB refund").endCell(), undefined, true); log("silk refund sent", id); }
      await fetch(`${SITE}/api/zenobia/silk/minted`, { method: "POST", headers: { "content-type": "application/json", "x-ops-key": OPS_KEY }, body: JSON.stringify({ id: Number(id), refunded: true }) }).catch(() => null);
      continue;
    }
    const today = new Date().toISOString().slice(0, 10);
    const day = s.day?.day === today ? s.day : { day: today, n: 0 };
    if (day.n >= SILK_PER_DAY) { status({ note: "silk daily limit reached" }); break; }
    const balance = await retry(() => client.getBalance(wallet.address));
    if (balance < MINT_VALUE + toNano("0.02")) { status({ note: `silk: waiting for funds (${fromNano(balance)})` }); break; }
    s.claims[id] = { to: from.toString({ testOnly: NETWORK === "testnet", bounceable: false }), idx: next, hash: pay.hash, sentAt: new Date().toISOString() };
    s.day = { day: today, n: day.n + 1 };
    saveSstate(s); // recorded first
    const itemContent = beginCell().storeBuffer(Buffer.from(`${next}.json`)).endCell();
    const nftContent = beginCell().storeAddress(from).storeRef(itemContent).endCell(); // owned by the payer
    const body = beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(next, 64).storeCoins(ITEM_VALUE).storeRef(nftContent).endCell();
    await send(silkAddr, MINT_VALUE, body);
    log("silk passport mint sent", id, next);
    await silkFinish(s, id);
  }
}

status({ note: "started" });
for (;;) {
  try { await seasonTick(); } catch (e) { log("season tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "error: " + String(e?.message || e).slice(0, 120) }); }
  try { await passportTick(); } catch (e) { log("passport tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "passport error: " + String(e?.message || e).slice(0, 120) }); }
  try { await silkTick(); } catch (e) { log("silk tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "silk error: " + String(e?.message || e).slice(0, 120) }); }
  try { await queueTick(); } catch (e) { log("queue tick failed:", String(e?.message || e).slice(0, 200)); status({ note: "queue error: " + String(e?.message || e).slice(0, 120) }); }
  if (process.env.ZNB_ONCE) break;
  await sleep(EVERY_MS);
}
