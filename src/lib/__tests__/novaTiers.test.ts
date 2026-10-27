// Nova's plan table (Free / Plus / Pro), the Free daily cap, and proof that the OWNER is never limited — in Nova, Sham and Sham v2.
import { addUsage, checkLimit, DEFAULT_PLANS, limitMessage, listPlans, METRICS, setSubscription, usageSummary, publicUsage } from "@/lib/coderPlans";
import { shamRunTool, type ShamCtx } from "@/lib/shamExec";
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


const OWNER = 777, USER = 31;
beforeAll(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = process.env.CODER_TOKEN_KEY || "test-key-test-key-test-key-1234";
  delete process.env.CODER_COUNT_LIMITS;
});
const plan = (id: string) => DEFAULT_PLANS.find((p) => p.id === id)!;
const T0 = Date.parse("2026-10-28T10:00:00Z");

describe("the plan table", () => {
  it("Free: 120k tokens/week, 25k/day, 8 tasks, 250 steps, 15 sandbox min, 3 research, 1 schedule", () => {
    const f = plan("free");
    expect(f.limits).toEqual({ tasks: 8, steps: 250, tokens: 120_000, sandbox_minutes: 15, research: 3, schedules: 1 });
    expect(f.daily_tokens).toBe(25_000);
    expect(f.daily_tokens!).toBeLessThanOrEqual(f.limits.tokens);                     // the daily cap never exceeds the weekly one
  });
  it("Plus: 250 stars / 30 days, 750k/week, 40 tasks, 1500 steps, 120 sandbox min, 20 research, 5 schedules", () => {
    const p = plan("plus");
    expect([p.price_stars, p.days]).toEqual([250, 30]);
    expect(p.limits).toEqual({ tasks: 40, steps: 1500, tokens: 750_000, sandbox_minutes: 120, research: 20, schedules: 5 });
    expect(p.daily_tokens ?? null).toBeNull();
  });
  it("Pro: 750 stars / 30 days, 1.5M/week, 120 tasks, 5000 steps, 400 sandbox min, 60 research, 15 schedules", () => {
    const p = plan("pro");
    expect([p.price_stars, p.days]).toEqual([750, 30]);
    expect(p.limits).toEqual({ tasks: 120, steps: 5000, tokens: 1_500_000, sandbox_minutes: 400, research: 60, schedules: 15 });
  });
  it("listPlans serves the defaults when nothing is stored", async () => {
    const l = await listPlans(plansDb());
    expect(l.map((p) => p.id)).toEqual(["free", "plus", "pro"]);
    expect(l[0].daily_tokens).toBe(25_000);
  });
});

describe("Free daily token cap", () => {
  it("25k in the last 24 h blocks more tokens (weekly still has room); it frees up after a day", async () => {
    const db = plansDb();
    await addUsage(USER, "tokens", 24_000, db, T0);
    expect((await checkLimit(USER, "tokens", 1000, db, undefined, T0 + 60_000)).ok).toBe(true);        // exactly at 25k is allowed
    const c = await checkLimit(USER, "tokens", 1001, db, undefined, T0 + 60_000);
    expect(c.ok).toBe(false);
    if (!c.ok) { expect(c.daily).toBe(true); expect(c.limit).toBe(25_000); expect(limitMessage(c)).toMatch(/اليومي/); expect(c.resetAt).toBeTruthy(); }
    expect((await checkLimit(USER, "tokens", 1001, db, undefined, T0 + 25 * 3600e3)).ok).toBe(true);    // 25 h later the day window has rolled
  });
  it("the weekly cap (120k) still applies across days", async () => {
    const db = plansDb();
    for (let d = 0; d < 5; d++) await addUsage(USER, "tokens", 24_000, db, T0 - d * 26 * 3600e3);       // 120k over five different days
    const c = await checkLimit(USER, "tokens", 1000, db, undefined, T0 + 1000);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.daily).toBeUndefined();
  });
  it("Plus and Pro have no daily cap, only the weekly allowance", async () => {
    const db = plansDb();
    await setSubscription(USER, "plus", 30, "stars", db);
    await addUsage(USER, "tokens", 300_000, db, T0);
    expect((await checkLimit(USER, "tokens", 1000, db, undefined, T0 + 1000)).ok).toBe(true);
    await addUsage(USER, "tokens", 450_000, db, T0);
    expect((await checkLimit(USER, "tokens", 1000, db, undefined, T0 + 1000)).ok).toBe(false);          // 750k reached
  });
  it("task and step counts are enforced by default (Free: 8 tasks, 250 steps)", async () => {
    const db = plansDb();
    await addUsage(USER, "tasks", 8, db, T0);
    expect((await checkLimit(USER, "tasks", 1, db, undefined, T0 + 1000)).ok).toBe(false);
    await addUsage(USER, "steps", 250, db, T0);
    expect((await checkLimit(USER, "steps", 1, db, undefined, T0 + 1000)).ok).toBe(false);
  });
});

describe("the owner is never limited", () => {
  const huge = async (db: Db, who: number) => { for (const m of METRICS) await addUsage(who, m, 10_000_000, db, T0); };
  it("Nova: every metric passes however much the owner used, including the daily cap, for any plan", async () => {
    const db = plansDb();
    await huge(db, OWNER);
    for (const planId of ["free", "plus", "pro"]) {
      await setSubscription(OWNER, planId, 30, "x", db);
      for (const m of METRICS) expect((await checkLimit(OWNER, m, 1_000_000, db, 999, T0 + 1000)).ok).toBe(true);
    }
    const s = await usageSummary(OWNER, db, T0 + 1000);
    expect(s.unlimited).toBe(true);
    expect(s.metrics.every((m) => m.limit === -1)).toBe(true);
    expect(publicUsage(s)).toMatchObject({ unlimited: true, percent: 0, level: "ok" });
  });
  it("the same usage does limit an ordinary user (control)", async () => {
    const db = plansDb();
    await huge(db, USER);
    for (const m of METRICS) expect((await checkLimit(USER, m, 1, db, 999, T0 + 1000)).ok).toBe(false);
  });
  const ctx = (who: number, db: Db): ShamCtx => ({ chatId: who, db, githubToken: null, chatKey: `sham:${who}`, runId: `r${who}`, owner: who === OWNER, fetchImpl: (async () => new Response("{}", { status: 500 })) as any });
  it("Sham and Sham v2 share one tool executor: the owner's research is never blocked, an ordinary user's is", async () => {
    const db = plansDb();
    await huge(db, OWNER); await huge(db, USER);
    const call = { id: "1", type: "function" as const, function: { name: "deep_research", arguments: JSON.stringify({ question: "what is rust" }) } };
    const owner = await shamRunTool(call, ctx(OWNER, db));
    const user = await shamRunTool(call, ctx(USER, db));
    expect(owner).not.toMatch(/allowance is used up/);
    expect(user).toMatch(/allowance is used up/);
  });
});
