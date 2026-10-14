/**
 * Storage for the premium Mini App: a few small additive tables (see
 * prisma/migration_match_app.sql), created lazily with CREATE IF NOT EXISTS
 * and accessed with parameterised raw SQL so prisma/schema.prisma and the
 * existing MARRIAGE_BOT models stay untouched.
 */
import { prisma } from "@/lib/prisma";
import { dayKey } from "@/lib/match/premium";

let ready: Promise<void> | null = null;
const DDL_FALLBACK = `CREATE TABLE IF NOT EXISTS match_app_messages (id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_app_messages_session_idx ON match_app_messages (session_id, id);
CREATE TABLE IF NOT EXISTS match_app_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, spins INT NOT NULL DEFAULT 0, superlikes INT NOT NULL DEFAULT 0, extra_superlikes INT NOT NULL DEFAULT 0, anon_chats INT NOT NULL DEFAULT 0, extra_anon INT NOT NULL DEFAULT 0, compliments INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS match_app_passes (user_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, target_id));
CREATE TABLE IF NOT EXISTS match_app_compliments (sender_id TEXT NOT NULL, target_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (sender_id, target_id, day));
CREATE TABLE IF NOT EXISTS match_app_perks (user_id TEXT PRIMARY KEY, referral_vip_claimed BOOLEAN NOT NULL DEFAULT false, anon_filter JSONB);
CREATE TABLE IF NOT EXISTS match_anon_filters (user_id TEXT PRIMARY KEY, filter JSONB, paid_until TIMESTAMPTZ, active_queue_id TEXT, notified_queue_id TEXT);
CREATE TABLE IF NOT EXISTS match_rate_limits (key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL DEFAULT now(), n INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS match_admin_audit (id BIGSERIAL PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, via TEXT NOT NULL DEFAULT 'bot', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_admin_audit_created_idx ON match_admin_audit (created_at DESC);
CREATE TABLE IF NOT EXISTS match_anon_rt (session_id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_app_presence (user_id TEXT PRIMARY KEY, last_seen TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_first_discount (user_id TEXT PRIMARY KEY, charge_type TEXT, used_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_funnel_events (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT, via TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_funnel_events_created_idx ON match_funnel_events (created_at DESC, event);
CREATE TABLE IF NOT EXISTS match_expiry_reminders (user_id TEXT NOT NULL, kind TEXT NOT NULL, until_day TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, kind, until_day));
CREATE TABLE IF NOT EXISTS match_app_passes_log (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_app_passes_log_user_idx ON match_app_passes_log (user_id, id DESC);
CREATE TABLE IF NOT EXISTS match_anon_state (session_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read BIGINT NOT NULL DEFAULT 0, typing_at TIMESTAMPTZ, PRIMARY KEY (session_id, user_id));
CREATE TABLE IF NOT EXISTS match_app_schema (id INT PRIMARY KEY, version INT NOT NULL)`;
/** Bump when DDL_FALLBACK changes; the DDL then runs once per database, not on every cold start. */
export const MATCH_APP_SCHEMA_VERSION = 5;

export function ensureMatchAppTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      // Run-once flag: a single cheap SELECT on warm databases.
      try {
        const v = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM match_app_schema WHERE id = 1`;
        if (Number(v[0]?.version) >= MATCH_APP_SCHEMA_VERSION) return;
      } catch { /* table missing → run DDL below */ }
      // Same statements as prisma/migration_match_app.sql (keep both in sync).
      for (const stmt of DDL_FALLBACK.split(";").map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
      await prisma.$executeRaw`INSERT INTO match_app_schema (id, version) VALUES (1, ${MATCH_APP_SCHEMA_VERSION}) ON CONFLICT (id) DO UPDATE SET version = ${MATCH_APP_SCHEMA_VERSION}`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export type Daily = { spins: number; superlikes: number; extra_superlikes: number; anon_chats: number; extra_anon: number; compliments: number };
export async function getDaily(userId: string): Promise<Daily> {
  await ensureMatchAppTables();
  const day = dayKey();
  const rows = await prisma.$queryRaw<Daily[]>`SELECT spins, superlikes, extra_superlikes, anon_chats, extra_anon, compliments FROM match_app_daily WHERE user_id = ${userId} AND day = ${day}`;
  return rows[0] ?? { spins: 0, superlikes: 0, extra_superlikes: 0, anon_chats: 0, extra_anon: 0, compliments: 0 };
}
/** Atomic "use one if below limit"; returns false when the limit is reached. */
export async function takeDaily(userId: string, col: "spins" | "superlikes" | "anon_chats" | "compliments", limit: number, extraCol?: "extra_superlikes" | "extra_anon"): Promise<boolean> {
  await ensureMatchAppTables();
  const day = dayKey();
  await prisma.$executeRawUnsafe(`INSERT INTO match_app_daily (user_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userId, day);
  const extra = extraCol ? ` + ${extraCol}` : "";
  const n = await prisma.$executeRawUnsafe(
    `UPDATE match_app_daily SET ${col} = ${col} + 1 WHERE user_id = $1 AND day = $2 AND ${col} < $3${extra}`,
    userId, day, limit,
  );
  return n > 0;
}

