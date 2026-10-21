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
    await appOp({ chatId: USER, tier: "user" }, "settings", { mode: "sham", think: true, lang: "en", tz: "Europe/Istanbul", repo: "o/r" }, { db, bot, botRow });
    let st = await loadState(USER, db);
    expect([st.mode, st.think, st.lang, st.tz, st.repo]).toEqual(["sham", true, "en", "Europe/Istanbul", "o/r"]);
    await appOp({ chatId: USER, tier: "user" }, "settings", { mode: "x", tz: "Mars/Base", repo: "not a repo" }, { db, bot, botRow });
    st = await loadState(USER, db);
    expect([st.mode, st.tz, st.repo]).toEqual(["sham", "Europe/Istanbul", "o/r"]);
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
