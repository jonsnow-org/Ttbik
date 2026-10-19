// Payout side of the invite rewards (owner order 2026-10-19: build the hot payout wallet, with a log in the platform bot and manual payout of what is due).
// Money moves here, so every step is bounded:
//  - a separate hot wallet that holds only what the owner funds it with; nothing leaves it except rewards to linked inviter wallets and the owner's own /referrals withdraw;
//  - payouts run only while the owner has them switched on (/referrals on) or when the owner presses /referrals pay;
//  - caps per inviter and per day, a minimum payout, and a reserve that always stays in the wallet;
//  - a payout row is written BEFORE sending; if the send is uncertain it is marked 'unknown' and every payout stops until the owner resolves it.
import crypto from "crypto";
import { Address, beginCell, internal, SendMode } from "@ton/core";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4 } from "@ton/ton";
import { prisma } from "@/lib/prisma";
import { platformToken } from "@/lib/znbtEngage";
import { MIN_PAYOUT_NANO, accountOf, ensureRefTables, fmtNano } from "@/lib/znbtRefs";

export const INVITER_DAILY_CAP_NANO = 20_000_000_000n;
export const GLOBAL_DAILY_CAP_NANO = 50_000_000_000n;
export const WALLET_RESERVE_NANO = 100_000_000n;   // always left in the payout wallet for fees
const MAX_PAYOUTS_PER_RUN = 3;

