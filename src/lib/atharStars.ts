// Athar paid with Telegram Stars (phase A of docs/FOR_ATHAR_CREATOR_REVIEW_stars_payments.md): a person pays in the Athar bot, the order waits
// in a queue, the owner signs the AdminMint in the Athar admin panel, and the token reaches the recipient address. Only normal, silver and gold.
// Everything is behind ATHAR_ENABLE_STARS=1 (off by default) and lives only in the Athar bot and the owner's admin page: no ZNBt page mentions it.
// Own tables, created on first use. Nothing here touches the contracts, the crypto payment path or any existing table.
import { Address } from "@ton/core";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { parseBirthday } from "@/lib/atharBirthday";
import { indexOf, ymd, TOTAL_DATES } from "../../athar/lib/rules";

export const TIERS = ["normal", "silver", "gold"] as const;
export type Tier = (typeof TIERS)[number];
export const PENDING_MINUTES = 15;
export const REVIEW_MINUTES = 30;
export const UNMINTED_DAYS = 7;
const DEFAULT_PRICES: Record<Tier, number> = { normal: 250, silver: 750, gold: 2000 };

export type Status = "pending" | "paid" | "minting" | "minted" | "refund_pending" | "refunded" | "expired" | "failed";
export type Order = {
  id: string; bot_id: string; tg_user_id: string; date_index: number; tier: Tier; stars_amount: number; recipient_address: string; status: Status;
  telegram_payment_charge_id: string | null; mint_tx_hash: string | null; mint_claimed_by: string | null; mint_claimed_at: Date | null;
  created_at: Date; paid_at: Date | null; minted_at: Date | null; refunded_at: Date | null; last_error: string | null;
};

export const starsEnabled = () => process.env.ATHAR_ENABLE_STARS === "1";

/** Prices come from the server only: "250,750,2000" (normal, silver, gold) or {"normal":..,"silver":..,"gold":..}. Anything odd falls back to the defaults. */
export function starsPrices(raw = process.env.ATHAR_STARS_PRICES): Record<Tier, number> {
  if (!raw) return { ...DEFAULT_PRICES };
  try {
    const v: unknown = raw.trim().startsWith("{") ? JSON.parse(raw) : raw.split(",").map((x) => Number(x.trim()));
    const get = (i: number, k: Tier) => (Array.isArray(v) ? (v as number[])[i] : (v as Record<string, number>)[k]);
    const out = {} as Record<Tier, number>;
    for (let i = 0; i < 3; i++) {
      const n = Number(get(i, TIERS[i]));
      if (!Number.isInteger(n) || n < 1 || n > 100000) return { ...DEFAULT_PRICES };
      out[TIERS[i]] = n;
    }
    return out;
  } catch { return { ...DEFAULT_PRICES }; }
}

/** "14/3/2003" -> the day number of that date (1950-2049), or null. A year is required: this is the date of the token. */
export function parseDateIndex(input: string): number | null {
  const b = parseBirthday(input);
  if (!b || b.year === null) return null;
  const i = indexOf(b.year, b.month, b.day);
  return Number.isInteger(i) && i >= 0 && i < TOTAL_DATES ? i : null;
}
export function dateText(index: number): string { const d = ymd(index); return `${d.d}/${d.m}/${d.y}`; }

/** A TON address in the form Tonkeeper shows (non-bounceable), or null. */
export function parseRecipient(input: string): string | null {
  const t = input.trim();
  if (!/^[A-Za-z0-9_\-:+/=]{40,70}$/.test(t)) return null;
  try { return Address.parse(t).toString({ bounceable: false, urlSafe: true }); } catch { return null; }
}

// ---------- storage ----------
let ready: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS athar_star_orders (
          id text PRIMARY KEY,
          idempotency_key text NOT NULL UNIQUE,
          bot_id text NOT NULL,
          tg_user_id bigint NOT NULL,
          date_index int NOT NULL CHECK (date_index BETWEEN 0 AND 36524),
          tier text NOT NULL CHECK (tier IN ('normal','silver','gold')),
          stars_amount int NOT NULL CHECK (stars_amount > 0),
          recipient_address text NOT NULL,
          status text NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','paid','minting','minted','refund_pending','refunded','expired','failed')),
          telegram_payment_charge_id text UNIQUE,
          mint_tx_hash text,
          mint_claimed_by text,
          mint_claimed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          paid_at timestamptz,
          minted_at timestamptz,
          refunded_at timestamptz,
          last_error text
        )`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS athar_star_orders_live_date ON athar_star_orders(date_index) WHERE status IN ('pending','paid','minting','minted')`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS athar_date_locks (date_index int PRIMARY KEY, holder text NOT NULL, expires_at timestamptz NOT NULL)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const COLS = `id, bot_id, tg_user_id::text as tg_user_id, date_index, tier, stars_amount, recipient_address, status, telegram_payment_charge_id, mint_tx_hash, mint_claimed_by, mint_claimed_at, created_at, paid_at, minted_at, refunded_at, last_error`;
