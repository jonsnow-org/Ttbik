// Hosting operations behind the owner's «الاستضافة» panel (docs/HOSTING.md): switching the gate, moving the bots' webhooks, moving the settings to
// Oracle, and the owner alert when the standby takes over. No secret is shared with Cloudflare: the gate trusts a one-time nonce that only this
// database can have created (the owner's bot creates it; the gate asks the servers to confirm and consume it).
import crypto from "crypto";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import site from "../../deploy/hosting/site.json";
import { ENV_NAMES } from "@/lib/hostingEnvNames";

export const HOSTING = site as { gateUrl: string; vercelUrl: string; oracleUrl: string; oracleIp: string; engineUrl: string; canonicalUrl: string };
const trim = (u: string) => String(u || "").replace(/\/$/, "");
export const gateUrl = () => trim(HOSTING.gateUrl);
export type Mode = "auto" | "oracle" | "vercel";
export const MODES: readonly Mode[] = ["auto", "oracle", "vercel"];

let ready: Promise<void> | null = null;
export function ensureHostingTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS hosting_nonce (nonce TEXT PRIMARY KEY, action TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS hosting_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ---------- one-time nonces ----------
export async function createNonce(action: string, ttlSeconds = 120): Promise<string> {
  await ensureHostingTables();
  const nonce = crypto.randomBytes(16).toString("hex");
  await prisma.$executeRawUnsafe(`DELETE FROM hosting_nonce WHERE expires_at < now()`);
  await prisma.$executeRawUnsafe(`INSERT INTO hosting_nonce (nonce, action, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))`, nonce, action, ttlSeconds);
  return nonce;
}
/** Atomic: a nonce works once, and only before it expires. Returns what it allows, or null. */
export async function consumeNonce(nonce: string): Promise<string | null> {
  if (!/^[0-9a-f]{32,64}$/.test(nonce)) return null;
  await ensureHostingTables();
  const rows = (await prisma.$queryRawUnsafe(`DELETE FROM hosting_nonce WHERE nonce=$1 AND expires_at > now() RETURNING action`, nonce)) as { action: string }[];
  return rows[0]?.action ?? null;
}

// ---------- the gate ----------
export type GateState = { mode: Mode; until: number; effective: string[]; downUntil: number; kv: boolean };
export async function gateState(): Promise<GateState | null> {
  try {
    const r = await fetch(`${gateUrl()}/__gate/state`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    return r.ok ? ((await r.json()) as GateState) : null;
  } catch { return null; }
}
export async function setGateMode(mode: Mode): Promise<{ ok: boolean; error?: string; until?: number }> {
  if (!MODES.includes(mode)) return { ok: false, error: "bad mode" };
  try {
    const nonce = await createNonce(`mode:${mode}`);
    const r = await fetch(`${gateUrl()}/__gate/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce }), signal: AbortSignal.timeout(15000) });
    const j: any = await r.json().catch(() => ({}));
    return r.ok && j.ok ? { ok: true, until: j.until } : { ok: false, error: String(j.error || r.status) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 100) }; }
}
export async function probeOrigin(base: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${trim(base)}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { "x-gate": "probe" } });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch { return { ok: false, status: 0, ms: Date.now() - t0 }; }
}

// ---------- the settings window (Oracle asks for the site's environment; open only after the owner taps) ----------
export async function openEnvWindow(minutes = 15): Promise<Date> {
  await ensureHostingTables();
  const until = new Date(Date.now() + minutes * 60_000);
  await prisma.$executeRawUnsafe(`INSERT INTO hosting_flags (key, value) VALUES ('env_window_until',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, until.toISOString());
  return until;
}
export async function envWindowOpen(now = Date.now()): Promise<boolean> {
  await ensureHostingTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT value FROM hosting_flags WHERE key='env_window_until'`)) as { value: string }[];
  return !!rows[0] && Date.parse(rows[0].value) > now;
}
export async function closeEnvWindow(): Promise<void> {
  await ensureHostingTables();
  await prisma.$executeRawUnsafe(`DELETE FROM hosting_flags WHERE key='env_window_until'`);
}
/** Only the names the site code reads, only the ones that have a value. */
export function exportEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of ENV_NAMES) { const v = env[n]; if (typeof v === "string" && v !== "") out[n] = v; }
  return out;
}
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** The caller's address as the platform saw it (Vercel overwrites x-forwarded-for with the real peer). */
export function callerIp(h: { get(n: string): string | null }): string {
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || (h.get("x-real-ip") || "").trim();
}

// ---------- telling the owner ----------
async function ownerBot(): Promise<{ api: Bot["api"]; chat: string } | null> {
  const row = await prisma.bot.findFirst({ where: { template: "ATHAR_BOT", isActive: true }, select: { token: true, ownerId: true } }).catch(() => null);
  return row ? { api: new Bot(row.token).api, chat: row.ownerId } : null;
}
export async function notifyOwner(text: string): Promise<void> {
  try { const b = await ownerBot(); if (b) await b.api.sendMessage(b.chat, text); } catch { /* telling the owner must never break a request */ }
}
/** The standby was asked to serve because Oracle is down (the gate marks those requests): tell the owner, at most once in 15 minutes. */
export async function noteFailover(h: { get(n: string): string | null }): Promise<void> {
  if (h.get("x-gate-failover") !== "1" || h.get("x-gate") !== "1") return;
  try {
    await ensureHostingTables();
    const n = Number(await prisma.$executeRawUnsafe(`INSERT INTO hosting_flags (key, value) VALUES ('failover_alert_at', now()::text) ON CONFLICT (key) DO UPDATE SET value=now()::text, updated_at=now() WHERE hosting_flags.updated_at < now() - interval '15 minutes'`));
    if (n > 0) await notifyOwner("⚠️ الخادم الأساسي (Oracle) لا يرد، والبوابة تخدم الآن من Vercel الاحتياطي.\nOracle is not answering; the gate is serving from the Vercel standby.\n\n/admin ← 🌐 الاستضافة");
  } catch { /* best effort */ }
}

// ---------- the bots' webhooks ----------
export type RehookRow = { id: string; template: string; from: string; to: string; ok: boolean; note?: string };
export async function rehookBots(base: string, dry: boolean): Promise<RehookRow[]> {
  const bots = await prisma.bot.findMany({ where: { isActive: true }, select: { id: true, token: true, template: true, webhookSecret: true } });
  const out: RehookRow[] = [];
  for (const row of bots) {
    const to = `${trim(base)}/api/telegram/${row.id}`;
    const api = new Bot(row.token).api;
    try {
      const from = (await api.getWebhookInfo()).url || "";
      if (from === to) { out.push({ id: row.id, template: row.template, from, to, ok: true, note: "already there" }); continue; }
      if (!dry) await api.setWebhook(to, { secret_token: row.webhookSecret });
      out.push({ id: row.id, template: row.template, from, to, ok: true, note: dry ? "would change" : "changed" });
    } catch (e: any) {
      out.push({ id: row.id, template: row.template, from: "", to, ok: false, note: String(e?.description || e?.message || e).slice(0, 120) });
    }
    if (!dry) await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}