// ---------- pure helpers (unit tested) ----------
/** What may be paid to one inviter now, given what is owed, what was paid in the last 24h, and the wallet balance. */
export function payoutAmount(pending: bigint, paidTodayInviter: bigint, paidTodayAll: bigint, balance: bigint): bigint {
  let amt = pending;
  for (const room of [INVITER_DAILY_CAP_NANO - paidTodayInviter, GLOBAL_DAILY_CAP_NANO - paidTodayAll, balance - WALLET_RESERVE_NANO]) if (room < amt) amt = room;
  return amt >= MIN_PAYOUT_NANO ? amt : 0n;
}
const key = (secret: string) => crypto.createHash("sha256").update("znbt-payout-wallet:" + secret).digest();
export function encryptWords(words: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([c.update(words, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
export function decryptWords(blob: string, secret: string): string {
  const [iv, tag, body] = blob.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

// ---------- state ----------
let stateReady: Promise<void> | null = null;
const ensureState = () => (stateReady ??= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_ref_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { stateReady = null; throw e; }));
const getState = async (k: string): Promise<string | null> => {
  await ensureRefTables(); await ensureState();
  return ((await prisma.$queryRawUnsafe(`SELECT value FROM znbt_ref_state WHERE key=$1`, k)) as { value: string }[])[0]?.value ?? null;
};
const setState = async (k: string, v: string) => {
  await ensureRefTables(); await ensureState();
  await prisma.$executeRawUnsafe(`INSERT INTO znbt_ref_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, k, v);
};
export const payoutsEnabled = async () => (await getState("payouts")) === "on";
export const setPayouts = (on: boolean) => setState("payouts", on ? "on" : "off");

// ---------- the payout wallet ----------
const client = () => new TonClient({ endpoint: "https://toncenter.com/api/v2/jsonRPC", apiKey: process.env.TONCENTER_API_KEY || undefined });
async function openPayoutWallet() {
  const token = await platformToken();
  if (!token) throw new Error("platform bot not active");
  let blob = await getState("wallet_enc");
  if (!blob) {   // created once, on the owner's first /referrals; the words never leave the database in clear text and are never printed
    blob = encryptWords((await mnemonicNew(24)).join(" "), token);
    await setState("wallet_enc", blob);
  }
  const kp = await mnemonicToPrivateKey(decryptWords(blob, token).split(" "));
  const wallet = WalletContractV4.create({ publicKey: kp.publicKey, workchain: 0 });
  return { wallet, kp, address: wallet.address.toString({ bounceable: false, urlSafe: true }) };
}
export async function payoutWalletInfo(): Promise<{ address: string; balance: bigint | null }> {
  const { address, wallet } = await openPayoutWallet();
  let balance: bigint | null = null;
  try { balance = await client().getBalance(wallet.address); } catch { /* shown as unknown */ }
  return { address, balance };
}

async function sendFromPayoutWallet(to: string, amount: bigint, mode: "amount" | "all", comment: string): Promise<boolean> {
  const { wallet, kp } = await openPayoutWallet();
  const w = client().open(wallet);
  const seqno = await w.getSeqno();
  await w.sendTransfer({
    seqno, secretKey: kp.secretKey,
    sendMode: mode === "all" ? SendMode.CARRY_ALL_REMAINING_BALANCE : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to: Address.parse(to), value: amount, bounce: false, body: beginCell().storeUint(0, 32).storeStringTail(comment).endCell() })],
  });
  for (let i = 0; i < 12; i++) {   // the seqno moving proves the message was accepted
    await new Promise((r) => setTimeout(r, 2500));
    try { if ((await w.getSeqno()) > seqno) return true; } catch { /* keep waiting */ }
  }
  return false;
}

/** Owner only: send everything in the payout wallet to an address (before rotating the bot token, or to stop for good). */
export async function withdrawAll(to: string): Promise<boolean> {
  Address.parse(to);
  return sendFromPayoutWallet(to, 0n, "all", "Palmyra Launch payout wallet withdrawal");
}

/** Pays what is due (above the minimum, inside the caps, within the wallet's balance). `force` = the owner pressed pay: runs even if automatic payouts are off. */
export async function runPayouts(force = false): Promise<{ sent: number; total: bigint; note: string }> {
  if (!force && !(await payoutsEnabled())) return { sent: 0, total: 0n, note: "automatic payouts are off" };
  await ensureRefTables();
  const stuck = (await prisma.$queryRawUnsafe(`SELECT 1 FROM znbt_ref_payouts WHERE status IN ('pending','unknown') LIMIT 1`)) as unknown[];
  if (stuck.length) return { sent: 0, total: 0n, note: "an earlier payout is unresolved: check the wallet, then /referrals resolve" };
  const info = await payoutWalletInfo();
  if (info.balance === null) return { sent: 0, total: 0n, note: "could not read the payout wallet balance" };
  let balance = info.balance;
  const inviters = (await prisma.$queryRawUnsafe(`SELECT DISTINCT inviter FROM znbt_ref_events`)) as { inviter: string }[];
  const recent = (await prisma.$queryRawUnsafe(`SELECT inviter, amount_nano FROM znbt_ref_payouts WHERE status='sent' AND sent_at > now() - interval '24 hours'`)) as { inviter: string; amount_nano: string }[];
  let paidAll = recent.reduce((a, x) => a + BigInt(x.amount_nano), 0n);
  let sent = 0, total = 0n, note = "";
  for (const { inviter } of inviters) {
    if (sent >= MAX_PAYOUTS_PER_RUN) { note = "more are due: they continue next run"; break; }
    const acc = await accountOf(inviter);
    if (!acc.wallet || acc.pending < MIN_PAYOUT_NANO) continue;
    const paidInv = recent.filter((x) => x.inviter === inviter).reduce((a, x) => a + BigInt(x.amount_nano), 0n);
    const amount = payoutAmount(acc.pending, paidInv, paidAll, balance);
    if (amount <= 0n) { note ||= "some rewards wait: the wallet balance or a daily cap is too low"; continue; }
    const row = (await prisma.$queryRawUnsafe(`INSERT INTO znbt_ref_payouts (inviter, wallet, amount_nano, status) VALUES ($1,$2,$3,'pending') RETURNING id`, inviter, acc.wallet, amount.toString())) as { id: bigint }[];
    const id = row[0].id;
    let ok = false;
    try { ok = await sendFromPayoutWallet(acc.wallet, amount, "amount", "Palmyra Launch invite reward"); }
    catch (e: any) {   // nothing was submitted: safe to retry on the next run
      await prisma.$executeRawUnsafe(`UPDATE znbt_ref_payouts SET status='failed', note=$2 WHERE id=$1`, id, String(e?.message || e).slice(0, 200));
      return { sent, total, note: "a send failed (nothing left the wallet); it will be retried" };
    }
    if (!ok) {
      await prisma.$executeRawUnsafe(`UPDATE znbt_ref_payouts SET status='unknown', note='seqno did not move: check the wallet, then resolve' WHERE id=$1`, id);
      return { sent, total, note: "a payout could not be confirmed: all payouts are paused until you check the wallet and /referrals resolve" };
    }
    await prisma.$executeRawUnsafe(`UPDATE znbt_ref_payouts SET status='sent', sent_at=now() WHERE id=$1`, id);
    sent++; total += amount; balance -= amount; paidAll += amount;
  }
  return { sent, total, note };
}

/** Owner confirms that an unresolved payout either arrived (sent) or did not (failed). */
export async function resolveUnknown(arrived: boolean): Promise<number> {
  await ensureRefTables();
  const n = await prisma.$executeRawUnsafe(`UPDATE znbt_ref_payouts SET status=$1, sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END WHERE status IN ('pending','unknown')`, arrived ? "sent" : "failed");
  return Number(n);
}

/** The text of /referrals: wallet, balance, switch, totals, who is owed what, and the latest payouts. */
export async function ownerLog(): Promise<string> {
  await ensureRefTables();
  const w = await payoutWalletInfo();
  const on = await payoutsEnabled();
  const ev = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n, COALESCE(SUM(fee_nano::numeric),0)::text AS fees, COALESCE(SUM(reward_nano::numeric),0)::text AS rewards FROM znbt_ref_events`)) as { n: number; fees: string; rewards: string }[];
  const pay = (await prisma.$queryRawUnsafe(`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount_nano::numeric),0)::text AS total FROM znbt_ref_payouts GROUP BY status`)) as { status: string; n: number; total: string }[];
  const links = (await prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*)::int FROM znbt_referrals) AS refs, (SELECT COUNT(*)::int FROM znbt_wallets) AS wallets`)) as { refs: number; wallets: number }[];
  const owed = (await prisma.$queryRawUnsafe(`SELECT inviter FROM znbt_ref_events GROUP BY inviter`)) as { inviter: string }[];
  const lines: string[] = [];
  let due = 0n;
  for (const { inviter } of owed.slice(0, 40)) {
    const a = await accountOf(inviter);
    if (a.pending > 0n) { due += a.pending; lines.push(`• ${inviter}: ${fmtNano(a.pending)} GRAM${a.wallet ? "" : " (no wallet linked)"}`); }
  }
  const sentRow = pay.find((p) => p.status === "sent");
  const recent = (await prisma.$queryRawUnsafe(`SELECT inviter, amount_nano, status, COALESCE(to_char(sent_at,'MM-DD HH24:MI'), to_char(created_at,'MM-DD HH24:MI')) AS at FROM znbt_ref_payouts ORDER BY id DESC LIMIT 5`)) as { inviter: string; amount_nano: string; status: string; at: string }[];
  const f = (s: string) => fmtNano(BigInt(s.split(".")[0]));
  return [
    "🪙 Invite rewards · مكافآت الدعوات",
    `Automatic payouts: ${on ? "ON ✅" : "OFF ⛔"}`,
    `Payout wallet: ${w.address}`,
    `Balance: ${w.balance === null ? "unknown" : fmtNano(w.balance)} GRAM (send GRAM here to fund payouts)`,
    "",
    `Invites: ${links[0].refs} · linked wallets: ${links[0].wallets}`,
    `Buys credited: ${ev[0].n} · platform fees behind them: ${f(ev[0].fees)} GRAM`,
    `Rewards credited in total: ${f(ev[0].rewards)} GRAM (20% of those fees)`,
    `Paid so far: ${sentRow ? f(sentRow.total) : "0.000"} GRAM · due now: ${fmtNano(due)} GRAM`,
    ...(lines.length ? ["", "Due:", ...lines] : []),
    ...(recent.length ? ["", "Latest payouts:", ...recent.map((r) => `• ${r.at} ${r.inviter} ${fmtNano(BigInt(r.amount_nano))} GRAM [${r.status}]`)] : []),
    ...(pay.some((p) => p.status === "unknown" || p.status === "pending") ? ["", "⚠️ A payout is unresolved. Check the wallet, then /referrals resolve sent or /referrals resolve failed."] : []),
    "",
    "/referrals on · /referrals off · /referrals pay (pay what is due now) · /referrals withdraw ADDRESS",
  ].join("\n");
}
