import { createHash } from "crypto";
import type { Db } from "@/lib/coderAuth";
import { DEFAULT_PLANS, publicPlans, publicUsage, upsertPlan, usageSummary, getSubscription, limitMessage } from "@/lib/coderPlans";
import { parseStarsPayload, preCheckoutCoder, recordCoderPayment, starsPayload } from "@/lib/coderStars";
import { callbackUrl, CONNECTORS, connectorStartUrl, disconnectConnector, finishConnector, isReadOnlyCall, listConnectors, pkceChallenge, pkceVerifier, signConnectorState, verifyConnectorState } from "@/lib/coderConnectors";

function memDb(): Db & { conns: any[]; pays: Set<string> } {
  const plans = new Map<string, any>();
  const subs = new Map<string, any>();
  const conns: any[] = [];
  const pays = new Set<string>();
  return {
    conns, pays,
    exec: async (sql: string, ...a: any[]) => {
      if (sql.includes("INSERT INTO coder_plans")) plans.set(a[0], { ...(plans.get(a[0]) || {}), id: a[0], name: a[1], price_label: a[2], price_cents: a[3], currency: a[4], limits: a[5], sort: a[6], active: a[7] });
      else if (sql.includes("UPDATE coder_plans SET price_stars")) Object.assign(plans.get(a[0]) || {}, { price_stars: a[1], days: a[2] });
      else if (sql.includes("INSERT INTO coder_subscriptions")) subs.set(a[0], { plan_id: a[1], status: "active", period_start: new Date().toISOString(), period_end: a[2], provider: a[3] });
      else if (sql.includes("INSERT INTO coder_connections")) {
        const i = conns.findIndex((c) => c.chat_key === a[0] && c.provider === a[1]);
        if (i >= 0) conns.splice(i, 1);
        conns.push({ chat_key: a[0], provider: a[1], token_enc: a[2], login: a[3] });
      } else if (sql.includes("DELETE FROM coder_connections")) {
        const i = conns.findIndex((c) => c.chat_key === a[0] && c.provider === a[1]);
        if (i >= 0) conns.splice(i, 1);
      }
      return undefined;
    },
    query: async <T,>(sql: string, ...a: any[]) => {
      if (sql.includes("FROM coder_plans")) return [...plans.values()] as T[];
      if (sql.includes("FROM coder_subscriptions")) return (subs.has(a[0]) ? [subs.get(a[0])] : []) as T[];
      if (sql.includes("INSERT INTO coder_payments")) {
        if (pays.has(a[0])) return [] as T[];
        pays.add(a[0]);
        return [{ charge_id: a[0] }] as T[];
      }
      if (sql.includes("FROM coder_connections")) return conns.filter((c) => c.chat_key === a[0]) as T[];
      return [] as T[];
    },
  } as any;
}

const OWNER = 4242;
const USER = 9001;
beforeEach(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key-test-key-test-key-1234";
  process.env.CODER_OAUTH_BASE_URL = "https://site.test";
  for (const c of CONNECTORS) for (const k of [c.env.id, c.env.secret]) delete process.env[k];
});

describe("what a user sees about the plan", () => {
  it("one percentage and a level, no metric names or numbers", async () => {
    const db = memDb();
    const pub = publicUsage(await usageSummary(USER, db));
    expect(Object.keys(pub).sort()).toEqual(["level", "percent", "periodEnd", "plan", "renewsAt", "unlimited"]);
    expect(JSON.stringify(pub)).not.toMatch(/token|sandbox|steps|minutes|"limits?"|"used"/i);
    const plans = publicPlans(DEFAULT_PLANS, "free");
    expect(plans.find((p) => p.current)?.id).toBe("free");
    for (const p of plans) expect((p as any).limits).toBeUndefined();
  });
  it("the limit message has no counters", () => {
    const m = limitMessage({ ok: false, metric: "tokens", used: 123456, limit: 100000, resetAt: null, plan: DEFAULT_PLANS[0] });
    expect(m).not.toMatch(/123456|100000|token|توكن/i);
  });
});

