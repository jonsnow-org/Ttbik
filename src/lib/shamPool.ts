import { pressureOn } from "@/lib/pressureMode";
// Sham v2's Studio pool: dedicated primary endpoint(s) plus an optional, separately named overflow endpoint.
// Overflow is never allowed to use Nova or Sham v1 endpoints. A real endpoint status check also confirms the Sham v2 checkpoint before use.
//
// Congestion signals (per process, kept in memory; Oracle is long-lived so they are meaningful there):
//   - in flight: the primary already holds >= SHAM_V2_PRIMARY_MAX_INFLIGHT calls (default 1: a CPU Studio answers one at a time, the rest queue behind it)
//   - latency:   the primary's recent answers average over SHAM_V2_SLOW_MS (default 30000)
//   - failure:   the primary was busy / refused / unreachable in the last SHAM_V2_COOLDOWN_MS (default 60000)
// The same three apply to the overflow, which is then used only as the last choice.

export const DEFAULT_V2_OVERFLOW_URL = "https://studio-novaai2026-sham-v2-overflow-server.api-inference.modelscope.net";

type Health = { inflight: number; ewmaMs: number; failUntil: number };
const health = new Map<string, Health>();
const h = (base: string): Health => { let x = health.get(base); if (!x) { x = { inflight: 0, ewmaMs: 0, failUntil: 0 }; health.set(base, x); } return x; };
const num = (v: string | undefined, d: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const poolConfig = () => ({
  maxInflight: num(process.env.SHAM_V2_PRIMARY_MAX_INFLIGHT, 1),
  slowMs: num(process.env.SHAM_V2_SLOW_MS, 30000),
  cooldownMs: num(process.env.SHAM_V2_COOLDOWN_MS, 60000),
});

/** The overflow Studio of Sham v2, or null when switched off or pointed at another model's endpoint. */
const forbiddenOverflow = (base: string): boolean => /(?:nova-inference-server|coder-inference|sham-v1|sham-v2-video)/i.test(base);
export function overflowConfigured(): string | null {
  const raw = (process.env.SHAM_V2_OVERFLOW_URL ?? DEFAULT_V2_OVERFLOW_URL).trim();
  if (!raw || /^(off|none|0)$/i.test(raw)) return null;
  const base = raw.replace(/\/+$/, "");
  // Old deployments may still have Nova's former endpoint in this variable.
  // Ignore that value and use only the dedicated Sham v2 endpoint instead.
  return forbiddenOverflow(base) ? DEFAULT_V2_OVERFLOW_URL : base;
}

// The overflow is only used after its status proves it runs Sham v2; a wrong checkpoint must never answer a Sham v2 user.
// The verdict is refreshed in the background (5 min when good, 1 min when not).
const V2_MODEL = "novaai2026/sham-v2";
let verdict = { ok: false, at: 0, base: "", why: "not checked yet" };
export const overflowVerdict = () => ({ ...verdict });
/** The overflow base, only when it has been verified (and kicks off a background refresh when the verdict is stale). */
export function overflowBase(): string | null {
  const base = overflowConfigured();
  if (!base) return null;
  const age = Date.now() - verdict.at;
  if (verdict.base !== base || age > (verdict.ok ? 300000 : 60000)) void refreshOverflow(base);
  return verdict.ok && verdict.base === base ? base : null;
}
export async function refreshOverflow(base = overflowConfigured() || "", fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const normalized = String(base || "").replace(/\/+$/, "");
  if (!normalized || forbiddenOverflow(normalized)) {
    verdict = { ok: false, at: Date.now(), base: normalized, why: "refused cross-model Studio endpoint" };
    return false;
  }
  base = normalized;
  verdict = { ...verdict, at: Date.now(), base };                           // one refresh at a time per interval
  const token = (process.env.MODELSCOPE_API_TOKEN || "").trim();
  if (!token) { verdict = { ok: false, at: Date.now(), base, why: "no token" }; return false; }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const sub = await fetchImpl(`${base}/gradio_api/call/v2/status`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(8000) });
    const { event_id } = (await sub.json()) as { event_id?: string };
    const res = await fetchImpl(`${base}/gradio_api/call/status/${event_id}`, { headers, signal: AbortSignal.timeout(8000) });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data:")) || "";
    const arr = JSON.parse(line.slice(5).trim()) as unknown[];
    const st = JSON.parse(String(arr[0])) as { phase?: string; model?: string };
    const ok = st.phase === "ready" && st.model === V2_MODEL;
    verdict = { ok, at: Date.now(), base, why: ok ? "ready" : `phase=${st.phase || "?"} model=${st.model || "unreported"}` };
  } catch (e) {
    verdict = { ok: false, at: Date.now(), base, why: `unreachable: ${String((e as Error)?.message || e).slice(0, 60)}` };
  }
  return verdict.ok;
}

export function congested(base: string, now = Date.now()): boolean {
  const x = h(base), c = poolConfig();
  return x.inflight >= c.maxInflight || x.failUntil > now || x.ewmaMs > c.slowMs;
}

/** Wrap one call to one Studio: counts it while it runs, learns its latency, and cools it down after a refusal. `ok` decides whether the result counts as a failure. */
export async function tracked<T>(base: string, run: () => Promise<T>, failed: (r: T) => boolean = () => false): Promise<T> {
  const x = h(base);
  x.inflight++;
  const t0 = Date.now();
  try {
    const r = await run();
    if (failed(r)) x.failUntil = Date.now() + poolConfig().cooldownMs;
    else x.ewmaMs = x.ewmaMs ? x.ewmaMs * 0.7 + (Date.now() - t0) * 0.3 : Date.now() - t0;
    return r;
  } catch (e) {
    x.failUntil = Date.now() + poolConfig().cooldownMs;
    throw e;
  } finally {
    x.inflight--;
  }
}

/**
 * The order to try for one Sham v2 call. `primaries` is already rotated. Healthy primary -> primaries first, overflow as the fallback. Every primary congested and the
 * overflow not -> overflow first. All congested -> primaries first (they hold the longest-warmed state), overflow last. No overflow configured -> unchanged.
 */
export function orderV2(primaries: string[], now = Date.now()): string[] {
  const over = overflowBase();
  if (!over || primaries.includes(over)) return primaries;
  if (pressureOn() && !congested(over, now)) return [over, ...primaries];                 // pressure mode (owner switch): the overflow Studio takes new calls first
  const free = primaries.filter((b) => !congested(b, now));
  if (free.length) return [...free, ...primaries.filter((b) => !free.includes(b)), over];
  return congested(over, now) ? [...primaries, over] : [over, ...primaries];
}

export const _resetPoolForTests = (): void => { health.clear(); verdict = { ok: false, at: 0, base: "", why: "not checked yet" }; };
export const _verifyForTests = (base: string, ok = true): void => { verdict = { ok, at: Date.now(), base, why: "test" }; };
export const _healthForTests = (base: string): Health => ({ ...h(base) });
