// Invite rewards of the coin platform, accounting side. A person who joins through an invite link and trades on the platform's coins pays the platform fee as usual;
// the inviter is credited REWARD_SHARE_BPS of that FEE (never of the trade) for REWARD_DAYS days after the invitee linked their wallet.
//  - the credit is a share of fees the platform really earned, measured from the invitee's own on-chain transactions, so wash trading loses money;
//  - this module only keeps the ledger: it never signs or sends anything. Paying the balances out is a separate step the owner has not enabled yet.
import { Address } from "@ton/core";
import { prisma } from "@/lib/prisma";
import { HOSTING } from "@/lib/hostingOps";
import { ensureEngageTables, platformToken } from "@/lib/znbtEngage";
import { makeProofPayload, readProofPayload, verifyTonProof, type TonProofRequest } from "@/lib/zenobiaTonProof";
import { readSnapshot } from "@/lib/znbtIndex";

export const PLATFORM_FEE_BPS = 150;            // the platform's 1.5% of every trade (docs/zenobia/ZNBT-LAUNCH.md)
export const REWARD_SHARE_BPS = 2000;           // 20% of that fee is credited to the inviter
export const REWARD_DAYS = 180;                 // for this long after the invitee linked their wallet
export const GAS_ALLOWANCE_NANO = 150_000_000n; // a buy message carries gas on top of the amount: not counted
export const MIN_PAYOUT_NANO = 250_000_000n;    // 0.25 GRAM: the least that will ever be paid out in one go