async function q<T>(sql: string, ...a: unknown[]): Promise<T[]> { return (await prisma.$queryRawUnsafe(sql, ...a)) as T[]; }
async function x(sql: string, ...a: unknown[]): Promise<number> { return Number(await prisma.$executeRawUnsafe(sql, ...a)); }
export async function getOrder(id: string): Promise<Order | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await q<Order>(`select ${COLS} from athar_star_orders where id=$1`, id))[0] ?? null;
}

// ---------- the chain ----------
export const kindIndex = (t: Tier) => TIERS.indexOf(t);
/** Is this kind of this date already minted? null = could not find out (callers must then refuse to sell / mint, never guess). */
export async function isTaken(site: string, dateIndex: number, tier: Tier, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const r = await fetcher(`${site}/api/date/${dateIndex}`, { cache: "no-store", signal: AbortSignal.timeout(4500) });
    const j: any = await r.json();
    if (!r.ok || !j.onChain || !Array.isArray(j.taken)) return null;
    if (j.auction?.[kindIndex(tier)] || j.reserved?.[kindIndex(tier)]) return true;   // not for sale here: it is in an auction or a mystery box
    return !!j.taken[kindIndex(tier)];
  } catch { return null; }
}

// ---------- the date lock shared with the crypto path ----------
/** True when this holder now holds the date (it was free, expired, or already this holder's). */
export async function takeLock(dateIndex: number, holder: string, ttlSeconds: number): Promise<boolean> {
  const n = await x(
    `insert into athar_date_locks (date_index, holder, expires_at) values ($1,$2, now() + make_interval(secs => $3::double precision))
     on conflict (date_index) do update set holder=excluded.holder, expires_at=excluded.expires_at
     where athar_date_locks.expires_at < now() or athar_date_locks.holder = excluded.holder`, dateIndex, holder, ttlSeconds);
  return n > 0;
}
export async function extendLock(dateIndex: number, holder: string, forever: boolean): Promise<void> {
  await x(`update athar_date_locks set expires_at = ${forever ? "'infinity'::timestamptz" : "now() + interval '7 days'"} where date_index=$1 and holder=$2`, dateIndex, holder);
}
export async function releaseLock(dateIndex: number, holder: string): Promise<void> { await x(`delete from athar_date_locks where date_index=$1 and holder=$2`, dateIndex, holder); }
export async function lockedByStars(dateIndex: number): Promise<boolean> {
  try { return (await q(`select 1 from athar_date_locks where date_index=$1 and holder like 'stars:%' and expires_at > now()`, dateIndex)).length > 0; } catch { return false; }
}

// ---------- creating an order ----------
export type Created = { ok: true; order: Order } | { ok: false; reason: "off" | "taken" | "busy" | "unknown" | "address" | "date" };
export async function createOrder(botId: string, tgUserId: string, dateIndex: number, tier: Tier, recipientRaw: string, site: string): Promise<Created> {
  if (!starsEnabled()) return { ok: false, reason: "off" };
  const recipient = parseRecipient(recipientRaw);
  if (!recipient) return { ok: false, reason: "address" };
  if (!Number.isInteger(dateIndex) || dateIndex < 0 || dateIndex >= TOTAL_DATES) return { ok: false, reason: "date" };
  await ensureTables();
  const taken = await isTaken(site, dateIndex, tier);
  if (taken === null) return { ok: false, reason: "unknown" };
  if (taken) return { ok: false, reason: "taken" };
  const id = randomUUID(), holder = `stars:${id}`;
  if (!(await takeLock(dateIndex, holder, PENDING_MINUTES * 60))) return { ok: false, reason: "busy" };
  try {
    await x(`insert into athar_star_orders (id, idempotency_key, bot_id, tg_user_id, date_index, tier, stars_amount, recipient_address) values ($1,$2,$3,$4::bigint,$5,$6,$7,$8)`,
      id, `stars:${id}`, botId, tgUserId, dateIndex, tier, starsPrices()[tier], recipient);
  } catch { await releaseLock(dateIndex, holder).catch(() => null); return { ok: false, reason: "busy" }; }
  return { ok: true, order: (await getOrder(id))! };
}

