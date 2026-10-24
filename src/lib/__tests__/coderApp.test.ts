import { appOp, AppError, oauthStartUrl, signState, verifyState } from "@/lib/coderApp";
import { drive, loadState, saveState } from "@/lib/coderSections";
import { fakeBot, fakeDb } from "./coderFakes";

const OWNER = 4242;
const USER = 9001;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.CODER_GITHUB_CLIENT_ID;
  delete process.env.CODER_GITHUB_CLIENT_SECRET;
});

describe("mini app api", () => {
  it("me: tier, settings, connections (never a token), policy categories with tier defaults", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const me = await appOp({ chatId: OWNER, tier: "owner" }, "me", {}, { db, bot, botRow });
    expect(me.tier).toBe("owner");
    expect(me.connections.github).toEqual({ linked: true, login: undefined, source: "owner-env" });
    expect(JSON.stringify(me)).not.toContain('"gh"');
    expect(me.prefs.categories.find((c: any) => c.id === "settings").tierDefault).toBe("run");
    const u = await appOp({ chatId: USER, tier: "user" }, "me", {}, { db, bot, botRow });
    expect(u.connections.github.linked).toBe(false);
    expect(u.prefs.categories.every((c: any) => c.tierDefault === "ask")).toBe(true);
  });

  it("settings are validated and saved", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    await appOp({ chatId: USER, tier: "user" }, "settings", { think: true, lang: "en", tz: "Europe/Istanbul", repo: "o/r" }, { db, bot, botRow });
    let st = await loadState(USER, db);
    expect([st.mode, st.think, st.lang, st.tz, st.repo]).toEqual(["coder", true, "en", "Europe/Istanbul", "o/r"]);
    // Sham and Nova Pro belong to the owner: a user cannot pick them (one picker, checked on the server)
    await expect(appOp({ chatId: USER, tier: "user" }, "settings", { model: "sham" }, { db, bot, botRow })).rejects.toBeInstanceOf(AppError);
    await expect(appOp({ chatId: USER, tier: "user" }, "settings", { model: "nova_pro" }, { db, bot, botRow })).rejects.toBeInstanceOf(AppError);
    await appOp({ chatId: USER, tier: "user" }, "settings", { tz: "Mars/Base", repo: "not a repo" }, { db, bot, botRow });
    st = await loadState(USER, db);
    expect([st.mode, st.tz, st.repo]).toEqual(["coder", "Europe/Istanbul", "o/r"]);
    // the owner's pick is the single switch: choosing Sham moves the section with it, choosing Nova AI moves it back
    await appOp({ chatId: OWNER, tier: "owner" }, "settings", { model: "sham" }, { db, bot, botRow });
    expect([(await loadState(OWNER, db)).mode, (await loadState(OWNER, db)).model]).toEqual(["sham", "sham"]);
    await appOp({ chatId: OWNER, tier: "owner" }, "settings", { model: "coder" }, { db, bot, botRow });
    expect([(await loadState(OWNER, db)).mode, (await loadState(OWNER, db)).model]).toEqual(["coder", "coder"]);
    // Nova Pro cannot be chosen before it is set up (no silent fallback to another model)
    delete process.env.NOVA_PRO_MODEL;
    await expect(appOp({ chatId: OWNER, tier: "owner" }, "settings", { model: "nova_pro" }, { db, bot, botRow })).rejects.toBeInstanceOf(AppError);
    process.env.NOVA_PRO_MODEL = "Qwen/Qwen3.5-397B-A17B";
    await appOp({ chatId: OWNER, tier: "owner" }, "settings", { model: "nova_pro" }, { db, bot, botRow });
    expect((await loadState(OWNER, db)).model).toBe("nova_pro");
    delete process.env.NOVA_PRO_MODEL;
  });

  it("policy rules: set, scope, reset", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const d = { db, bot, botRow };
    await appOp({ chatId: USER, tier: "user" }, "pref", { category: "delete", policy: "allow" }, d);
    const r = await appOp({ chatId: USER, tier: "user" }, "pref", { category: "deploy", policy: "deny", repo: "o/site", context: "scheduled" }, d);
    expect(r.rules).toEqual(expect.arrayContaining([expect.objectContaining({ category: "delete", policy: "allow", repo: "*" }), expect.objectContaining({ category: "deploy", repo: "o/site", context: "scheduled", policy: "deny" })]));
    const r2 = await appOp({ chatId: USER, tier: "user" }, "pref", { category: "delete", policy: "default" }, d);
    expect(r2.rules.some((x: any) => x.category === "delete")).toBe(false);
    await expect(appOp({ chatId: USER, tier: "user" }, "pref", { category: "nope", policy: "allow" }, d)).rejects.toBeInstanceOf(AppError);
  });

  it("tasks list shows the pending card, and approving from the app runs it (same nonce as the chat buttons)", async () => {
    const calls: string[] = [];
    let i = 0;
    const replies = [
      { type: "done", job: "j1", text: "", tool_calls: [{ id: "d", type: "function", function: { name: "github_delete_branch", arguments: JSON.stringify({ repo: "a/b", branch: "old" }) } }] },
      { type: "done", job: "j2", text: "حُذف.", tool_calls: [] },
    ];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse(replies[Math.min(i++, 1)]), { status: 200 });
      return new Response("{}", { status: url.includes("refs/heads/old") ? 204 : 202 });
    });
    const db = fakeDb();
    const { bot, api } = fakeBot();
    const { handleCoderSections } = await import("@/lib/coderSections");
    await handleCoderSections(bot, botRow, { message: { chat: { id: OWNER }, text: "احذف الفرع old" } }, db);
    await new Promise((r) => setTimeout(r, 400));
    const list = await appOp({ chatId: OWNER, tier: "owner" }, "tasks", {}, { db, bot, botRow });
    expect(list.tasks[0]).toMatchObject({ status: "waiting", title: "احذف الفرع old" });
    expect(list.pending).toHaveLength(1);
    const p = list.pending[0];
    expect(p).toMatchObject({ tool: "github_delete_branch", reason: "حذف", slot: "" });
    const ev = await appOp({ chatId: OWNER, tier: "owner" }, "events", { runId: p.runId }, { db, bot, botRow });
    expect(ev.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["start", "confirm"]));
    expect((await appOp({ chatId: OWNER, tier: "owner" }, "resolve", { runId: p.runId, nonce: p.nonce, answer: "yes" }, { db, bot, botRow })).ok).toBe(true);
    expect(api.editMessageReplyMarkup).toHaveBeenCalled();                       // the chat's buttons are cleared too
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.some((c) => c.startsWith("DELETE") && c.endsWith("refs/heads/old"))).toBe(true);
    expect((await appOp({ chatId: OWNER, tier: "owner" }, "tasks", {}, { db, bot, botRow })).pending).toHaveLength(0);
    // another user cannot see or answer it
    expect((await appOp({ chatId: USER, tier: "user" }, "tasks", {}, { db, bot, botRow })).tasks).toHaveLength(0);
  });

  it("schedules from the app: create, pause, delete only with confirm:true", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const d = { db, bot, botRow };
    const c = await appOp({ chatId: USER, tier: "user" }, "schedule_create", { kind: "cron", title: "تقرير", prompt: "لخّص التغييرات", recurrence: "weekly mon,thu 09:30", tz: "Europe/Istanbul" }, d);
    expect(c.schedule.cron).toBe("30 9 * * 1,4");
    expect(c.schedule.chat_enc).toBeUndefined();                                  // never sent to the browser
    expect(c.schedule.describe).toMatch(/أسبوعياً/);
    const id = c.schedule.id;
    expect((await appOp({ chatId: USER, tier: "user" }, "schedule_pause", { id, paused: true }, d)).schedule.paused).toBe(true);
    expect((await appOp({ chatId: USER, tier: "user" }, "schedule_delete", { id }, d)).result).toBe("confirm");
    await expect(appOp({ chatId: OWNER, tier: "owner" }, "schedule_delete", { id, confirm: true }, d)).rejects.toMatchObject({ status: 404 });
    expect((await appOp({ chatId: USER, tier: "user" }, "schedule_delete", { id, confirm: true }, d)).result).toBe("deleted");
    await expect(appOp({ chatId: USER, tier: "user" }, "schedule_create", { kind: "cron", prompt: "x", recurrence: "daily 30:00" }, d)).rejects.toMatchObject({ status: 400 });
  });

  it("GitHub: pasted tokens are checked with GitHub and stored encrypted; OAuth state is signed and expires", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const f = (async (url: string) => (url === "https://api.github.com/user" ? new Response(JSON.stringify({ login: "octo" }), { status: 200 }) : new Response("{}", { status: 404 }))) as any;
    await expect(appOp({ chatId: USER, tier: "user" }, "github_token", { token: "hello" }, { db, bot, botRow, fetchImpl: f })).rejects.toMatchObject({ status: 400 });
    const r = await appOp({ chatId: USER, tier: "user" }, "github_token", { token: "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123" }, { db, bot, botRow, fetchImpl: f });
    expect(r).toEqual({ ok: true, login: "octo" });
    await expect(appOp({ chatId: USER, tier: "user" }, "github_start", {}, { db, bot, botRow })).rejects.toMatchObject({ status: 400 });   // OAuth app not configured
    process.env.CODER_GITHUB_CLIENT_ID = "cid";
    process.env.CODER_GITHUB_CLIENT_SECRET = "sec";
    const url = new URL(oauthStartUrl(USER, "https://site/cb"));
    expect(url.searchParams.get("scope")).toBe("repo workflow admin:repo_hook read:user");
    expect(verifyState(url.searchParams.get("state")!)).toBe(USER);
    const st = signState(USER, Date.now() - 20 * 60000);
    expect(verifyState(st)).toBeNull();                                           // expired
    expect(verifyState(url.searchParams.get("state")!.replace(/^\d+/, "1"))).toBeNull();   // tampered
  });

  it("unknown ops are rejected", async () => {
    const { bot } = fakeBot();
    await expect(appOp({ chatId: USER, tier: "user" }, "drop_tables", {}, { db: fakeDb(), bot, botRow })).rejects.toMatchObject({ status: 404 });
    void drive; void saveState;
  });
});

