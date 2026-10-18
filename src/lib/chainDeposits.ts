// Deposits on chains where we only HAVE a receive address (no memo field, no keys here):
// USDT on TRON (TRC20), TRX and DOGE.
//
// A transfer carries no user identity, and a transaction hash is public (anyone watching our
// address could claim someone else's hash), so attribution works the other way round: each
// deposit REQUEST gets its own exact amount (the requested value plus a tiny random suffix, unique
// among open requests). The user sends exactly that amount, presses "check", and we credit the
// request whose exact amount arrived on-chain, confirmed, after the request was created.
// Idempotent: a request is claimed OPEN -> PAID in the same database transaction as the credit,
// and the on-chain hash is unique.
import { prisma } from "@/lib/prisma";

export type Chain = "USDT_TRC20" | "TRX" | "DOGE";
export const CHAINS: Chain[] = ["USDT_TRC20", "TRX", "DOGE"];
export const CHAIN_LABEL: Record<Chain, string> = { USDT_TRC20: "USDT (شبكة TRON / TRC20)", TRX: "TRX (شبكة TRON)", DOGE: "DOGE (Dogecoin)" };
export const CHAIN_ASSET: Record<Chain, string> = { USDT_TRC20: "USDT", TRX: "TRX", DOGE: "DOGE" };

export const MIN_USD = 5;
export const MAX_USD = 200;
export const REQUEST_TTL_MIN = 90;
export const MAX_OPEN_PER_USER = 3;

const DECIMALS: Record<Chain, number> = { USDT_TRC20: 6, TRX: 6, DOGE: 8 };
// requested value is rounded to this step (in atomic units); the suffix stays below one step.
const STEP: Record<Chain, number> = { USDT_TRC20: 10_000, TRX: 10_000, DOGE: 1_000_000 };
const SUFFIX_MAX: Record<Chain, number> = { USDT_TRC20: 9_999, TRX: 9_999, DOGE: 99_999 };
const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export function receiveAddress(chain: Chain): string | null {
  if (chain === "DOGE") {
    const a = (process.env.DEPOSIT_DOGE_ADDRESS || "").trim();
    return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a) ? a : null;
  }
  const a = (process.env.DEPOSIT_TRON_ADDRESS || process.env.USDT_ADDRESS || "").trim();
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) ? a : null;
}
export function availableChains(): Chain[] {
  return CHAINS.filter((c) => receiveAddress(c));
}

/** Atomic units to ask for: the USD value (at `rate` USD per coin; 1 for USDT) rounded to the step, plus a random suffix. */
export function deriveAtomic(chain: Chain, usd: number, rate: number, rand: () => number = Math.random): number {
  const unit = 10 ** DECIMALS[chain];
  const coins = chain === "USDT_TRC20" ? usd : usd / rate;
  const base = Math.max(1, Math.round((coins * unit) / STEP[chain])) * STEP[chain];
  return base + 1 + Math.floor(rand() * SUFFIX_MAX[chain]);
}
export function formatAtomic(chain: Chain, atomic: number): string {
  const d = DECIMALS[chain];
  const s = String(atomic).padStart(d + 1, "0");
  return `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`;
}

export type Transfer = { hash: string; atomic: number; tsMs: number };
export type OpenRequest = { id: string; chain: Chain; atomic: number; createdMs: number };
/** The on-chain transfer paying a request: exact amount, not before the request (2 min clock slack). */
export function findPayment(req: OpenRequest, transfers: Transfer[], usedHashes: Set<string>): Transfer | null {
  return transfers.find((t) => t.atomic === req.atomic && t.tsMs >= req.createdMs - 120_000 && !usedHashes.has(t.hash)) ?? null;
}

