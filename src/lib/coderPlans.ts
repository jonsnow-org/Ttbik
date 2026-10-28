// Plans, subscriptions and weekly usage limits for the coder (foundation for commercial plans, owner's order 2026-10-21).
// Zero cost: rows in the site's own Postgres. No payment provider is wired: `PaymentProvider` is the interface a later integration
// implements; until then the owner assigns plans by hand in the Mini App. Free plan by default; the owner (verified Telegram id,
// SUPER_ADMIN_TELEGRAM_ID / TELEGRAM_ADMIN_CHAT_ID) has no limits at all.
// Usage is a ROLLING 7-day window: amounts are kept in hourly buckets and the window sums the last 168 hours, so usage "comes back"
// gradually; the reset time shown is when the oldest usage in the window drops out (and, for a full reset, when the newest does).
import { pressureLimit } from "@/lib/pressureMode";
import { prismaDb, coderChatKey, tierFor, type Db } from "@/lib/coderAuth";

export const METRICS = ["tasks", "steps", "tokens", "sandbox_minutes", "research", "schedules"] as const;
export type Metric = (typeof METRICS)[number];
export type Limits = Record<Metric, number>;                              // -1 = unlimited
export type Plan = { id: string; name: { ar: string; en: string }; price_label: string; price_cents: number | null; currency: string; limits: Limits; sort: number; active: boolean; price_stars?: number | null; daily_tokens?: number | null; days?: number };
export const isMetric = (m: unknown): m is Metric => METRICS.includes(m as Metric);
/**
 * Plans are token-based (owner's decision 2026-10-21, like Claude): the weekly allowance is model tokens (prompt + completion, from the
 * Studio's own counts when it sends them). Tasks and agent steps are still recorded for the dashboard but no longer limit anyone
 * (CODER_COUNT_LIMITS=on brings those two limits back). Machine minutes, deep research and scheduled tasks stay as resource caps.
 */
export const COUNT_METRICS: Metric[] = ["tasks", "steps"];
// Task / step counts are limits again (owner's tier table, 2026-10-28); CODER_COUNT_LIMITS=off turns those two off.
export const enforced = (m: Metric) => !COUNT_METRICS.includes(m) || (process.env.CODER_COUNT_LIMITS || "").toLowerCase() !== "off";
export const DAY_MS = 24 * 3600 * 1000;
export const WINDOW_MS = 7 * 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

// Defaults (the owner edits names, prices and limits in the Mini App; prices are placeholders until payments exist).
export const DEFAULT_PLANS: Plan[] = [
  { id: "free", name: { ar: "مجاني", en: "Free" }, price_label: "0", price_cents: 0, currency: "USD", sort: 0, active: true, daily_tokens: 25_000,
    limits: { tasks: 8, steps: 250, tokens: 120_000, sandbox_minutes: 15, research: 3, schedules: 1 } },
  { id: "plus", name: { ar: "بلس", en: "Plus" }, price_label: "250⭐ / 30d", price_cents: null, currency: "USD", sort: 1, active: true, price_stars: 250, days: 30, daily_tokens: null,
    limits: { tasks: 40, steps: 1500, tokens: 750_000, sandbox_minutes: 120, research: 20, schedules: 5 } },
  { id: "pro", name: { ar: "برو", en: "Pro" }, price_label: "750⭐ / 30d", price_cents: null, currency: "USD", sort: 2, active: true, price_stars: 750, days: 30, daily_tokens: null,
    limits: { tasks: 120, steps: 5000, tokens: 1_500_000, sandbox_minutes: 400, research: 60, schedules: 15 } },
];
/** Plans that get queue priority: their requests go ahead of free ones in the Studio's one-at-a-time queue (ai-system/modelscope-coder: `priority`, bounded by
 *  CODER_PRIORITY_BOOST_S so nobody starves). The owner always has it. */
export const PRIORITY_PLANS = ["pro"];

