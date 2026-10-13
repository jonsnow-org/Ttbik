// Athar owner tools: wallet balance and "someone minted" alerts, read straight from the TON chain
// (Toncenter, public data only). The management wallet's public address is not a secret; it is the
// same address the sale contracts pay into (ATHAR_ADMIN, also written in docs/ATHAR_OPS_NOTES.md).
// Nothing here can move money: it only reads.

import { Address } from "@ton/core";

const FALLBACK_ADMIN = "EQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQMl2";
export const adminWallet = (): string => (process.env.ATHAR_ADMIN || process.env.NEXT_PUBLIC_ATHAR_ADMIN || FALLBACK_ADMIN).trim();

// Not Athar sales: the owner's wallet also receives the Zenobia proceeds from the ledger wallet (and refunds); those must not look like Athar payments.
const NOT_ATHAR_SENDERS = ["0:9eb094e339a542fdcae8bd2800bd3adb4fa9fbeceaa4b694ab46c7bf4cfeac91"]; // the Zenobia ledger wallet
const rawOf = (a: string): string => {
  try { return Address.parse(a).toRawString().toLowerCase(); } catch { return a.toLowerCase(); }
};
export const isAtharSender = (from: string): boolean => !NOT_ATHAR_SENDERS.includes(rawOf(from));

const V3 = "https://toncenter.com/api/v3";
const STATE_KEY = "athar_mint_watch";
const MIN_NANO = BigInt(50_000_000); // ignore dust below 0.05 TON
const TZ_OFFSET_MS = 3 * 3600_000; // days are counted in Istanbul time, like the rest of the owner's tools

const headers = (): Record<string, string> => (process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {});

export type Incoming = { hash: string; lt: string; at: number; from: string; nano: bigint };

export const tons = (nano: bigint | number): string => (Number(nano) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3, minimumFractionDigits: 2 });
export const dayKey = (ms: number): string => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${V3}${path}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Wallet balance in nanoTON, or null when the chain API does not answer. */
export async function fetchBalance(): Promise<bigint | null> {
  const d = await getJson<{ balance?: string }>(`/addressInformation?address=${encodeURIComponent(adminWallet())}&use_v2=false`);
  return d?.balance ? BigInt(d.balance) : null;
}

/** Latest successful incoming payments (newest first), or null when the chain API does not answer. */
export async function fetchIncoming(limit = 40): Promise<Incoming[] | null> {
  const d = await getJson<{ transactions?: { hash: string; lt: string; now: number; description?: { aborted?: boolean }; in_msg?: { source?: string | null; value?: string | null } | null }[] }>(
    `/transactions?account=${encodeURIComponent(adminWallet())}&limit=${limit}&sort=desc`,
  );
  if (!d?.transactions) return null;
  const out: Incoming[] = [];
  for (const t of d.transactions) {
    const m = t.in_msg;
    if (!m?.source || !m.value || t.description?.aborted) continue;
    const nano = BigInt(m.value);
    if (nano < MIN_NANO) continue;
    if (!isAtharSender(m.source)) continue;
    out.push({ hash: t.hash, lt: t.lt, at: t.now * 1000, from: m.source, nano });
  }
  return out;
}

type DayTotals = Record<string, { n: number; nano: string }>;
export type WatchState = { lastLt: string; alerts: boolean; days: DayTotals; total: number; baselineAt: string };

const emptyState = (): WatchState => ({ lastLt: "", alerts: true, days: {}, total: 0, baselineAt: "" });

async function db() {
  const { supabaseAdmin } = await import("@/lib/supabase");
  return supabaseAdmin();
}

export async function loadWatch(): Promise<WatchState> {
  try {
    const { data } = await (await db()).from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = ((data as { value?: Partial<WatchState> } | null)?.value || {}) as Partial<WatchState>;
    return { lastLt: v.lastLt || "", alerts: v.alerts !== false, days: v.days || {}, total: v.total || 0, baselineAt: v.baselineAt || "" };
  } catch {
    return emptyState();
  }
}

export async function saveWatch(s: WatchState): Promise<void> {
  const keep = Object.keys(s.days).sort().slice(-45);
  const days: DayTotals = {};
  for (const k of keep) days[k] = s.days[k];
  await (await db()).from("bot_settings").upsert({ key: STATE_KEY, value: { ...s, days }, updated_at: new Date().toISOString() });
}

export async function setAlerts(on: boolean): Promise<void> {
  const s = await loadWatch();
  s.alerts = on;
  await saveWatch(s);
}

export const daySummary = (s: WatchState, key: string) => ({ n: s.days[key]?.n || 0, nano: BigInt(s.days[key]?.nano || "0") });
export function weekSummary(s: WatchState, now = Date.now()) {
  let n = 0;
  let nano = BigInt(0);
  for (let i = 0; i < 7; i++) {
    const d = daySummary(s, dayKey(now - i * 86400_000));
    n += d.n;
    nano += d.nano;
  }
  return { n, nano };
}

export type WatchResult = { ok: boolean; fresh: Incoming[]; balance: bigint | null; baseline?: boolean };

/**
 * Looks for payments newer than the last one seen. The first run only records a baseline
 * (so the owner is not flooded with history). Returns the new payments; the caller sends the alerts.
 */
export async function checkPayments(): Promise<WatchResult> {
  const [list, balance, state] = await Promise.all([fetchIncoming(), fetchBalance(), loadWatch()]);
  if (!list) return { ok: false, fresh: [], balance };
  const newest = list.reduce((m, x) => (BigInt(x.lt) > m ? BigInt(x.lt) : m), BigInt(state.lastLt || "0"));
  if (!state.lastLt) {
    // baseline: count what already happened today so "today" is right from the first look, but do not alert
    for (const x of list) {
      const k = dayKey(x.at);
      const cur = daySummary(state, k);
      state.days[k] = { n: cur.n + 1, nano: (cur.nano + x.nano).toString() };
    }
    state.lastLt = newest.toString();
    state.baselineAt = new Date().toISOString();
    await saveWatch(state).catch(() => null);
    return { ok: true, fresh: [], balance, baseline: true };
  }
  const fresh = list.filter((x) => BigInt(x.lt) > BigInt(state.lastLt)).sort((a, b) => (BigInt(a.lt) < BigInt(b.lt) ? -1 : 1));
  for (const x of fresh) {
    const k = dayKey(x.at);
    const cur = daySummary(state, k);
    state.days[k] = { n: cur.n + 1, nano: (cur.nano + x.nano).toString() };
    state.total += 1;
  }
  if (fresh.length) {
    state.lastLt = newest.toString();
    await saveWatch(state).catch(() => null);
  }
  return { ok: true, fresh, balance };
}

export const txLink = (hash: string) => `https://tonviewer.com/transaction/${encodeURIComponent(hash)}`;
export const walletLink = () => `https://tonviewer.com/${adminWallet()}`;
