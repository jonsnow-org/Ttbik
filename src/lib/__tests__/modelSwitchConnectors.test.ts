// Connectors belong to the user, not to a model: linked once, they are there for Nova, Sham and Sham v2 the moment the user switches model.
import { appOp } from "@/lib/coderApp";
import { shamContext, shamTools, shamRunTool, shamNeedsOk } from "@/lib/shamExec";
import { connectedIds, connectorApi } from "@/lib/coderConnectors";
import { fakeBot, fakeDb } from "./coderFakes";

const OWNER = 4242;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const call = (name: string, args: object) => ({ id: "c1", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.CODER_GITHUB_TOKEN;
});

function vercelFetch(seen: { url: string; auth?: string; method?: string }[]) {
  return (async (url: string, init: any) => {
    seen.push({ url, auth: init?.headers?.Authorization, method: init?.method });
    if (url === "https://api.vercel.com/v2/user") return new Response(JSON.stringify({ user: { username: "ahmad" } }));
    return new Response(JSON.stringify({ projects: [{ name: "site" }] }), { status: 200 });
  }) as any;
}

describe("connectors follow the model switch", () => {
  it("a service linked once is available to Nova, Sham and Sham v2 right after each switch", async () => {
    const db = fakeDb(); const { bot } = fakeBot();
    const seen: any[] = [];
    const f = vercelFetch(seen);
    const d = { db, bot, botRow, fetchImpl: f };
    const o = { chatId: OWNER, tier: "owner" as const };
    await appOp(o, "connector_link", { id: "vercel", token: "vercel-token-ok-1" }, d);
    for (const model of ["coder", "sham_v2", "sham", "coder", "sham_v2"]) {
      await appOp(o, "settings", { model }, d);
      expect(await connectedIds(OWNER, db)).toContain("vercel");                                         // Nova's side
      const ctx = await shamContext(OWNER, "bot1", db as any);                                            // Sham's side (v1 and v2 share the executor)
      expect(ctx.connectors).toContain("vercel");
      const tools = shamTools(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)).map((t) => t.function.name);
      expect(tools).toEqual(expect.arrayContaining(["connector_api", "mcp_list_tools", "mcp_call"]));
    }
  });

  it("without any linked service Sham is not shown connector tools", async () => {
    const db = fakeDb();
    const ctx = await shamContext(OWNER, "bot1", db as any);
    expect(ctx.connectors).toEqual([]);
    expect(shamTools(false, false).map((t) => t.function.name)).not.toContain("connector_api");
  });

  it("Sham reads through the user's own token, exactly as Nova does, and a write waits for the user's tap", async () => {
    const db = fakeDb(); const { bot } = fakeBot();
    const seen: any[] = [];
    const f = vercelFetch(seen);
    await appOp({ chatId: OWNER, tier: "owner" }, "connector_link", { id: "vercel", token: "vercel-token-ok-1" }, { db, bot, botRow, fetchImpl: f });
    seen.length = 0;
    const ctx = { ...(await shamContext(OWNER, "bot1", db as any)), fetchImpl: f };
    const r = await shamRunTool(call("connector_api", { service: "vercel", path: "v9/projects" }), ctx as any);
    expect(r).toMatch(/HTTP 200/); expect(r).toMatch(/site/);
    const viaNova = await connectorApi(OWNER, { service: "vercel", path: "v9/projects" }, db as any, f);
    expect(viaNova).toBe(r);                                                                             // the same answer from either model's tool
    expect(seen.map((s) => s.auth)).toEqual(["Bearer vercel-token-ok-1", "Bearer vercel-token-ok-1"]);
    expect(shamNeedsOk(call("connector_api", { service: "vercel", path: "v9/projects" }))).toBe(false);
    expect(shamNeedsOk(call("connector_api", { service: "vercel", method: "DELETE", path: "v9/projects/x" }))).toBe(true);
    expect(shamNeedsOk(call("mcp_call", { server: "mcp:ab", tool: "t" }))).toBe(true);
    expect(await shamRunTool(call("mcp_call", { server: "mcp:ab", tool: "t" }), ctx as any)).toMatch(/runs only after the user taps/);   // never run on the model's word alone
  });

  it("a connector the user unlinks is gone for every model", async () => {
    const db = fakeDb(); const { bot } = fakeBot();
    const f = vercelFetch([]);
    const d = { db, bot, botRow, fetchImpl: f };
    await appOp({ chatId: OWNER, tier: "owner" }, "connector_link", { id: "vercel", token: "vercel-token-ok-1" }, d);
    await appOp({ chatId: OWNER, tier: "owner" }, "connector_disconnect", { id: "vercel" }, d).catch(() => null);
    const ctx = await shamContext(OWNER, "bot1", db as any);
    expect(ctx.connectors).not.toContain("vercel");
  });
});