// ---------- pre_checkout_query (answer within 10 seconds) ----------
export type PreCheckout = { ok: true } | { ok: false; message: string };
/** The pure decision: every condition of the spec, with the facts passed in. The payload carries only the order id, never a price. */
export function decidePreCheckout(o: { enabled: boolean; order: Order | null; fromId: string; total: number; currency: string; lockHeld: boolean; taken: boolean | null }): PreCheckout {
  if (!o.enabled) return { ok: false, message: "Paying with Stars is not available now. | الدفع بالنجوم غير متاح الآن." };
  if (!o.order || o.order.status !== "pending") return { ok: false, message: "This order is no longer open. Please start again. | هذا الطلب لم يعد مفتوحاً، ابدأ من جديد." };
  if (o.currency !== "XTR") return { ok: false, message: "Only Telegram Stars are accepted. | النجوم فقط." };
  if (o.order.tg_user_id !== o.fromId) return { ok: false, message: "This order belongs to another account. | هذا الطلب لحساب آخر." };
  if (o.total !== o.order.stars_amount) return { ok: false, message: "The price changed. Please start again. | تغيّر السعر، ابدأ من جديد." };
  if (!o.lockHeld) return { ok: false, message: "The reservation expired. Please start again. | انتهى الحجز، ابدأ من جديد." };
  if (o.taken !== false) return { ok: false, message: "This date was just taken or cannot be checked now. | هذا التاريخ مسكوك الآن أو تعذّر التحقق منه." };
  return { ok: true };
}
export async function preCheckout(query: { from?: { id?: number | string }; invoice_payload?: string; total_amount?: number; currency?: string }, site: string): Promise<PreCheckout> {
  if (!starsEnabled()) return decidePreCheckout({ enabled: false, order: null, fromId: "", total: 0, currency: "", lockHeld: false, taken: null });
  try {
    await ensureTables();
    const order = await getOrder(String(query.invoice_payload || ""));
    const held = order ? (await q(`select 1 from athar_date_locks where date_index=$1 and holder=$2 and expires_at > now()`, order.date_index, `stars:${order.id}`)).length > 0 : false;
    const taken = order ? await isTaken(site, order.date_index, order.tier) : null;
    return decidePreCheckout({ enabled: true, order, fromId: String(query.from?.id ?? ""), total: Number(query.total_amount), currency: String(query.currency || ""), lockHeld: held, taken });
  } catch { return { ok: false, message: "Please try again in a moment. | حاول بعد قليل." }; }
}
/** Is this invoice payload one of ours (an Athar order id)? Used so the shared handler never approves an Athar invoice blindly. */
export const isOrderPayload = (p: unknown) => typeof p === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p);

// ---------- successful_payment ----------
export type Paid = { kind: "paid"; order: Order } | { kind: "duplicate" } | { kind: "late"; order: Order | null } | { kind: "error" };
export async function onSuccessfulPayment(p: { invoice_payload?: string; telegram_payment_charge_id?: string; total_amount?: number }): Promise<Paid> {
  const id = String(p.invoice_payload || ""), charge = String(p.telegram_payment_charge_id || "");
  if (!isOrderPayload(id) || !charge) return { kind: "error" };
  try {
    await ensureTables();
    const n = await x(`update athar_star_orders set status='paid', telegram_payment_charge_id=$2, paid_at=now() where id=$1 and status='pending'`, id, charge);
    const order = await getOrder(id);
    if (n > 0 && order) { await extendLock(order.date_index, `stars:${id}`, true); return { kind: "paid", order }; }
    if (order && order.telegram_payment_charge_id === charge) return { kind: "duplicate" };
    // money arrived for an order that is not open any more (it expired while the person was paying): keep the charge, give the money back
    if (order && order.status === "expired" && !order.telegram_payment_charge_id) {
      await x(`update athar_star_orders set status='refund_pending', telegram_payment_charge_id=$2, paid_at=now(), last_error='paid after expiry' where id=$1 and status='expired'`, id, charge);
      return { kind: "late", order: await getOrder(id) };
    }
    return { kind: "late", order };
  } catch (e) { console.error("[athar-stars] successful_payment", e); return { kind: "error" }; }
}