export async function recordAnonMessage(sessionId: string, senderId: string, text: string): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`INSERT INTO match_app_messages (session_id, sender_id, text) VALUES (${sessionId}, ${senderId}, ${text.slice(0, 2000)})`;
  } catch { /* the bot relay must never fail because of the app's history */ }
}
export async function anonMessagesSince(sessionId: string, afterId: number): Promise<{ id: number; sender_id: string; text: string; created_at: Date }[]> {
  await ensureMatchAppTables();
  const rows = await prisma.$queryRaw<{ id: bigint; sender_id: string; text: string; created_at: Date }[]>`
    SELECT id, sender_id, text, created_at FROM match_app_messages WHERE session_id = ${sessionId} AND id > ${afterId} ORDER BY id ASC LIMIT 100`;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function addComplimentOnce(senderId: string, targetId: string): Promise<boolean> {
  await ensureMatchAppTables();
  const n = await prisma.$executeRaw`INSERT INTO match_app_compliments (sender_id, target_id, day) VALUES (${senderId}, ${targetId}, ${dayKey()}) ON CONFLICT DO NOTHING`;
  return n > 0;
}

export async function saveAnonFilter(userId: string, filter: unknown) {
  await ensureMatchAppTables();
  const j = JSON.stringify(filter ?? {});
  await prisma.$executeRaw`INSERT INTO match_app_perks (user_id, anon_filter) VALUES (${userId}, ${j}::jsonb) ON CONFLICT (user_id) DO UPDATE SET anon_filter = ${j}::jsonb`;
}

// ---- 🎛 paid anon-chat filters ----------------------------------------------------------------
export type AnonFilterStore = { filter: any; paid_until: Date | null; active_queue_id: string | null; notified_queue_id: string | null };
export async function getAnonFilterRow(userId: string): Promise<AnonFilterStore | null> {
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<AnonFilterStore[]>`SELECT filter, paid_until, active_queue_id, notified_queue_id FROM match_anon_filters WHERE user_id = ${userId}`;
  return r[0] ?? null;
}
export async function getAnonFilterRows(userIds: string[]): Promise<Map<string, AnonFilterStore>> {
  const m = new Map<string, AnonFilterStore>();
  if (!userIds.length) return m;
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<(AnonFilterStore & { user_id: string })[]>`SELECT user_id, filter, paid_until, active_queue_id, notified_queue_id FROM match_anon_filters WHERE user_id = ANY(${userIds})`;
  for (const x of r) m.set(x.user_id, x);
  return m;
}
export async function setAnonFilterValue(userId: string, filter: unknown) {
  await ensureMatchAppTables();
  const j = JSON.stringify(filter ?? {});
  await prisma.$executeRaw`INSERT INTO match_anon_filters (user_id, filter) VALUES (${userId}, ${j}::jsonb) ON CONFLICT (user_id) DO UPDATE SET filter = ${j}::jsonb`;
}
export async function setAnonPaidUntil(userId: string, until: Date) {
  await ensureMatchAppTables();
  await prisma.$executeRaw`INSERT INTO match_anon_filters (user_id, paid_until) VALUES (${userId}, ${until}) ON CONFLICT (user_id) DO UPDATE SET paid_until = ${until}`;
}
export async function setAnonActiveQueue(userId: string, queueId: string | null) {
  await ensureMatchAppTables();
  await prisma.$executeRaw`INSERT INTO match_anon_filters (user_id, active_queue_id) VALUES (${userId}, ${queueId}) ON CONFLICT (user_id) DO UPDATE SET active_queue_id = ${queueId}`;
}
/** Returns true only the first time for this queue row (so the timeout notice is sent once). */
export async function markAnonNotified(userId: string, queueId: string): Promise<boolean> {
  await ensureMatchAppTables();
  const n = await prisma.$executeRaw`UPDATE match_anon_filters SET notified_queue_id = ${queueId} WHERE user_id = ${userId} AND notified_queue_id IS DISTINCT FROM ${queueId}`;
  return n > 0;
}

/** Atomic +30d extension that stacks on remaining time (no read-then-write race). */
export async function extendAnonPaidUntilAtomic(userId: string, days: number): Promise<Date> {
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<{ paid_until: Date }[]>`
    INSERT INTO match_anon_filters (user_id, paid_until) VALUES (${userId}, now() + make_interval(days => ${days}::int))
    ON CONFLICT (user_id) DO UPDATE SET paid_until = GREATEST(COALESCE(match_anon_filters.paid_until, now()), now()) + make_interval(days => ${days}::int)
    RETURNING paid_until`;
  return r[0].paid_until;
}

// ---- admin audit log -------------------------------------------------------------------------
export async function auditAdmin(adminId: string, action: string, target?: string | null, detail?: string | null, via: "bot" | "app" = "bot"): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`INSERT INTO match_admin_audit (admin_id, action, target, detail, via) VALUES (${adminId}, ${action}, ${target ?? null}, ${detail ? detail.slice(0, 300) : null}, ${via})`;
  } catch { /* audit must never break moderation */ }
}
export async function recentAudit(limit = 30) {
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<{ id: bigint; admin_id: string; action: string; target: string | null; detail: string | null; via: string; created_at: Date }[]>`
    SELECT id, admin_id, action, target, detail, via, created_at FROM match_admin_audit ORDER BY created_at DESC LIMIT ${limit}`;
  return r.map((x) => ({ ...x, id: Number(x.id) }));
}

/** ACTIVE random sessions whose last message (or start) is older than `minutes`. */
export async function idleRandomSessions(minutes: number): Promise<{ id: string; user1Id: string; user2Id: string; botId: string }[]> {
  await ensureMatchAppTables();
  return prisma.$queryRaw<{ id: string; user1Id: string; user2Id: string; botId: string }[]>`
    SELECT s.id, s."user1Id", s."user2Id", s."botId" FROM "RandomChatSession" s
    WHERE s.status = 'ACTIVE'
      AND COALESCE((SELECT max(m.created_at) FROM match_app_messages m WHERE m.session_id = s.id), s.created_at) < now() - make_interval(mins => ${minutes}::int)
    LIMIT 200`;
}

export async function clearAnonHistory(sessionId: string): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`DELETE FROM match_app_messages WHERE session_id = ${sessionId}`;
  } catch { /* best effort */ }
}
