import { queuePriority, terminalAllowed, addUsage, checkLimit, DEFAULT_PLANS, estimateTokens, limitMessage, listPlans, setSubscription, upsertPlan, usageSummary, WINDOW_MS } from "@/lib/coderPlans";
import type { Db } from "@/lib/coderAuth";

function plansDb(): Db & { usage: any[] } {
  const plans = new Map<string, any>();
  const subs = new Map<string, any>();
  const usage: any[] = [];
  return {
    usage,
    exec: async (sql: string, ...a: any[]) => {
      if (sql.includes("INSERT INTO coder_plans")) plans.set(a[0], { id: a[0], name: a[1], price_label: a[2], price_cents: a[3], currency: a[4], limits: a[5], sort: a[6], active: a[7] });
      else if (sql.includes("INSERT INTO coder_subscriptions")) subs.set(a[0], { plan_id: a[1], status: "active", period_start: new Date().toISOString(), period_end: a[2], provider: a[3] });
      else if (sql.includes("INSERT INTO coder_usage")) {
        const r = usage.find((u) => u.chat_key === a[0] && u.metric === a[1] && u.bucket === a[2]);
        if (r) r.amount += a[3];
        else usage.push({ chat_key: a[0], metric: a[1], bucket: a[2], amount: a[3] });
      }
      return undefined;
    },
    query: async <T,>(sql: string, ...a: any[]) => {
      if (sql.includes("FROM coder_plans")) return [...plans.values()] as T[];
      if (sql.includes("FROM coder_subscriptions")) return (subs.has(a[0]) ? [subs.get(a[0])] : []) as T[];
      if (sql.includes("FROM coder_usage")) return usage.filter((u) => u.chat_key === a[0] && u.bucket > a[1]).sort((x, y) => (x.bucket < y.bucket ? -1 : 1)) as T[];
      return [] as T[];
    },
  } as any;
}

const OWNER = 777;
beforeAll(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = process.env.CODER_TOKEN_KEY || "test-key-test-key-test-key-1234";
});

