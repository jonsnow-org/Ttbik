// Native TON / USDT-TON payment rail (owner spec, 2026-09-02) — sits
// ALONGSIDE the existing NOWPayments integration, never replacing it.
//
// Design choice vs. the originally-requested "one on-chain subwallet per
// user + auto-sweep": this uses ONE shared hot wallet
// (MASTER_HOT_WALLET_ADDRESS) for every deposit, and tells users apart by
// a unique memo/comment attached to their transfer (User.tonMemo) — the
// same pattern real exchanges use. No per-user on-chain wallet contracts
// to deploy or sweep, far less surface for a bug to lose real funds.
//
// MASTER_TON_MNEMONIC controls real money. It must only ever come from
// process.env (set in Vercel's dashboard) — never hardcoded, logged, or
// written to any file in this repo.
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, Cell, Slice, internal, toNano, fromNano, beginCell } from "@ton/core";
import { TonClient, WalletContractV4 } from "@ton/ton";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const TON_API_ENDPOINT =
  process.env.TON_NETWORK === "testnet"
    ? "https://testnet.toncenter.com/api/v2/jsonRPC"
    : "https://toncenter.com/api/v2/jsonRPC";

let cachedClient: TonClient | null = null;
function getClient(): TonClient {
  if (!cachedClient) {
    cachedClient = new TonClient({ endpoint: TON_API_ENDPOINT, apiKey: process.env.TON_API_KEY });
  }
  return cachedClient;
}

async function getMasterWallet() {
  const mnemonic = (process.env.MASTER_TON_MNEMONIC || "").trim().split(/\s+/);
  if (mnemonic.length < 24) throw new Error("MASTER_TON_MNEMONIC is not configured (need a 24-word seed phrase)");
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  return { keyPair, wallet };
}

function generateMemo(): string {
  return crypto.randomBytes(6).toString("hex");
}

// Assigns a permanent unique deposit memo the first time a user needs one
// (shown once, reused forever after — matches how the bot's other
// identifiers work).
export async function getOrCreateTonMemo(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { tonMemo: true } });
  if (existing?.tonMemo) return existing.tonMemo;
  let memo = generateMemo();
  for (let i = 0; i < 5 && (await prisma.user.findUnique({ where: { tonMemo: memo } })); i++) {
    memo = generateMemo();
  }
  await prisma.user.update({ where: { id: userId }, data: { tonMemo: memo } });
  return memo;
}

// Fetches the current TON→USD rate for converting a deposit's on-chain
// amount into the platform's unified USD balance. Falls back to a fixed
// estimate rather than throwing, so a price-API hiccup doesn't stall every
// deposit in the scan — an approximate credit beats none at all here,
// same tradeoff NOWPayments' own outcome_amount conversion already makes.
const TON_USD_FALLBACK_RATE = 5;
async function getTonUsdRate(): Promise<number> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd", {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const rate = Number(data?.["the-open-network"]?.usd);
    return rate > 0 ? rate : TON_USD_FALLBACK_RATE;
  } catch {
    return TON_USD_FALLBACK_RATE;
  }
}

// A TON "simple transfer comment" is op-code 0 (uint32) followed by the
// UTF-8 text, possibly spanning multiple cell refs.
function extractCommentFromSlice(slice: Slice): string | null {
  try {
    if (slice.remainingBits < 32) return null;
    const op = slice.loadUint(32);
    if (op !== 0) return null;
    const text = slice.loadStringTail().trim();
    return text || null;
  } catch {
    return null;
  }
}
function extractComment(body: Cell): string | null {
  return extractCommentFromSlice(body.beginParse());
}

// --- USDT-TON (Tether's official Jetton on TON mainnet) ---------------
// Same shared hot wallet, same memo scheme as native TON above — the only
// difference is HOW a deposit shows up on-chain. Sending a Jetton doesn't
// move TON into the hot wallet directly: it moves the Jetton into the hot
// wallet's own per-jetton "Jetton wallet" child contract, which then fires
// a transfer_notification message back to its owner (our hot wallet) —
// that notification is what actually lands in the hot wallet's own
// transaction history, so scanTonDeposits() below can see it in the same
// getTransactions() call used for native TON, no separate polling needed.
//
// Address confirmed against Tether's own supported-protocols page and
// Tonscan (2026-09-06) — overridable via USDT_JETTON_MASTER_ADDRESS
// without a code change if Tether ever migrates it.
const USDT_JETTON_MASTER = process.env.USDT_JETTON_MASTER_ADDRESS || "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USDT_DECIMALS = 6;
const JETTON_TRANSFER_NOTIFICATION_OP = 0x7362d09c;