let ready: Promise<void> | null = null;
export function ensureRefTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureEngageTables();
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_wallets (tg_id TEXT PRIMARY KEY, wallet TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_ref_events (event_id TEXT PRIMARY KEY, invitee TEXT NOT NULL, inviter TEXT NOT NULL, curve TEXT NOT NULL, gross_nano TEXT NOT NULL, fee_nano TEXT NOT NULL, reward_nano TEXT NOT NULL, at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS znbt_ref_events_inviter ON znbt_ref_events(inviter)`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_ref_cursor (invitee TEXT PRIMARY KEY, last_ts BIGINT NOT NULL DEFAULT 0)`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_ref_payouts (id BIGSERIAL PRIMARY KEY, inviter TEXT NOT NULL, wallet TEXT NOT NULL, amount_nano TEXT NOT NULL, status TEXT NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ---------- pure helpers (unit tested) ----------
export function rewardFor(grossNano: bigint): { fee: bigint; reward: bigint } {
  const net = grossNano > GAS_ALLOWANCE_NANO ? grossNano - GAS_ALLOWANCE_NANO : 0n;
  const fee = (net * BigInt(PLATFORM_FEE_BPS)) / 10000n;
  return { fee, reward: (fee * BigInt(REWARD_SHARE_BPS)) / 10000n };
}
export const raw = (a: string): string | null => { try { return Address.parse(a).toRawString(); } catch { return null; } };

export type Buy = { eventId: string; ts: number; curve: string; grossNano: bigint };
/** The buys of one wallet on platform coins found in tonapi events. Conservative: a buy that came straight back (a bounce) is not counted, and sells are not counted. */
export function extractBuys(events: any[], wallet: string, curves: Set<string>): Buy[] {
  const me = raw(wallet);
  if (!me) return [];
  const out: Buy[] = [];
  for (const ev of events || []) {
    if (!ev || ev.in_progress || !ev.event_id) continue;
    const sent = new Map<string, bigint>();
    const back = new Map<string, bigint>();
    for (const a of ev.actions || []) {
      if (a.status && a.status !== "ok") continue;
      if (a.type === "TonTransfer" && a.TonTransfer) {
        const s = raw(a.TonTransfer.sender?.address || ""), r = raw(a.TonTransfer.recipient?.address || "");
        const amt = BigInt(a.TonTransfer.amount ?? 0);
        if (s === me && r && curves.has(r)) sent.set(r, (sent.get(r) ?? 0n) + amt);
        if (r === me && s && curves.has(s)) back.set(s, (back.get(s) ?? 0n) + amt);
      } else if (a.type === "SmartContractExec" && a.SmartContractExec) {
        const e = raw(a.SmartContractExec.executor?.address || ""), c = raw(a.SmartContractExec.contract?.address || "");
        if (e === me && c && curves.has(c)) sent.set(c, (sent.get(c) ?? 0n) + BigInt(a.SmartContractExec.ton_attached ?? 0));
      }
    }
    for (const [curve, gross] of sent) {
      const returned = back.get(curve) ?? 0n;
      if (gross <= 0n || returned * 10n >= gross * 8n) continue;   // it came back: not a real buy
      out.push({ eventId: `${ev.event_id}:${curve.slice(-8)}`, ts: Number(ev.timestamp) || 0, curve, grossNano: gross });
    }
  }
  return out;
}

// ---------- wallet link (TonConnect ton_proof bound to the Telegram user) ----------
const siteHosts = (): string[] => {
  const hs = new Set<string>();
  for (const u of [process.env.NEXT_PUBLIC_SITE_URL, HOSTING.gateUrl, HOSTING.vercelUrl, HOSTING.oracleUrl, HOSTING.canonicalUrl]) { try { if (u) hs.add(new URL(u).host); } catch { /* ignore */ } }
  return [...hs];
};
export async function linkChallenge(tg: string): Promise<string | null> {
  const t = await platformToken();
  return t ? makeProofPayload(t, tg) : null;
}
export async function linkWallet(tg: string, req: TonProofRequest): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const t = await platformToken();
  if (!t) return { ok: false, error: "platform bot not active" };
  if (readProofPayload(t, String(req.proof?.payload || "")) !== tg) return { ok: false, error: "challenge expired" };
  let res: ReturnType<typeof verifyTonProof> = { ok: false, reason: "no domain" };
  for (const domain of siteHosts()) { res = verifyTonProof(req, { domain }); if (res.ok) break; }
  if (!res.ok) return { ok: false, error: res.reason };
  await ensureRefTables();
  const addr = Address.parse(res.address).toString({ bounceable: false, urlSafe: true });
  const taken = (await prisma.$queryRawUnsafe(`SELECT tg_id FROM znbt_wallets WHERE wallet=$1 AND tg_id<>$2`, addr, tg)) as unknown[];
  if (taken.length) return { ok: false, error: "this wallet is already linked to another account" };
  await prisma.$executeRawUnsafe(`INSERT INTO znbt_wallets (tg_id, wallet) VALUES ($1,$2) ON CONFLICT (tg_id) DO UPDATE SET wallet=EXCLUDED.wallet`, tg, addr);
  return { ok: true, address: addr };
}

// ---------- accrual: read the invitees' buys from the chain ----------
const TONAPI = "https://tonapi.io/v2";
const tonapiHeaders = (): Record<string, string> => (process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : {});
async function eventsSince(wallet: string, sinceTs: number): Promise<any[]> {
  const all: any[] = [];
  let end = Math.floor(Date.now() / 1000) + 60;
  for (let page = 0; page < 5; page++) {
    const r = await fetch(`${TONAPI}/accounts/${encodeURIComponent(wallet)}/events?limit=100&subject_only=true&start_date=${sinceTs}&end_date=${end}`, { headers: tonapiHeaders(), signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) throw new Error("tonapi " + r.status);
    const evs = ((await r.json()) as { events?: any[] }).events ?? [];
    all.push(...evs);
    if (evs.length < 100) break;
    end = Math.min(...evs.map((e) => Number(e.timestamp)));   // the next, older page
    if (end <= sinceTs) break;
  }
  return all;
}

export async function syncReferrals(maxInvitees = 25): Promise<{ invitees: number; buys: number }> {
  await ensureRefTables();
  const snap = await readSnapshot().catch(() => null);
  const curves = new Set((snap?.coins ?? []).map((c) => raw(c.curve)).filter((x): x is string => !!x));
  if (!curves.size) return { invitees: 0, buys: 0 };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT r.invitee, r.inviter, w.wallet, EXTRACT(EPOCH FROM w.linked_at)::bigint AS linked, COALESCE(c.last_ts,0)::bigint AS last_ts, wi.wallet AS inviter_wallet
     FROM znbt_referrals r JOIN znbt_wallets w ON w.tg_id=r.invitee LEFT JOIN znbt_ref_cursor c ON c.invitee=r.invitee LEFT JOIN znbt_wallets wi ON wi.tg_id=r.inviter
     WHERE w.linked_at > now() - ($1 || ' days')::interval ORDER BY COALESCE(c.last_ts,0) ASC LIMIT $2`, String(REWARD_DAYS), maxInvitees,
  )) as { invitee: string; inviter: string; wallet: string; linked: bigint; last_ts: bigint; inviter_wallet: string | null }[];
  let buys = 0;
  for (const r of rows) {
    if (r.inviter_wallet && raw(r.inviter_wallet) === raw(r.wallet)) continue;   // the same wallet on both sides earns nothing
    const since = Math.max(Number(r.last_ts), Number(r.linked));
    let evs: any[];
    try { evs = await eventsSince(r.wallet, since); } catch { continue; }
    const windowEnd = Number(r.linked) + REWARD_DAYS * 86400;
    for (const b of extractBuys(evs, r.wallet, curves)) {
      if (b.ts < Number(r.linked) || b.ts > windowEnd) continue;
      const { fee, reward } = rewardFor(b.grossNano);
      if (reward <= 0n) continue;
      const n = await prisma.$executeRawUnsafe(
        `INSERT INTO znbt_ref_events (event_id, invitee, inviter, curve, gross_nano, fee_nano, reward_nano, at) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8)) ON CONFLICT DO NOTHING`,
        b.eventId, r.invitee, r.inviter, b.curve, b.grossNano.toString(), fee.toString(), reward.toString(), b.ts,
      );
      buys += Number(n);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO znbt_ref_cursor (invitee, last_ts) VALUES ($1,$2) ON CONFLICT (invitee) DO UPDATE SET last_ts=EXCLUDED.last_ts`, r.invitee, Math.floor(Date.now() / 1000) - 120);
  }
  return { invitees: rows.length, buys };
}