// ---- prices (two public sources; one is enough, none = no request) ----
async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function usdPerCoin(chain: Chain): Promise<number> {
  if (chain === "USDT_TRC20") return 1;
  const id = chain === "TRX" ? "tron" : "dogecoin";
  const paprika = chain === "TRX" ? "trx-tron" : "doge-dogecoin";
  const [a, b] = await Promise.all([
    getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`).then((d) => Number(d?.[id]?.usd)),
    getJson(`https://api.coinpaprika.com/v1/tickers/${paprika}`).then((d) => Number(d?.quotes?.USD?.price)),
  ]);
  const ok = [a, b].filter((x) => Number.isFinite(x) && x > 0);
  if (ok.length === 2 && Math.abs(ok[0] - ok[1]) / Math.max(ok[0], ok[1]) > 0.1) throw new Error("price sources disagree");
  if (ok.length === 0) throw new Error("price unavailable");
  return ok.reduce((s, x) => s + x, 0) / ok.length;
}

// ---- chain readers (public explorers, read only) ----
async function tronUsdt(address: string): Promise<Transfer[]> {
  const d = await getJson(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_confirmed=true&only_to=true&limit=200&contract_address=${USDT_TRC20_CONTRACT}`);
  const list: any[] = Array.isArray(d?.data) ? d.data : [];
  return list.filter((t) => t?.to === address && t?.token_info?.address === USDT_TRC20_CONTRACT).map((t) => ({ hash: String(t.transaction_id), atomic: Number(t.value), tsMs: Number(t.block_timestamp) }));
}
async function tronTrx(address: string): Promise<Transfer[]> {
  const d = await getJson(`https://api.trongrid.io/v1/accounts/${address}/transactions?only_confirmed=true&only_to=true&limit=200`);
  const list: any[] = Array.isArray(d?.data) ? d.data : [];
  return list
    .filter((t) => t?.ret?.[0]?.contractRet === "SUCCESS" && t?.raw_data?.contract?.[0]?.type === "TransferContract")
    .map((t) => ({ hash: String(t.txID), atomic: Number(t.raw_data.contract[0].parameter.value.amount), tsMs: Number(t.block_timestamp) }));
}
async function dogeIncoming(address: string): Promise<Transfer[]> {
  const d = await getJson(`https://api.blockcypher.com/v1/doge/main/addrs/${address}?limit=200`);
  const refs: any[] = Array.isArray(d?.txrefs) ? d.txrefs : [];
  // received outputs only (tx_input_n = -1), at least 3 confirmations
  return refs.filter((r) => r?.tx_input_n === -1 && Number(r?.confirmations) >= 3).map((r) => ({ hash: String(r.tx_hash), atomic: Number(r.value), tsMs: Date.parse(String(r.confirmed || r.received)) }));
}
async function incoming(chain: Chain, address: string): Promise<Transfer[] | null> {
  try {
    return chain === "USDT_TRC20" ? await tronUsdt(address) : chain === "TRX" ? await tronTrx(address) : await dogeIncoming(address);
  } catch {
    return null;
  }
}

// ---- storage ----
let ready = false;
async function ensureTables() {
  if (ready) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS chain_deposit_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, chain text NOT NULL, atomic bigint NOT NULL, usd double precision NOT NULL, address text NOT NULL, status text NOT NULL DEFAULT 'OPEN', tx_hash text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, paid_at timestamptz)`
  );
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS chain_deposit_open_amount ON chain_deposit_requests (chain, atomic) WHERE status = 'OPEN'`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS chain_deposit_hash ON chain_deposit_requests (tx_hash) WHERE tx_hash IS NOT NULL`);
  ready = true;
}

export type NewRequest = { ok: true; id: string; address: string; amount: string; asset: string; usd: number; expiresInMin: number } | { ok: false; reason: "no_address" | "range" | "too_many" | "price" | "busy" };

export async function createDepositRequest(userId: string, chain: Chain, usd: number): Promise<NewRequest> {
  const address = receiveAddress(chain);
  if (!address) return { ok: false, reason: "no_address" };
  if (!Number.isFinite(usd) || usd < MIN_USD || usd > MAX_USD) return { ok: false, reason: "range" };
  await ensureTables();
  await prisma.$executeRaw`UPDATE chain_deposit_requests SET status = 'EXPIRED' WHERE status = 'OPEN' AND expires_at < now() - interval '30 minutes'`;
  const open = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM chain_deposit_requests WHERE user_id = ${userId} AND status = 'OPEN'`;
  if (Number(open[0]?.n || 0) >= MAX_OPEN_PER_USER) return { ok: false, reason: "too_many" };
  let rate: number;
  try {
    rate = await usdPerCoin(chain);
  } catch {
    return { ok: false, reason: "price" };
  }
  const usdRounded = Math.round(usd * 100) / 100;
  for (let i = 0; i < 6; i++) {
    const atomic = deriveAtomic(chain, usdRounded, rate);
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`INSERT INTO chain_deposit_requests (user_id, chain, atomic, usd, address, expires_at) VALUES (${userId}, ${chain}, ${atomic}, ${usdRounded}, ${address}, now() + make_interval(mins => ${REQUEST_TTL_MIN}::int)) RETURNING id`;
      return { ok: true, id: rows[0].id, address, amount: formatAtomic(chain, atomic), asset: CHAIN_ASSET[chain], usd: usdRounded, expiresInMin: REQUEST_TTL_MIN };
    } catch {
      // the exact amount is already taken by another open request: draw another suffix
    }
  }
  return { ok: false, reason: "busy" };
}