/** 1 for the owner and for an active subscription to a PRIORITY_PLANS plan, else 0. Never throws: a database problem means "no priority", never a failed request. */
export async function queuePriority(chatId: number | string, db: Db = prismaDb): Promise<number> {
  try {
    if (tierFor(Number(chatId)) === "owner") return 1;
    const sub = await getSubscription(chatId, db);
    return PRIORITY_PLANS.includes(sub.plan_id) ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Later: a payment integration implements this (checkout link for a plan, webhook that activates the subscription). None is wired now. */
/** The terminal (live task logs, Mini App tab) is for the owner always and for paid plans only; the free plan does not see it (owner's order, 2026-10-26). */
export async function terminalAllowed(chatId: number | string, db: Db = prismaDb): Promise<boolean> {
  if (tierFor(Number(chatId)) === "owner") return true;
  const sub = await getSubscription(chatId, db);
  if (sub.plan_id === "free") return false;
  const plan = (await listPlans(db)).find((p) => p.id === sub.plan_id);
  return Boolean(plan && plan.sort > 0 && plan.active);
}

export interface PaymentProvider {
  id: string;
  checkoutUrl(userId: number, plan: Plan, returnUrl: string): Promise<string>;
  handleWebhook(req: Request): Promise<{ userId: number; planId: string; periodEnd: Date } | null>;
}
let payment: PaymentProvider | null = null;
export const setPaymentProvider = (p: PaymentProvider | null) => { payment = p; };
export const paymentProvider = () => payment;

let ready: Promise<void> | null = null;
function ensureTables(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_plans (id TEXT PRIMARY KEY, name JSONB NOT NULL, price_label TEXT NOT NULL DEFAULT '', price_cents INT, currency TEXT NOT NULL DEFAULT 'USD', limits JSONB NOT NULL, sort INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_subscriptions (chat_key TEXT PRIMARY KEY, plan_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', period_start TIMESTAMPTZ NOT NULL DEFAULT now(), period_end TIMESTAMPTZ, provider TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_usage (chat_key TEXT NOT NULL, metric TEXT NOT NULL, bucket TIMESTAMPTZ NOT NULL, amount BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (chat_key, metric, bucket))`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_usage_bucket_idx ON coder_usage (bucket)`);
      // Telegram Stars price and period of a plan (2026-10-21): added columns, older rows keep working
      await db.exec(`ALTER TABLE coder_plans ADD COLUMN IF NOT EXISTS price_stars INT`);
      await db.exec(`ALTER TABLE coder_plans ADD COLUMN IF NOT EXISTS days INT`);
      await db.exec(`ALTER TABLE coder_plans ADD COLUMN IF NOT EXISTS daily_tokens INT`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

const clean = (l: Partial<Record<string, unknown>>, base: Limits): Limits =>
  Object.fromEntries(METRICS.map((m) => [m, Number.isFinite(Number(l?.[m])) ? Math.max(-1, Math.floor(Number(l[m]))) : base[m]])) as Limits;

export async function listPlans(db: Db = prismaDb): Promise<Plan[]> {
  let rows: any[] = [];
  try {
    await ensureTables(db);
    rows = await db.query(`SELECT * FROM coder_plans`);
  } catch {
    rows = [];
  }
  const byId = new Map<string, Plan>(DEFAULT_PLANS.map((p) => [p.id, p]));
  for (const r of rows) {
    const base = byId.get(r.id) || DEFAULT_PLANS[0];
    const name = typeof r.name === "string" ? JSON.parse(r.name) : r.name;
    const limits = typeof r.limits === "string" ? JSON.parse(r.limits) : r.limits;
    byId.set(r.id, { id: r.id, name: { ar: String(name?.ar || base.name.ar), en: String(name?.en || base.name.en) }, price_label: String(r.price_label ?? ""), price_cents: r.price_cents == null ? null : Number(r.price_cents), currency: String(r.currency || "USD"), limits: clean(limits, base.limits), sort: Number(r.sort) || 0, active: r.active !== false,
      price_stars: r.price_stars === undefined ? base.price_stars ?? null : r.price_stars === null ? null : Number(r.price_stars), days: r.days ? Number(r.days) : base.days ?? 30, daily_tokens: r.daily_tokens === undefined ? base.daily_tokens ?? null : r.daily_tokens === null ? null : Number(r.daily_tokens) });
  }
  return [...byId.values()].sort((a, b) => a.sort - b.sort);
}

/** Owner only (checked by the caller): edit a plan's name, price placeholder, limits, order, visibility. */
export async function upsertPlan(p: Partial<Plan> & { id: string }, db: Db = prismaDb): Promise<Plan> {
  if (!/^[a-z0-9_-]{2,24}$/.test(p.id)) throw new Error("bad plan id");
  const cur = (await listPlans(db)).find((x) => x.id === p.id) || { ...DEFAULT_PLANS[0], id: p.id, sort: 9, price_cents: null, price_label: "—" };
  const next: Plan = {
    ...cur,
    name: { ar: String(p.name?.ar ?? cur.name.ar).slice(0, 40), en: String(p.name?.en ?? cur.name.en).slice(0, 40) },
    price_label: String(p.price_label ?? cur.price_label).slice(0, 40),
    price_cents: p.price_cents === undefined ? cur.price_cents : p.price_cents === null ? null : Math.max(0, Math.floor(Number(p.price_cents) || 0)),
    currency: String(p.currency ?? cur.currency).toUpperCase().slice(0, 6),
    limits: clean((p.limits || {}) as any, cur.limits),
    sort: p.sort === undefined ? cur.sort : Number(p.sort) || 0,
    active: p.active === undefined ? cur.active : Boolean(p.active),
    price_stars: p.price_stars === undefined ? cur.price_stars ?? null : p.price_stars === null || Number(p.price_stars) <= 0 ? null : Math.min(100000, Math.floor(Number(p.price_stars) || 0)) || null,
    daily_tokens: p.daily_tokens === undefined ? cur.daily_tokens ?? null : p.daily_tokens === null || Number(p.daily_tokens) <= 0 ? null : Math.floor(Number(p.daily_tokens)),
    days: p.days === undefined ? cur.days ?? 30 : Math.max(1, Math.min(366, Math.floor(Number(p.days) || 30))),
  };
  await ensureTables(db);
  await db.exec(
    `INSERT INTO coder_plans (id, name, price_label, price_cents, currency, limits, sort, active) VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_label = EXCLUDED.price_label, price_cents = EXCLUDED.price_cents, currency = EXCLUDED.currency, limits = EXCLUDED.limits, sort = EXCLUDED.sort, active = EXCLUDED.active, updated_at = now()`,
    next.id, JSON.stringify(next.name), next.price_label, next.price_cents, next.currency, JSON.stringify(next.limits), next.sort, next.active,
  );
  await db.exec(`UPDATE coder_plans SET price_stars = $2, days = $3, daily_tokens = $4 WHERE id = $1`, next.id, next.price_stars ?? null, next.days ?? 30, next.daily_tokens ?? null).catch(() => null);
  return next;
}

export type Subscription = { plan_id: string; status: string; period_start: string | null; period_end: string | null; provider: string | null };
export async function getSubscription(chatId: number | string, db: Db = prismaDb): Promise<Subscription> {
  try {
    await ensureTables(db);
    const r = (await db.query<any>(`SELECT plan_id, status, period_start, period_end, provider FROM coder_subscriptions WHERE chat_key = $1`, coderChatKey(chatId)))[0];
    const expired = r?.period_end && Date.parse(String(r.period_end).replace(" ", "T").replace(/\+00$/, "Z")) < Date.now();
    if (r && r.status === "active" && !expired) return { plan_id: r.plan_id, status: r.status, period_start: r.period_start ? String(r.period_start) : null, period_end: r.period_end ? String(r.period_end) : null, provider: r.provider ?? null };
  } catch {
    /* falls back to free */
  }
  return { plan_id: "free", status: "active", period_start: null, period_end: null, provider: null };
}

/** Assign a plan (owner by hand now; a PaymentProvider webhook later). days = null → no end. */
export async function setSubscription(chatId: number | string, planId: string, days: number | null, provider: string | null, db: Db = prismaDb): Promise<void> {
  await ensureTables(db);
  const end = days && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await db.exec(
    `INSERT INTO coder_subscriptions (chat_key, plan_id, status, period_start, period_end, provider) VALUES ($1, $2, 'active', now(), $3, $4)
     ON CONFLICT (chat_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', period_start = now(), period_end = EXCLUDED.period_end, provider = EXCLUDED.provider, updated_at = now()`,
    coderChatKey(chatId), planId, end, provider,
  );
}

const bucketOf = (t: number) => new Date(Math.floor(t / HOUR) * HOUR).toISOString();

/** Adds usage (owner too, for the dashboard; the owner is just never limited). sandbox_minutes is recorded in SECONDS. */
export async function addUsage(chatId: number | string, metric: Metric, amount: number, db: Db = prismaDb, now = Date.now()): Promise<void> {
  const n = Math.max(0, Math.round(amount));
  if (!n) return;
  try {
    await ensureTables(db);
    await db.exec(
      `INSERT INTO coder_usage (chat_key, metric, bucket, amount) VALUES ($1, $2, $3, $4) ON CONFLICT (chat_key, metric, bucket) DO UPDATE SET amount = coder_usage.amount + EXCLUDED.amount`,
      coderChatKey(chatId), metric, bucketOf(now), n,
    );
  } catch {
    /* metering never breaks a task */
  }
}

type Bucket = { metric: string; bucket: string; amount: number };
async function windowRows(chatId: number | string, db: Db, now: number): Promise<Bucket[]> {
  try {
    await ensureTables(db);
    const rows = await db.query<any>(`SELECT metric, bucket, amount FROM coder_usage WHERE chat_key = $1 AND bucket > $2 ORDER BY bucket`, coderChatKey(chatId), new Date(now - WINDOW_MS).toISOString());
    return rows.map((r) => ({ metric: String(r.metric), bucket: new Date(String(r.bucket).replace(" ", "T").replace(/\+00$/, "Z")).toISOString(), amount: Number(r.amount) }));
  } catch {
    return [];
  }
}

export type MetricUsage = { metric: Metric; used: number; limit: number; nextRelief: string | null; fullReset: string | null };
export type UsageSummary = { plan: Plan; unlimited: boolean; owner: boolean; subscription: Subscription; metrics: MetricUsage[] };

export async function usageSummary(chatId: number | string, db: Db = prismaDb, now = Date.now(), extra: Partial<Record<Metric, number>> = {}): Promise<UsageSummary> {
  const owner = tierFor(chatId) === "owner";
  const plans = await listPlans(db);
  const subscription = await getSubscription(chatId, db);
  const plan = plans.find((p) => p.id === subscription.plan_id) || plans.find((p) => p.id === "free") || DEFAULT_PLANS[0];
  const rows = await windowRows(chatId, db, now);
  const metrics = METRICS.map((metric) => {
    const mine = rows.filter((r) => r.metric === metric);
    const raw = mine.reduce((n, r) => n + r.amount, 0);
    // sandbox time is stored in seconds and shown in minutes; schedules is a current count, not a weekly sum
    const used = metric === "schedules" ? Number(extra.schedules || 0) : metric === "sandbox_minutes" ? Math.ceil(raw / 60) : raw;
    const first = mine[0]?.bucket;
    const last = mine[mine.length - 1]?.bucket;
    return {
      metric, used, limit: owner || !enforced(metric) ? -1 : pressureLimit(plan.limits[metric], plan.id),
      nextRelief: metric === "schedules" || !first ? null : new Date(Date.parse(first) + WINDOW_MS + HOUR).toISOString(),
      fullReset: metric === "schedules" || !last ? null : new Date(Date.parse(last) + WINDOW_MS + HOUR).toISOString(),
    };
  });
  return { plan, unlimited: owner, owner, subscription, metrics };
}

export type LimitCheck = { ok: true } | { ok: false; metric: Metric; used: number; limit: number; resetAt: string | null; plan: Plan; daily?: boolean };
/** Is there room for `amount` more of `metric`? The owner always passes. `current` = an absolute count (schedules). */
export async function checkLimit(chatId: number | string, metric: Metric, amount = 1, db: Db = prismaDb, current?: number, now = Date.now()): Promise<LimitCheck> {
  if (tierFor(chatId) === "owner") return { ok: true };
  if (!enforced(metric)) return { ok: true };
  const s = await usageSummary(chatId, db, now, current !== undefined ? { [metric]: current } : {});
  const m = s.metrics.find((x) => x.metric === metric)!;
  if (!(m.limit < 0 || (amount === 0 ? m.used < m.limit : m.used + amount <= m.limit))) return { ok: false, metric, used: m.used, limit: m.limit, resetAt: m.nextRelief, plan: s.plan };   // amount 0 = "any room left"
  const daily = metric === "tokens" ? s.plan.daily_tokens : null;
  if (daily && daily > 0) {                                           // the rolling 24 h token cap (Free: 25k/day); the weekly cap above still applies too
    const rows = (await windowRows(chatId, db, now)).filter((r) => r.metric === "tokens" && Date.parse(r.bucket) > now - DAY_MS);
    const used = rows.reduce((n, r) => n + r.amount, 0);
    if (!(amount === 0 ? used < daily : used + amount <= daily)) return { ok: false, metric, used, limit: daily, resetAt: rows[0] ? new Date(Date.parse(rows[0].bucket) + DAY_MS + HOUR).toISOString() : null, plan: s.plan, daily: true };
  }
  return { ok: true };
}

export const METRIC_LABEL: Record<Metric, { ar: string; en: string }> = {
  tasks: { ar: "المهام", en: "Tasks" }, steps: { ar: "خطوات الوكيل", en: "Agent steps" }, tokens: { ar: "رموز النموذج", en: "Model tokens" },
  sandbox_minutes: { ar: "دقائق الحاسوب الافتراضي", en: "Sandbox minutes" }, research: { ar: "البحث العميق", en: "Deep research" }, schedules: { ar: "المهام المجدولة", en: "Scheduled tasks" },
};

/** The user-facing message when a limit is reached (Arabic; times in the user's zone). */
export function limitMessage(c: Exclude<LimitCheck, { ok: true }>, tz = "UTC"): string {
  // what a user sees: the plan name and when it frees up — never the internal meters (tokens, steps, machine minutes) or counts
  const when = c.resetAt ? new Intl.DateTimeFormat("ar-SY", { timeZone: tz, weekday: "long", hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" }).format(new Date(c.resetAt)) : "";
  if (c.daily) return `⏳ وصلت إلى الحد اليومي في خطة «${c.plan.name.ar}».` + (when ? ` يتجدد تدريجياً، وأول تجدّد: ${when}.` : "") + " يمكنك الترقية من قسم «الاشتراك» في التطبيق.";
  return c.metric === "schedules"
    ? `⏳ وصلت إلى عدد المهام المجدولة المسموح في خطة «${c.plan.name.ar}». احذف مهمة مجدولة أو رقِّ خطتك من قسم «الاشتراك».`
    : `⏳ وصلت إلى حد استخدامك الأسبوعي في خطة «${c.plan.name.ar}».` + (when ? ` يتجدد تدريجياً، وأول تجدّد: ${when}.` : "") + " يمكنك الترقية من قسم «الاشتراك» في التطبيق.";
}

/** The detailed (owner / log) form of a reached limit, with the meter and the counts. */
export function limitMessageDetailed(c: Exclude<LimitCheck, { ok: true }>, tz = "UTC"): string {
  const when = c.resetAt ? new Intl.DateTimeFormat("ar-SY", { timeZone: tz, weekday: "long", hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" }).format(new Date(c.resetAt)) : "";
  return `⏳ وصلت إلى حد ${METRIC_LABEL[c.metric].ar} الأسبوعي في خطة «${c.plan.name.ar}» (${c.used}/${c.limit}).` +
    (c.metric === "schedules" ? " احذف مهمة مجدولة أو رقِّ خطتك." : when ? ` يتجدد الاستخدام تدريجياً؛ أول تجدّد: ${when}.` : "") +
    " يمكنك الترقية من التطبيق.";
}

/** Rough token count of text (no tokenizer bundled: ~4 chars per token for code/English, ~2.5 for Arabic). */
export function estimateTokens(text: string): number {
  const s = text || "";
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  return Math.ceil(arabic / 2.5 + (s.length - arabic) / 4);
}

// ---------------------------------------------------------------- what a regular user may see of the plan (owner's rule, 2026-10-21)
// No meters by name, no counts of tokens / steps / machine minutes / tasks: the plan name, one overall "used" percentage of the
// week, when it starts freeing up, and the plans on sale with their Stars price. The owner keeps the full usageSummary.
export type PublicUsage = { plan: { id: string; name: { ar: string; en: string } }; unlimited: boolean; percent: number; level: "ok" | "high" | "full"; renewsAt: string | null; periodEnd: string | null };
export function publicUsage(s: UsageSummary): PublicUsage {
  let pct = 0;
  let renew: string | null = null;
  for (const m of s.metrics) {
    if (m.limit < 0) continue;
    const p = m.limit === 0 ? 100 : Math.min(100, Math.round((m.used / m.limit) * 100));
    if (p > pct) {
      pct = p;
      renew = m.nextRelief;
    }
  }
  if (s.unlimited) pct = 0;
  return {
    plan: { id: s.plan.id, name: s.plan.name }, unlimited: s.unlimited, percent: pct, level: pct >= 100 ? "full" : pct >= 80 ? "high" : "ok",
    renewsAt: pct > 0 ? renew : null, periodEnd: s.subscription.period_end,
  };
}
export type PublicPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars: number | null; days: number; current: boolean; tier: number };
export function publicPlans(plans: Plan[], currentId: string): PublicPlan[] {
  return plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, price_label: p.price_label, price_stars: p.price_stars ?? null, days: p.days ?? 30, current: p.id === currentId, tier: p.sort }));
}
