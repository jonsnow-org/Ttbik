// Storage for the creator hub. Same approach as src/lib/bashar.ts: tables created on first use (CREATE TABLE IF NOT EXISTS) through the
// app's own Postgres connection, plus the same SQL in prisma/migration_hub_creator.sql. RLS on, no policies (blocks Supabase anon REST).
// Identities are never stored raw: web cookie ids and Telegram chat ids go through hubUid() (salted SHA-256, one-way).
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppConfig, MAX_APPS_PER_USER, makeSlug } from "./appConfig";
import { ActivityCounts, badgesFor, BASHAR_CREDIT_COST, levelFor, PointAction, pointsToAward, WELCOME_POINTS } from "./points";

export const HUB_SQL = [
  `CREATE TABLE IF NOT EXISTS hub_points (uid text PRIMARY KEY, name text, balance int NOT NULL DEFAULT 0, total int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS hub_points_log (id bigserial PRIMARY KEY, uid text NOT NULL, action text NOT NULL, amount int NOT NULL, day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS hub_points_log_uid_day ON hub_points_log (uid, day)`,
  `CREATE TABLE IF NOT EXISTS hub_apps (slug text PRIMARY KEY, owner_uid text NOT NULL, edit_key_hash text NOT NULL, config jsonb NOT NULL, views int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS hub_apps_owner ON hub_apps (owner_uid)`,
  `CREATE TABLE IF NOT EXISTS hub_mood (id bigserial PRIMARY KEY, uid text NOT NULL, score int NOT NULL CHECK (score BETWEEN 1 AND 5), created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS hub_mood_uid ON hub_mood (uid, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hub_usage (uid text NOT NULL, day date NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (uid, day))`,
  `CREATE TABLE IF NOT EXISTS hub_bot_state (uid text PRIMARY KEY, state jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE hub_points ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE hub_points_log ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE hub_apps ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE hub_mood ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE hub_usage ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE hub_bot_state ENABLE ROW LEVEL SECURITY`,
];