// ---------- refund ----------
type RefundApi = { refundStarPayment: (userId: number, chargeId: string) => Promise<unknown> };
/** Refund an order: only paid / refund_pending (minting only when the caller has confirmed the token is not minted). Never after minted. */
export async function refundOrder(api: RefundApi, id: string, opts: { fromMinting?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const allowed = opts.fromMinting ? `('paid','refund_pending','minting')` : `('paid','refund_pending')`;
  const o = await getOrder(id);
  if (!o || !o.telegram_payment_charge_id) return { ok: false, error: "no paid order" };
  if (o.status === "minted" || o.status === "refunded") return { ok: false, error: `order is ${o.status}` };
  // claim the refund so two callers cannot both send it
  const n = await x(`update athar_star_orders set status='refund_pending', last_error=null where id=$1 and status in ${allowed}`, id);
  if (n < 1) return { ok: false, error: `order is ${o.status}` };
  try {
    await api.refundStarPayment(Number(o.tg_user_id), o.telegram_payment_charge_id);
  } catch (e: any) {
    const msg = String(e?.description || e?.message || e).slice(0, 300);
    if (!/CHARGE_ALREADY_REFUNDED/i.test(msg)) { await x(`update athar_star_orders set last_error=$2 where id=$1`, id, msg); return { ok: false, error: msg }; }
  }
  await x(`update athar_star_orders set status='refunded', refunded_at=now() where id=$1 and status='refund_pending'`, id);
  await releaseLock(o.date_index, `stars:${id}`);
  return { ok: true };
}

// ---------- the owner's queue ----------
export async function listQueue(): Promise<(Order & { needs_review: boolean })[]> {
  await ensureTables();
  const rows = await q<Order>(`select ${COLS} from athar_star_orders where status in ('paid','minting','refund_pending') or (status in ('minted','refunded','failed') and created_at > now() - interval '30 days') order by paid_at asc nulls last, created_at asc limit 200`);
  const now = Date.now();
  return rows.map((r) => ({ ...r, needs_review: r.status === "minting" && !r.mint_tx_hash && !!r.mint_claimed_at && now - new Date(r.mint_claimed_at).getTime() > REVIEW_MINUTES * 60_000 }));
}
/** Atomic claim for signing: only one admin gets it. */
export async function claimOrder(id: string, admin: string): Promise<Order | null> {
  await ensureTables();
  const n = await x(`update athar_star_orders set status='minting', mint_claimed_by=$2, mint_claimed_at=now() where id=$1 and status='paid'`, id, admin);
  return n > 0 ? getOrder(id) : null;
}
/** The owner decided that a stuck mint should be tried again (after looking at the chain). */
export async function retryOrder(id: string): Promise<boolean> {
  await ensureTables();
  return (await x(`update athar_star_orders set status='paid', mint_claimed_by=null, mint_claimed_at=null, last_error=null where id=$1 and status='minting'`, id)) > 0;
}
export async function setMintTx(id: string, hash: string): Promise<boolean> {
  if (!/^[0-9a-fA-F]{64}$/.test(hash) && !/^[A-Za-z0-9_\-+/=]{40,64}$/.test(hash)) return false;
  return (await x(`update athar_star_orders set mint_tx_hash=$2 where id=$1 and status='minting'`, id, hash)) > 0;
}

// ---------- the scheduled sweep ----------
export type Sweep = { expired: number; flagged: number; minted: number; refunded: number; notify: { order: Order; what: "minted" | "refunded" }[] };
export async function sweep(apiFor: (botId: string) => RefundApi | null, site: string): Promise<Sweep> {
  await ensureTables();
  const out: Sweep = { expired: 0, flagged: 0, minted: 0, refunded: 0, notify: [] };
  // unpaid for more than 15 minutes: expired, the date is free again
  const exp = await q<Order>(`update athar_star_orders set status='expired' where status='pending' and created_at < now() - make_interval(mins => $1::int) returning ${COLS}`, PENDING_MINUTES);
  for (const o of exp) await releaseLock(o.date_index, `stars:${o.id}`);
  out.expired = exp.length;
  await x(`delete from athar_date_locks where expires_at < now() - interval '1 day'`);
  // paid but not minted for 7 days: back to the person
  out.flagged = await x(`update athar_star_orders set status='refund_pending', last_error='not minted within ${UNMINTED_DAYS} days' where status='paid' and paid_at < now() - make_interval(days => $1::int)`, UNMINTED_DAYS);
  // a claimed order whose token now exists on the chain is minted (to be exact: the kind of that date is taken after we claimed it)
  for (const o of await q<Order>(`select ${COLS} from athar_star_orders where status='minting' limit 50`)) {
    if ((await isTaken(site, o.date_index, o.tier)) === true && (await x(`update athar_star_orders set status='minted', minted_at=now() where id=$1 and status='minting'`, o.id)) > 0) {
      out.minted++; out.notify.push({ order: o, what: "minted" });
    }
  }
  // refund_pending with no mint attempt (nothing was signed): give the money back automatically
  for (const o of await q<Order>(`select ${COLS} from athar_star_orders where status='refund_pending' and mint_tx_hash is null and telegram_payment_charge_id is not null limit 20`)) {
    const api = apiFor(o.bot_id);
    if (!api) continue;
    const r = await refundOrder(api, o.id);
    if (r.ok) { out.refunded++; out.notify.push({ order: o, what: "refunded" }); }
  }
  return out;
}