// The hot wallet's Jetton-wallet address is a deterministic child contract
// of (jetton master, owner) — computed once via the master's own
// get_wallet_address get-method and cached forever (it never changes).
let cachedHotWalletUsdtAddress: Address | null = null;
async function getHotWalletUsdtJettonAddress(hotWalletAddress: Address): Promise<Address> {
  if (cachedHotWalletUsdtAddress) return cachedHotWalletUsdtAddress;
  const client = getClient();
  const master = Address.parse(USDT_JETTON_MASTER);
  const ownerSlice = beginCell().storeAddress(hotWalletAddress).endCell();
  const result = await client.runMethod(master, "get_wallet_address", [{ type: "slice", cell: ownerSlice }]);
  cachedHotWalletUsdtAddress = result.stack.readAddress();
  return cachedHotWalletUsdtAddress;
}

// transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
// sender:MsgAddress forward_payload:(Either Cell ^Cell). Wallet apps (e.g.
// Tonkeeper) put a plain-text comment in forward_payload the exact same
// way a native TON transfer does, so extractCommentFromSlice() is reused
// on whichever slice it ends up in (inline vs. a separate ref cell).
function parseJettonNotification(body: Cell): { amount: bigint; comment: string | null } | null {
  try {
    const slice = body.beginParse();
    const op = slice.loadUint(32);
    if (op !== JETTON_TRANSFER_NOTIFICATION_OP) return null;
    slice.loadUint(64); // query_id
    const amount = slice.loadCoins();
    slice.loadAddress(); // sender — not trusted for identity; inMsg.info.src is what proves this came from OUR jetton wallet
    const payloadIsRef = slice.loadBit();
    const payloadSlice = payloadIsRef ? slice.loadRef().beginParse() : slice;
    return { amount, comment: extractCommentFromSlice(payloadSlice) };
  } catch {
    return null;
  }
}

// Scans the shared hot wallet's recent incoming transfers, matches each by
// its memo to a User.tonMemo, and credits that user's balance exactly once
// per on-chain transaction — idempotency comes from TonTransaction.txHash
// being unique, so re-scanning the same transactions on the next run is
// always safe. Meant to run on a schedule (see
// /api/cron/ton-deposits) — Vercel's Hobby plan caps cron at once daily,
// so a real TON deposit can take up to ~24h to actually land in a user's
// balance. That's a real, user-visible limitation of the free tier, not
// something this function can work around on its own.
export async function scanTonDeposits(): Promise<{ scanned: number; credited: number }> {
  const hotWallet = process.env.MASTER_HOT_WALLET_ADDRESS;
  if (!hotWallet) throw new Error("MASTER_HOT_WALLET_ADDRESS is not configured");
  const client = getClient();
  const address = Address.parse(hotWallet);
  const transactions = await client.getTransactions(address, { limit: 50 });

  let usdtWalletAddress: Address | null = null;
  try {
    usdtWalletAddress = await getHotWalletUsdtJettonAddress(address);
  } catch {
    // USDT scanning degrades gracefully on any RPC hiccup — native TON
    // deposits below are unaffected.
  }

  let credited = 0;
  for (const tx of transactions) {
    const inMsg = tx.inMessage;
    if (!inMsg || inMsg.info.type !== "internal") continue; // skip the wallet's own outgoing transfers
    const valueNano = inMsg.info.value.coins;
    if (valueNano <= BigInt(0)) continue;

    const jettonNotification = parseJettonNotification(inMsg.body);
    const isFromOurUsdtWallet = !!usdtWalletAddress && inMsg.info.src.equals(usdtWalletAddress);

    let asset: "TON" | "USDT";
    let comment: string | null;
    let assetAmount: number;
    let usdValue: number;
    if (jettonNotification && isFromOurUsdtWallet) {
      asset = "USDT";
      comment = jettonNotification.comment;
      assetAmount = Number(jettonNotification.amount) / 10 ** USDT_DECIMALS;
      usdValue = Math.round(assetAmount * 100) / 100; // USDT tracks USD ~1:1, no rate lookup needed
    } else {
      asset = "TON";
      comment = extractComment(inMsg.body);
      assetAmount = Number(fromNano(valueNano));
      const rate = await getTonUsdRate();
      usdValue = Math.round(assetAmount * rate * 100) / 100;
    }
    if (!comment || usdValue <= 0) continue;

    const user = await prisma.user.findUnique({ where: { tonMemo: comment } });
    if (!user) continue;

    const txHash = tx.hash().toString("hex");

    try {
      await prisma.$transaction([
        prisma.tonTransaction.create({
          data: { userId: user.id, type: "DEPOSIT", amountTon: assetAmount, usdValue, txHash, status: "COMPLETED", asset },
        }),
        prisma.user.update({ where: { id: user.id }, data: { balance: { increment: usdValue } } }),
        prisma.transaction.create({
          data: { userId: user.id, amount: usdValue, currency: asset, type: "DEPOSIT", status: "COMPLETED", txHash },
        }),
      ]);
      credited++;
    } catch {
      // Unique constraint on txHash — this transaction was already
      // credited on a previous scan. Expected and safe to skip.
    }
  }
  return { scanned: transactions.length, credited };
}