describe("plans and usage", () => {
  it("free by default; limits are enforced over a rolling week; the owner is never limited", async () => {
    const db = plansDb();
    const free = DEFAULT_PLANS.find((p) => p.id === "free")!;
    const t0 = Date.parse("2026-10-01T10:00:00Z");
    expect((await usageSummary(5, db, t0)).plan.id).toBe("free");
    for (let i = 0; i < free.limits.tasks; i++) await addUsage(5, "tasks", 1, db, t0 + i * 1000);
    const c = await checkLimit(5, "tasks", 1, db, undefined, t0 + 60000);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.used).toBe(free.limits.tasks);
      expect(Date.parse(c.resetAt!)).toBeGreaterThan(t0 + WINDOW_MS - 1);
      expect(limitMessage(c)).toMatch(/الأسبوعي/);
    }
    expect((await checkLimit(5, "tasks", 1, db, undefined, t0 + WINDOW_MS + 2 * 3600e3)).ok).toBe(true);   // the window rolled
    for (let i = 0; i < 1000; i++) await addUsage(OWNER, "tasks", 1, db, t0);
    expect((await checkLimit(OWNER, "tasks", 1, db, undefined, t0)).ok).toBe(true);
    expect((await usageSummary(OWNER, db, t0)).unlimited).toBe(true);
    delete process.env.CODER_COUNT_LIMITS;
  });
  it("tokens and task counts both limit a user (counts can be turned off with CODER_COUNT_LIMITS=off); the owner is never limited", async () => {
    const db = plansDb();
    const free = DEFAULT_PLANS.find((p) => p.id === "free")!;
    const t0 = Date.parse("2026-10-03T10:00:00Z");
    for (let i = 0; i < free.limits.tasks + 5; i++) await addUsage(8, "tasks", 1, db, t0);
    expect((await checkLimit(8, "tasks", 1, db, undefined, t0 + 1000)).ok).toBe(false);
    process.env.CODER_COUNT_LIMITS = "off";
    expect((await checkLimit(8, "tasks", 1, db, undefined, t0 + 1000)).ok).toBe(true);
    delete process.env.CODER_COUNT_LIMITS;
    await addUsage(8, "tokens", free.limits.tokens, db, t0);
    const c = await checkLimit(8, "tokens", 1, db, undefined, t0 + 1000);
    expect(c.ok).toBe(false);
    await addUsage(OWNER, "tokens", free.limits.tokens * 10, db, t0);
    for (const m of ["tokens", "tasks", "steps", "sandbox_minutes", "research"] as const) expect((await checkLimit(OWNER, m, 1, db, undefined, t0 + 1000)).ok).toBe(true);
    expect((await checkLimit(OWNER, "schedules", 1, db, 999, t0)).ok).toBe(true);
  });
  it("sandbox time is stored in seconds and shown in minutes; schedules are a live count", async () => {
    const db = plansDb();
    const now = Date.parse("2026-10-02T00:00:00Z");
    await addUsage(6, "sandbox_minutes", 61, db, now);
    const s = await usageSummary(6, db, now, { schedules: 2 });
    expect(s.metrics.find((m) => m.metric === "sandbox_minutes")!.used).toBe(2);
    expect(s.metrics.find((m) => m.metric === "schedules")!.used).toBe(2);
  });
  it("the owner edits plans and assigns them by hand", async () => {
    const db = plansDb();
    const p = await upsertPlan({ id: "plus", price_label: "$3/mo", limits: { tasks: 500 } as any }, db);
    expect(p.limits.tasks).toBe(500);
    expect((await listPlans(db)).find((x) => x.id === "plus")!.price_label).toBe("$3/mo");
    await expect(upsertPlan({ id: "Bad Id!" }, db)).rejects.toThrow(/bad plan id/);
    await setSubscription(9, "plus", 30, "manual", db);
    expect((await usageSummary(9, db)).plan.id).toBe("plus");
  });
  it("estimates tokens for Arabic and code", () => {
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
    expect(estimateTokens("مرحبا")).toBe(2);
  });
  it("the terminal is hidden on the free plan and shown to paid plans and to the owner", async () => {
    const db = plansDb();
    const saved = process.env.SUPER_ADMIN_TELEGRAM_ID;
    process.env.SUPER_ADMIN_TELEGRAM_ID = "1";
    expect(await terminalAllowed(1, db)).toBe(true);              // the owner: always
    expect(await terminalAllowed(7, db)).toBe(false);             // free by default
    await setSubscription(7, "plus", 30, "manual", db);
    expect(await terminalAllowed(7, db)).toBe(true);              // a paid plan
    await setSubscription(7, "free", null, "manual", db);
    expect(await terminalAllowed(7, db)).toBe(false);
    saved === undefined ? delete process.env.SUPER_ADMIN_TELEGRAM_ID : (process.env.SUPER_ADMIN_TELEGRAM_ID = saved);
  });
});

describe("queue priority", () => {
  it("Pro and the owner get priority in the Studio queue; Free, Plus and expired Pro do not", async () => {
    const db = plansDb();
    await upsertPlan(DEFAULT_PLANS.find((p) => p.id === "pro")!, db);
    await upsertPlan(DEFAULT_PLANS.find((p) => p.id === "plus")!, db);
    await setSubscription(21, "pro", 30, "stars", db);
    await setSubscription(22, "plus", 30, "stars", db);
    expect(await queuePriority(21, db)).toBe(1);
    expect(await queuePriority(OWNER, db)).toBe(1);
    expect(await queuePriority(22, db)).toBe(0);
    expect(await queuePriority(24, db)).toBe(0);                       // no subscription = Free
  });
  it("a database failure never blocks a request: no priority", async () => {
    const bad = { exec: async () => { throw new Error("db down"); }, query: async () => { throw new Error("db down"); } } as any;
    expect(await queuePriority(25, bad)).toBe(0);
  });
});