describe("ready-made MCP servers", () => {
  it("lists the catalog, adds one in a tap, needs a token only where the server does, and shows what is added", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const ctx = { db, bot, botRow, fetchImpl: (async () => new Response("{}")) as any };
    const u = { chatId: USER, tier: "user" as const };
    const first = await appOp(u, "connectors", {}, ctx);
    expect(first.presets.map((p: any) => p.id)).toEqual(expect.arrayContaining(["deepwiki", "context7", "mslearn", "github-mcp"]));
    expect(first.presets.every((p: any) => p.added === false)).toBe(true);
    expect(JSON.stringify(first.presets)).not.toMatch(/https:\/\//);                       // the catalog view carries no address or secret
    await expect(appOp(u, "mcp_add", { preset: "nope" }, ctx)).rejects.toBeInstanceOf(AppError);
    await expect(appOp(u, "mcp_add", { preset: "github-mcp" }, ctx)).rejects.toMatchObject({ status: 400 });   // token required
    await appOp(u, "mcp_add", { preset: "deepwiki", url: "https://evil.example/mcp" }, ctx);                    // the preset's own address wins
    await appOp(u, "mcp_add", { preset: "github-mcp", token: "ghp_x" }, ctx);
    const after = await appOp(u, "connectors", {}, ctx);
    expect(after.presets.find((p: any) => p.id === "deepwiki").added).toBe(true);
    expect(after.presets.find((p: any) => p.id === "github-mcp").added).toBe(true);
    expect(after.mcp.map((m: any) => m.url)).toEqual(expect.arrayContaining(["https://mcp.deepwiki.com", "https://api.githubcopilot.com"]));
    expect(JSON.stringify(after)).not.toContain("ghp_x");
  });
});

describe("deleting one task from the history", () => {
  it("hides a finished task, never a running one", async () => {
    const { taskStart, taskStatus } = await import("@/lib/coderTasks");
    const db = fakeDb();
    const { bot } = fakeBot();
    const u = { chatId: USER, tier: "user" as const };
    await taskStart(USER, { runId: "run-done-1", slot: "", source: "interactive", title: "x" }, db);
    await taskStart(USER, { runId: "run-live-1", slot: "", source: "interactive", title: "y" }, db);
    await taskStatus("run-done-1", "failed", 2, db);
    await expect(appOp(u, "task_delete", { runId: "run-live-1" }, { db, bot, botRow })).rejects.toMatchObject({ status: 409 });
    expect(await appOp(u, "task_delete", { runId: "run-done-1" }, { db, bot, botRow })).toEqual({ ok: true });
    await expect(appOp(u, "task_delete", { runId: "run-done-1" }, { db, bot, botRow })).rejects.toMatchObject({ status: 409 });   // already hidden
    await expect(appOp(u, "task_delete", { runId: "../x" }, { db, bot, botRow })).rejects.toMatchObject({ status: 400 });
  });
});