describe("Telegram Stars", () => {
  it("signed payload: parse, tamper, pre-checkout and an idempotent activation", async () => {
    const db = memDb();
    const plus = (await upsertPlan({ id: "plus", price_stars: 250, days: 30 }, db));
    const pl = starsPayload(USER, plus);
    expect(parseStarsPayload(pl)).toEqual({ planId: "plus", days: 30, stars: 250, chatId: USER });
    expect(parseStarsPayload(pl.replace(":250:", ":1:"))).toBeNull();
    expect(await preCheckoutCoder({ from: { id: USER }, currency: "XTR", total_amount: 250, invoice_payload: pl }, db)).toEqual({ ok: true });
    expect((await preCheckoutCoder({ from: { id: 1 }, currency: "XTR", total_amount: 250, invoice_payload: pl }, db)).ok).toBe(false);
    expect((await preCheckoutCoder({ from: { id: USER }, currency: "USD", total_amount: 250, invoice_payload: pl }, db)).ok).toBe(false);
    await upsertPlan({ id: "plus", price_stars: 300 }, db);
    expect((await preCheckoutCoder({ from: { id: USER }, currency: "XTR", total_amount: 250, invoice_payload: pl }, db)).ok).toBe(false);
    const sp = { currency: "XTR", total_amount: 250, invoice_payload: pl, telegram_payment_charge_id: "ch1" };
    const r1 = await recordCoderPayment(USER, sp, db);
    expect(r1?.duplicate).toBe(false);
    expect((await getSubscription(USER, db)).plan_id).toBe("plus");
    expect((await recordCoderPayment(USER, sp, db))?.duplicate).toBe(true);
    expect(await recordCoderPayment(OWNER, { ...sp, telegram_payment_charge_id: "ch2" }, db)).toBeNull();
  });
});

describe("connectors", () => {
  it("missing app keys → «soon»; set keys → available", async () => {
    const db = memDb();
    let l = await listConnectors(USER, {}, db);
    expect(l.every((c) => c.status === "soon")).toBe(true);
    process.env.CODER_NOTION_CLIENT_ID = "nid";
    process.env.CODER_NOTION_CLIENT_SECRET = "nsec";
    l = await listConnectors(USER, {}, db);
    expect(l.find((c) => c.id === "notion")?.status).toBe("available");
    expect(callbackUrl("notion")).toBe("https://site.test/api/coder/app/connectors/notion/callback");
  });
  it("state is signed, bound to the user and the service, and expires; PKCE challenge is S256 of the verifier", () => {
    const s = signConnectorState(USER, "vercel");
    expect(verifyConnectorState(s, "vercel")).toBe(USER);
    expect(verifyConnectorState(s, "notion")).toBeNull();
    expect(verifyConnectorState(s.replace(/.$/, (c) => (c === "a" ? "b" : "a")), "vercel")).toBeNull();
    expect(verifyConnectorState(s, "vercel", Date.now() + 16 * 60000)).toBeNull();
    const v = pkceVerifier(s);
    expect(pkceChallenge(v)).toBe(createHash("sha256").update(v).digest("base64url"));
  });
  it("full OAuth leg with PKCE: start URL, code exchange, encrypted storage, disconnect", async () => {
    process.env.CODER_VERCEL_CLIENT_ID = "vid";
    process.env.CODER_VERCEL_CLIENT_SECRET = "vsec";
    const db = memDb();
    const u = new URL(connectorStartUrl(USER, "vercel"));
    expect(u.searchParams.get("redirect_uri")).toBe("https://site.test/api/coder/app/connectors/vercel/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const state = u.searchParams.get("state")!;
    const sent: any[] = [];
    const f: any = jest.fn(async (url: string, init?: any) => {
      sent.push({ url, init });
      if (/token$/.test(url) && init?.method === "POST") return { ok: true, json: async () => ({ access_token: "secret-access", refresh_token: "r", expires_in: 3600 }) };
      return { ok: true, json: async () => ({ email: "me@x.test", name: "Me" }), text: async () => "" };
    });
    const r = await finishConnector("vercel", "the-code", state, db, f);
    expect(r.chatId).toBe(USER);
    const tokenCall = sent.find((s) => s.init?.method === "POST");
    expect(String(tokenCall.init.body)).toContain("code_verifier=");
    expect(db.conns).toHaveLength(1);
    expect(db.conns[0].token_enc).not.toContain("secret-access");
    expect((await listConnectors(USER, {}, db)).find((c) => c.id === "vercel")?.status).toBe("connected");
    await disconnectConnector(USER, "vercel", db, f);
    expect(db.conns).toHaveLength(0);
    await expect(finishConnector("vercel", "c", "forged.state", db, f)).rejects.toThrow();
  });
  it("read vs write calls (writes go through the confirmation policy)", () => {
    expect(isReadOnlyCall("GET", "https://api.notion.com/v1/pages/x")).toBe(true);
    expect(isReadOnlyCall("POST", "https://api.notion.com/v1/search")).toBe(true);
    expect(isReadOnlyCall("PATCH", "https://api.notion.com/v1/pages/x")).toBe(false);
  });
});