export type Applier = (tx: any, p: { userId: string; usd: number; chain: Chain; hash: string }) => Promise<unknown>;
export type CheckResult = { credited: { usd: number; chain: Chain; hash: string }[]; pending: number; readFailed: boolean };

/** Looks for this user's open requests on-chain and credits the ones that were paid (exact amount). */
export async function checkUserDeposits(userId: string, apply: Applier): Promise<CheckResult> {
  await ensureTables();
  await prisma.$executeRaw`UPDATE chain_deposit_requests SET status = 'EXPIRED' WHERE status = 'OPEN' AND expires_at < now() - interval '30 minutes'`;
  // a little grace after expiry: a payment sent just before the deadline can still confirm late
  const rows = await prisma.$queryRaw<{ id: string; chain: string; atomic: bigint; usd: number; address: string; created_at: Date }[]>`
    SELECT id, chain, atomic, usd, address, created_at FROM chain_deposit_requests WHERE user_id = ${userId} AND status = 'OPEN'`;
  const out: CheckResult = { credited: [], pending: 0, readFailed: false };
  const used = new Set<string>((await prisma.$queryRaw<{ tx_hash: string }[]>`SELECT tx_hash FROM chain_deposit_requests WHERE tx_hash IS NOT NULL`).map((r) => r.tx_hash));
  const cache = new Map<string, Transfer[] | null>();
  for (const r of rows) {
    const chain = r.chain as Chain;
    const key = `${chain}:${r.address}`;
    if (!cache.has(key)) cache.set(key, await incoming(chain, r.address));
    const transfers = cache.get(key);
    if (!transfers) {
      out.readFailed = true;
      out.pending++;
      continue;
    }
    const hit = findPayment({ id: r.id, chain, atomic: Number(r.atomic), createdMs: r.created_at.getTime() }, transfers, used);
    if (!hit) {
      out.pending++;
      continue;
    }
    const done = await prisma
      .$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`UPDATE chain_deposit_requests SET status = 'PAID', tx_hash = ${hit.hash}, paid_at = now() WHERE id = ${r.id}::uuid AND status = 'OPEN'`;
        if (claimed !== 1) return false;
        await apply(tx, { userId, usd: r.usd, chain, hash: hit.hash });
        return true;
      })
      .catch(() => false);
    if (done) {
      used.add(hit.hash);
      out.credited.push({ usd: r.usd, chain, hash: hit.hash });
    } else out.pending++;
  }
  return out;
}