export type Account = { earned: bigint; paid: bigint; pending: bigint; wallet: string | null };
export async function accountOf(inviter: string): Promise<Account> {
  await ensureRefTables();
  const e = (await prisma.$queryRawUnsafe(`SELECT reward_nano FROM znbt_ref_events WHERE inviter=$1`, inviter)) as { reward_nano: string }[];
  const p = (await prisma.$queryRawUnsafe(`SELECT amount_nano FROM znbt_ref_payouts WHERE inviter=$1 AND status IN ('sent','pending','unknown')`, inviter)) as { amount_nano: string }[];
  const w = (await prisma.$queryRawUnsafe(`SELECT wallet FROM znbt_wallets WHERE tg_id=$1`, inviter)) as { wallet: string }[];
  const earned = e.reduce((a, x) => a + BigInt(x.reward_nano), 0n);
  const paid = p.reduce((a, x) => a + BigInt(x.amount_nano), 0n);
  return { earned, paid, pending: earned - paid, wallet: w[0]?.wallet ?? null };
}
export const fmtNano = (n: bigint) => (Number(n) / 1e9).toFixed(3);

/** The owner's log (platform bot /referrals): what was credited, what is due to whom. Read-only. */
export async function ownerLog(): Promise<string> {
  await ensureRefTables();
  const sum = (await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*)::int FROM znbt_referrals) AS refs, (SELECT COUNT(*)::int FROM znbt_wallets) AS wallets, COUNT(*)::int AS buys,
            COALESCE(SUM(fee_nano::numeric),0)::text AS fees, COALESCE(SUM(reward_nano::numeric),0)::text AS rewards FROM znbt_ref_events`,
  )) as { refs: number; wallets: number; buys: number; fees: string; rewards: string }[];
  const who = (await prisma.$queryRawUnsafe(`SELECT inviter FROM znbt_ref_events GROUP BY inviter ORDER BY SUM(reward_nano::numeric) DESC LIMIT 15`)) as { inviter: string }[];
  const lines: string[] = [];
  let due = 0n;
  for (const { inviter } of who) {
    const a = await accountOf(inviter);
    if (a.pending > 0n) { due += a.pending; lines.push(`• ${inviter}: ${fmtNano(a.pending)} GRAM${a.wallet ? "" : " (no wallet linked)"}`); }
  }
  const f = (s: string) => fmtNano(BigInt(s.split(".")[0]));
  const s = sum[0];
  return [
    "🪙 Invite rewards · مكافآت الدعوات",
    `Invites: ${s.refs} · linked wallets: ${s.wallets}`,
    `Buys credited: ${s.buys} · platform fees behind them: ${f(s.fees)} GRAM`,
    `Rewards credited: ${f(s.rewards)} GRAM (20% of those fees) · due now: ${fmtNano(due)} GRAM`,
    ...(lines.length ? ["", "Due:", ...lines] : []),
    "",
    "Payouts are not switched on: nothing is sent automatically.",
  ].join("\n");
}