let ready: Promise<void> | null = null;
export function ensureHubTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const s of HUB_SQL) await prisma.$executeRawUnsafe(s);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export function hubUid(kind: "web" | "tg", raw: string | number): string {
  const salt = process.env.HUB_UID_SALT || process.env.SHAM_MEMORY_SALT || "sham-hub";
  return `${kind}:` + createHash("sha256").update(`${salt}|${kind}|${raw}`).digest("hex").slice(0, 32);
}
export const newWebId = () => randomBytes(16).toString("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export function keyMatches(given: string, storedHash: string): boolean {
  const a = Buffer.from(sha(String(given || "")));
  const b = Buffer.from(String(storedHash || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------- daily AI quota (honest free tier)
export const DAILY_AI_LIMIT = 25;
/** Counts one AI use; false when today's quota is spent. */
export async function takeQuota(uid: string, limit = DAILY_AI_LIMIT): Promise<boolean> {
  await ensureHubTables();
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `INSERT INTO hub_usage (uid, day, n) VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
     ON CONFLICT (uid, day) DO UPDATE SET n = hub_usage.n + 1 RETURNING n`, uid);
  return Number(rows[0]?.n ?? 0) <= limit;
}

// ------------------------------------------------------------- points
export async function ensurePlayer(uid: string): Promise<void> {
  await ensureHubTables();
  const ins = await prisma.$executeRawUnsafe(`INSERT INTO hub_points (uid, balance, total) VALUES ($1, $2, $2) ON CONFLICT (uid) DO NOTHING`, uid, WELCOME_POINTS);
  if (ins) await prisma.$executeRawUnsafe(`INSERT INTO hub_points_log (uid, action, amount) VALUES ($1, 'welcome', $2)`, uid, WELCOME_POINTS);
}

export async function award(uid: string, action: PointAction): Promise<number> {
  try {
    await ensurePlayer(uid);
    if (action === "daily") {
      const done = await prisma.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int c FROM hub_points_log WHERE uid = $1 AND action = 'daily' AND day = (now() AT TIME ZONE 'utc')::date`, uid);
      if (Number(done[0]?.c) > 0) return 0;
    }
    const today = await prisma.$queryRawUnsafe<{ s: number }[]>(
      `SELECT COALESCE(sum(amount),0)::int s FROM hub_points_log WHERE uid = $1 AND amount > 0 AND action <> 'welcome' AND day = (now() AT TIME ZONE 'utc')::date`, uid);
    const add = pointsToAward(action, Number(today[0]?.s ?? 0));
    if (add <= 0) return 0;
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`UPDATE hub_points SET balance = balance + $2, total = total + $2 WHERE uid = $1`, uid, add),
      prisma.$executeRawUnsafe(`INSERT INTO hub_points_log (uid, action, amount) VALUES ($1, $2, $3)`, uid, action, add),
    ]);
    return add;
  } catch {
    return 0; // points never block a tool
  }
}

export async function profile(uid: string) {
  await ensurePlayer(uid);
  const p = (await prisma.$queryRawUnsafe<{ balance: number; total: number; name: string | null }[]>(`SELECT balance, total, name FROM hub_points WHERE uid = $1`, uid))[0];
  const counts = await prisma.$queryRawUnsafe<{ action: string; c: number }[]>(`SELECT action, count(*)::int c FROM hub_points_log WHERE uid = $1 GROUP BY action`, uid);
  const c: ActivityCounts = {};
  for (const r of counts) (c as Record<string, number>)[r.action] = Number(r.c);
  return { balance: p.balance, total: p.total, name: p.name, level: levelFor(p.total), badges: badgesFor(p.total, c) };
}

export async function setDisplayName(uid: string, name: string) {
  const n = String(name || "").replace(/[<>@]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  await ensurePlayer(uid);
  await prisma.$executeRawUnsafe(`UPDATE hub_points SET name = $2 WHERE uid = $1`, uid, n || null);
}

export async function leaderboard(limit = 10) {
  await ensureHubTables();
  const rows = await prisma.$queryRawUnsafe<{ name: string | null; total: number }[]>(
    `SELECT name, total FROM hub_points ORDER BY total DESC LIMIT $1`, limit);
  return rows.map((r, i) => ({ rank: i + 1, name: r.name || `صانع #${i + 1}`, total: r.total, level: levelFor(r.total).name }));
}

/** Spend BASHAR_CREDIT_COST points for one «بشر» credit on the given bashar player id (the bashar_id cookie). */
export async function redeemBasharCredit(uid: string, basharPlayerId: string): Promise<{ ok: boolean; error?: string }> {
  await ensurePlayer(uid);
  const { ensureTables } = await import("@/lib/bashar");
  await ensureTables();
  const res = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRawUnsafe(`UPDATE hub_points SET balance = balance - $2 WHERE uid = $1 AND balance >= $2`, uid, BASHAR_CREDIT_COST);
    if (!n) return false;
    await tx.$executeRawUnsafe(`INSERT INTO hub_points_log (uid, action, amount) VALUES ($1, 'bashar_credit', $2)`, uid, -BASHAR_CREDIT_COST);
    await tx.$executeRawUnsafe(
      `INSERT INTO bashar_players (id, credits) VALUES ($1, 2) ON CONFLICT (id) DO UPDATE SET credits = LEAST(bashar_players.credits + 1, 6)`, basharPlayerId);
    return true;
  });
  return res ? { ok: true } : { ok: false, error: `تحتاج ${BASHAR_CREDIT_COST} نقاط على الأقل` };
}

// ------------------------------------------------------------- apps
export async function createApp(ownerUid: string, config: AppConfig): Promise<{ ok: true; slug: string; editKey: string } | { ok: false; error: string }> {
  await ensureHubTables();
  const c = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int c FROM hub_apps WHERE owner_uid = $1`, ownerUid);
  if (Number(c[0]?.c) >= MAX_APPS_PER_USER) return { ok: false, error: `الحد المجاني ${MAX_APPS_PER_USER} تطبيقات لكل مستخدم` };
  const slug = makeSlug(config.title);
  const editKey = randomBytes(12).toString("hex");
  await prisma.$executeRawUnsafe(
    `INSERT INTO hub_apps (slug, owner_uid, edit_key_hash, config) VALUES ($1, $2, $3, $4::jsonb)`, slug, ownerUid, sha(editKey), JSON.stringify(config));
  return { ok: true, slug, editKey };
}
export async function getApp(slug: string): Promise<{ slug: string; owner_uid: string; edit_key_hash: string; config: AppConfig; views: number } | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  await ensureHubTables();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT slug, owner_uid, edit_key_hash, config, views FROM hub_apps WHERE slug = $1`, slug);
  return r[0] || null;
}
export async function bumpViews(slug: string) {
  await prisma.$executeRawUnsafe(`UPDATE hub_apps SET views = views + 1 WHERE slug = $1`, slug).catch(() => null);
}
export async function saveApp(slug: string, config: AppConfig) {
  await prisma.$executeRawUnsafe(`UPDATE hub_apps SET config = $2::jsonb, updated_at = now() WHERE slug = $1`, slug, JSON.stringify(config));
}
export async function appsOf(ownerUid: string) {
  await ensureHubTables();
  return prisma.$queryRawUnsafe<{ slug: string; config: AppConfig; views: number }[]>(
    `SELECT slug, config, views FROM hub_apps WHERE owner_uid = $1 ORDER BY created_at DESC`, ownerUid);
}
export async function deleteApp(slug: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM hub_apps WHERE slug = $1`, slug);
}

// ------------------------------------------------------------- mood (score only, no text is stored)
export async function logMood(uid: string, score: number) {
  await ensureHubTables();
  const s = Math.max(1, Math.min(5, Math.round(score)));
  await prisma.$executeRawUnsafe(`INSERT INTO hub_mood (uid, score) VALUES ($1, $2)`, uid, s);
}
export async function moodHistory(uid: string, days = 14) {
  await ensureHubTables();
  return prisma.$queryRawUnsafe<{ score: number; created_at: Date }[]>(
    `SELECT score, created_at FROM hub_mood WHERE uid = $1 AND created_at > now() - ($2 || ' days')::interval ORDER BY created_at`, uid, String(days));
}
/** «انسَ معلوماتي»: deletes mood history and bot state for this user. Apps and points are kept unless asked separately. */
export async function forgetMind(uid: string) {
  await ensureHubTables();
  await prisma.$executeRawUnsafe(`DELETE FROM hub_mood WHERE uid = $1`, uid);
  await prisma.$executeRawUnsafe(`DELETE FROM hub_bot_state WHERE uid = $1 OR uid LIKE $1 || '|%'`, uid);
}

// ------------------------------------------------------------- bot conversation state
export async function getState(uid: string): Promise<Record<string, any>> {
  await ensureHubTables();
  const r = await prisma.$queryRawUnsafe<{ state: any }[]>(`SELECT state FROM hub_bot_state WHERE uid = $1`, uid);
  return r[0]?.state || {};
}
export async function setState(uid: string, state: Record<string, any>) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO hub_bot_state (uid, state) VALUES ($1, $2::jsonb) ON CONFLICT (uid) DO UPDATE SET state = $2::jsonb, updated_at = now()`, uid, JSON.stringify(state));
}
