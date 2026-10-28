import { createHash } from "crypto";
import type { Db } from "@/lib/coderAuth";
import { DEFAULT_PLANS, publicPlans, publicUsage, upsertPlan, usageSummary, getSubscription, limitMessage } from "@/lib/coderPlans";
import { parseStarsPayload, preCheckoutCoder, recordCoderPayment, starsPayload } from "@/lib/coderStars";
import { callbackUrl, CONNECTORS, connectorApi, connectorStartUrl, disconnectConnector, finishConnector, isReadOnlyCall, linkWithToken, listConnectors, pkceChallenge, pkceVerifier, signConnectorState, testConnector, verifyConnectorState } from "@/lib/coderConnectors";

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
  it("no app keys: services with a personal-token option are offered, Google (OAuth only) is «setup»; set keys → sign-in works too", async () => {
    const db = memDb();
    let l = await listConnectors(USER, {}, db);
    expect(l.map((c) => [c.id, c.status, c.oauth])).toEqual([
      ["github", "available", false], ["google_drive", "setup", false], ["google_calendar", "setup", false], ["gmail", "setup", false], ["notion", "available", false],
      ["vercel", "available", false], ["supabase", "available", false], ["slack", "available", false], ["discord", "available", false], ["gitlab", "available", false],
    ]);
    expect(l.find((c) => c.id === "notion")?.token?.create).toMatch(/^https:\/\//);
    expect(JSON.stringify(l)).not.toMatch(/soon/);
    process.env.CODER_NOTION_CLIENT_ID = "nid";
    process.env.CODER_NOTION_CLIENT_SECRET = "nsec";
    l = await listConnectors(USER, {}, db);
    expect(l.find((c) => c.id === "notion")).toMatchObject({ status: "available", oauth: true });
    expect(callbackUrl("notion")).toBe("https://site.test/api/coder/app/connectors/notion/callback");
  });
  it("linking with a personal token: checked with the service first, stored encrypted, usable by connector_api, Discord with the Bot scheme", async () => {
    const db = memDb();
    const seen: { url: string; auth: string }[] = [];
    const f = (async (url: string, init: any) => {
      const auth = String(init?.headers?.Authorization || "");
      seen.push({ url, auth });
      if (url === "https://api.notion.com/v1/users/me") return new Response(JSON.stringify(auth === "Bearer ntn_good_token_123" ? { bot: { workspace_name: "فريقي" } } : {}), { status: auth === "Bearer ntn_good_token_123" ? 200 : 401 });
      if (url === "https://discord.com/api/users/@me") return new Response(JSON.stringify({ username: "nova-bot" }), { status: auth === "Bot discord.token.value" ? 200 : 401 });
      return new Response("{}", { status: 200 });
    }) as any;
    await expect(linkWithToken(USER, "notion", "ntn_bad_token_12345", db, f)).rejects.toThrow(/rejected/);
    await expect(linkWithToken(USER, "notion", "short", db, f)).rejects.toThrow(/does not look/);
    await expect(linkWithToken(USER, "gmail", "x".repeat(20), db, f)).rejects.toThrow(/cannot be linked/);
    expect((await listConnectors(USER, {}, db)).find((c) => c.id === "notion")?.status).toBe("available");   // a rejected token stores nothing
    expect(await linkWithToken(USER, "notion", "ntn_good_token_123", db, f)).toEqual({ label: "فريقي" });
    const l = await listConnectors(USER, {}, db);
    expect(l.find((c) => c.id === "notion")).toMatchObject({ status: "connected", label: "فريقي", source: "user-link" });
    expect(JSON.stringify(l)).not.toContain("ntn_good_token_123");
    await linkWithToken(USER, "discord", "discord.token.value", db, f);
    seen.length = 0;
    await connectorApi(USER, { service: "discord", path: "users/@me/guilds" }, db, f);
    expect(seen[0].auth).toBe("Bot discord.token.value");                                                // the stored scheme is used for API calls
    await disconnectConnector(USER, "notion", db, f);
    expect((await listConnectors(USER, {}, db)).find((c) => c.id === "notion")?.status).toBe("available");
  });
  it("Calendar needs the owner's Google app (setup until then); GitLab can be linked with a personal token at once and signs in once its app exists", async () => {
    const db = memDb();
    let list = await listConnectors(USER, {}, db);
    expect(list.find((c) => c.id === "google_calendar")).toMatchObject({ status: "setup", oauth: false });
    expect(list.find((c) => c.id === "gitlab")).toMatchObject({ status: "available", oauth: false });
    expect(list.find((c) => c.id === "gitlab")?.token?.create).toMatch(/^https:\/\/gitlab\.com\//);
    process.env.CODER_GOOGLE_CLIENT_ID = "gid";
    process.env.CODER_GOOGLE_CLIENT_SECRET = "gsec";
    process.env.CODER_GITLAB_CLIENT_ID = "lid";
    process.env.CODER_GITLAB_CLIENT_SECRET = "lsec";
    list = await listConnectors(USER, {}, db);
    expect(list.find((c) => c.id === "google_calendar")).toMatchObject({ status: "available", oauth: true });
    expect(list.find((c) => c.id === "gitlab")).toMatchObject({ status: "available", oauth: true });
    expect(CONNECTORS.find((c) => c.id === "github")?.scope).toContain("admin:repo_hook");        // the schedule webhooks need it
  });
  it("links GitLab with a personal token, checked against the live identity endpoint", async () => {
    const db = memDb();
    const f: any = jest.fn(async (url: string, init?: any) => (url === "https://gitlab.com/api/v4/user" && init?.headers?.Authorization === "Bearer glpat-good-token-1" ? new Response(JSON.stringify({ username: "alice" })) : new Response("{}", { status: 401 })));
    await expect(linkWithToken(USER, "gitlab", "glpat-bad-token-123", db, f)).rejects.toThrow(/rejected/);
    expect(await linkWithToken(USER, "gitlab", "glpat-good-token-1", db, f)).toEqual({ label: "alice" });
  });
  it("validates a linked GitLab credential against its live identity endpoint", async () => {
    process.env.CODER_GITLAB_CLIENT_ID = "lid";
    process.env.CODER_GITLAB_CLIENT_SECRET = "lsec";
    const db = memDb();
    const u = new URL(connectorStartUrl(USER, "gitlab"));
    const f: any = jest.fn(async (url: string, init?: any) => {
      if (url === "https://gitlab.com/oauth/token" && init?.method === "POST") return { ok: true, json: async () => ({ access_token: "gitlab-secret", token_type: "Bearer", expires_in: 3600 }) };
      if (url === "https://gitlab.com/api/v4/user") return { ok: true, json: async () => ({ username: "alice" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    await finishConnector("gitlab", "code", u.searchParams.get("state")!, db, f);
    expect(await testConnector(USER, "gitlab", {}, db, f)).toEqual({ ok: true, label: "alice", message: "الاتصال سليم: alice" });
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

describe("groq: prefer the model known to work in production", () => {
  it("404 model_not_found is remembered; the next call goes straight to a working model", async () => {
    jest.resetModules();
    process.env.GROQ_API_KEY = "k";
    const { callGroq, groqSkipped } = await import("@/lib/groq");
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (_u: string, init: any) => {
      const m = JSON.parse(init.body).model;
      seen.push(m);
      if (!m.startsWith("openai/")) return { ok: false, status: 404, text: async () => '{"error":{"code":"model_not_found"}}' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    });
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await callGroq("s", "u", 50)).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(groqSkipped()).toHaveLength(0);
    seen.length = 0;
    expect(await callGroq("s", "u", 50)).toBe("ok");
    expect(seen).toEqual(["openai/gpt-oss-120b"]);
    err.mockRestore();
  });
});