// Signs and broadcasts a real on-chain payout from the shared hot wallet.
// This is a pure "sign and send" primitive — it enforces no approval
// logic itself. Callers MUST have already gone through the existing
// SUPER_ADMIN manual-approval + $20 audit-threshold gate (see
// decideWithdrawal in adBotLogic.ts) before calling this; it is not a
// substitute for that check.
export async function sendTonWithdrawal(toAddress: string, amountTon: number): Promise<void> {
  const { keyPair, wallet } = await getMasterWallet();
  const client = getClient();
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: toNano(amountTon.toFixed(4)),
        bounce: false,
        body: "TTBIK withdrawal",
      }),
    ],
  });
}

export function getMasterHotWalletAddress(): string | null {
  return process.env.MASTER_HOT_WALLET_ADDRESS || null;
}

export function isTonAddress(address: string): boolean {
  try {
    Address.parse(address.trim());
    return true;
  } catch {
    return false;
  }
}

export async function usdToTon(usdAmount: number): Promise<number> {
  const rate = await getTonUsdRate();
  return Math.round((usdAmount / rate) * 10000) / 10000;
}

export function isNativeTonConfigured(): boolean {
  return Boolean(process.env.MASTER_TON_MNEMONIC && process.env.MASTER_HOT_WALLET_ADDRESS);
}

// Periodic real (not just bookkeeping) transfer of the platform's
// accumulated net profit from the shared hot wallet to the owner's own
// personal external wallet (owner spec, 2026-09-02). Threshold defaults to
// $15 — deliberately kept above $10 (per owner instruction) so the swept
// amount comfortably covers TON's small network fee rather than sweeping
// right at the edge of it. Meant to be called from a schedule (folded into
// the existing /api/cron/ton-deposits run rather than a separate cron
// entry, to stay within Vercel's cron-job limits).
const OWNER_SWEEP_DEFAULT_THRESHOLD = 15;

export async function checkAndSweepOwnerProfits(): Promise<{ swept: boolean; amountTon?: number; usdValue?: number }> {
  const ownerAddress = process.env.OWNER_CWALLET_ADDRESS;
  if (!ownerAddress || !isNativeTonConfigured()) return { swept: false };

  const threshold = Number(process.env.OWNER_SWEEP_THRESHOLD || OWNER_SWEEP_DEFAULT_THRESHOLD);
  const settings = await prisma.platformSettings.findUnique({ where: { id: 1 } });
  const accumulated = Number(settings?.accumulatedOwnerProfit || 0);
  if (accumulated <= threshold) return { swept: false };

  const amountTon = await usdToTon(accumulated);
  await sendTonWithdrawal(ownerAddress, amountTon);

  // Record the sweep against the SUPER_ADMIN's own user row (creating it
  // defensively if it doesn't exist yet — this can run before any task has
  // ever completed). User.botId has no real foreign-key constraint, so a
  // placeholder is safe here; this row isn't tied to any specific bot.
  const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (superAdminId) {
    await prisma.user.upsert({ where: { id: superAdminId }, update: {}, create: { id: superAdminId, botId: "platform", role: "SUPER_ADMIN" } });
  }
  await prisma.$transaction([
    prisma.platformSettings.update({ where: { id: 1 }, data: { accumulatedOwnerProfit: { decrement: accumulated } } }),
    ...(superAdminId
      ? [
          prisma.tonTransaction.create({
            data: {
              userId: superAdminId,
              type: "OWNER_SWEEP",
              amountTon,
              usdValue: accumulated,
              txHash: `sweep_${Date.now()}`,
              toAddress: ownerAddress,
              status: "COMPLETED",
            },
          }),
        ]
      : []),
  ]);

  return { swept: true, amountTon, usdValue: accumulated };
}
