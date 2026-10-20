import { chunkRanges, parseCoderSse, renderRange, splitForTelegram, openFenceAt } from "@/lib/openCoderStudio";
import { guardCall, githubClient, trimMessages, coderTools } from "@/lib/coderAgent";
import { drive, handleCoderSections, loadState, saveState, signContinue, verifyContinue, type Db } from "@/lib/coderSections";

const CHAT = 4242;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

function memDb(): Db & { rows: Map<string, any> } {
  const rows = new Map<string, any>();
  return {
    rows,
    exec: async (_sql: string, key: unknown, state: unknown) => {
      rows.set(String(key), JSON.parse(String(state)));
    },
    query: async <T,>(_sql: string, key: unknown) => (rows.has(String(key)) ? [{ state: JSON.parse(JSON.stringify(rows.get(String(key)))) }] : []) as T[],
  };
}

function fakeBot() {
  const sent: { text: string; extra?: any }[] = [];
  const api = {
    sendMessage: jest.fn(async (_c: number, text: string, extra?: any) => { sent.push({ text, extra }); return {}; }),
    sendChatAction: jest.fn(async () => ({})),
    answerCallbackQuery: jest.fn(async () => ({})),
    editMessageReplyMarkup: jest.fn(async () => ({})),
  };
  return { bot: { api } as any, sent };
}
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;

type Step = object;
function studio(replies: Step[], github: Record<string, (body: any, method: string) => [number, any]> = {}) {
  const calls: { url: string; body?: any }[] = [];
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: `e${calls.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse(replies[Math.min(i++, replies.length - 1)]), { status: 200 });
    if (url.startsWith("https://api.github.com")) {
      const path = url.slice("https://api.github.com".length);
      const method = init?.method || "GET";
      for (const [k, fn] of Object.entries(github)) {
        if (`${method} ${path}`.startsWith(k)) {
          const [status, data] = fn(body, method);
          return new Response(JSON.stringify(data), { status });
        }
      }
      return new Response(JSON.stringify({ message: "not mocked" }), { status: 404 });
    }
    return new Response("{}", { status: 202 });
  });
  return calls;
}

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
});

describe("telegram chunks", () => {
  it("keeps every part under 4096 and balances code fences", () => {
    const code = "```ts\n" + Array.from({ length: 600 }, (_, i) => `const v${i} = ${i}; // line`).join("\n") + "\n```\nتم.";
    const parts = splitForTelegram(code);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) {
      expect(p.length).toBeLessThan(4096);
      expect(openFenceAt(p)).toBe("");
    }
    const ranges = chunkRanges(code, 0, true);
    const rendered = ranges.map(([a, b]) => renderRange(code, a, b));
    for (const p of rendered) {
      expect(p.length).toBeLessThan(4096);
      expect(openFenceAt(p)).toBe("");
    }
    expect(ranges[ranges.length - 1][1]).toBe(code.length);
  });
  it("sends only whole chunks while generating", () => {
    expect(chunkRanges("short", 0, false)).toEqual([]);
    expect(chunkRanges("short", 0, true)).toEqual([[0, 5]]);
  });
  it("reads the Studio JSON", () => {
    expect(parseCoderSse(sse({ type: "pending", job: "j1" }))?.job).toBe("j1");
    expect(parseCoderSse("data: nope\n")).toBeNull();
  });
});

describe("guard (the only guardrail)", () => {
  const gh = githubClient("x");
  const call = (name: string, args: object) => ({ id: "c", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
  it("asks before any delete", async () => {
    expect((await guardCall(call("github_delete_files", { repo: "a/b", branch: "feat", paths: ["x"] }), null)).confirm).toBe(true);
    expect((await guardCall(call("github_delete_branch", { repo: "a/b", branch: "feat" }), null)).confirm).toBe(true);
  });
  it("asks before a push to main or to the repo's default branch, not to a feature branch", async () => {
    studio([], { "GET /repos/a/b": () => [200, { default_branch: "claude/site" }] });
    expect((await guardCall(call("github_write_files", { repo: "a/b", branch: "main", files: [] }), gh)).confirm).toBe(true);
    expect((await guardCall(call("github_write_files", { repo: "a/b", branch: "claude/site", files: [] }), gh)).confirm).toBe(true);
    expect((await guardCall(call("github_write_files", { repo: "a/b", branch: "coder/fix-1", files: [] }), gh)).confirm).toBe(false);
    expect((await guardCall(call("github_read_file", { repo: "a/b", path: "x" }), gh)).confirm).toBe(false);
  });
  it("asks before merging into main/default, not into a feature base", async () => {
    studio([], { "GET /repos/a/b/pulls/1": () => [200, { base: { ref: "main" } }], "GET /repos/a/b/pulls/2": () => [200, { base: { ref: "dev" } }], "GET /repos/a/b": () => [200, { default_branch: "main" }] });
    expect((await guardCall(call("github_merge_pr", { repo: "a/b", number: 1 }), gh)).confirm).toBe(true);
    expect((await guardCall(call("github_merge_pr", { repo: "a/b", number: 2 }), gh)).confirm).toBe(false);
  });
  it("trims history to whole turns", () => {
    const m = [{ role: "user", content: "a".repeat(50) }, { role: "assistant", content: "b".repeat(50) }, { role: "tool", content: "c".repeat(50) }, { role: "user", content: "d" }] as any;
    const t = trimMessages(m, 60);
    expect(t[0].role).toBe("user");
    expect(t[t.length - 1].content).toBe("d");
    expect(coderTools(false).map((x) => x.function.name)).not.toContain("github_write_files");
  });
});

describe("sections and the loop", () => {
  it("is off without OPEN_CODER_STUDIO_URL (Sham path unchanged)", async () => {
    delete process.env.OPEN_CODER_STUDIO_URL;
    const { bot } = fakeBot();
    expect(await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "hi" } }, memDb())).toBe(false);
  });

  it("/mode switches to Sham, and then every message goes to the Sham handler", async () => {
    const db = memDb();
    const { bot, sent } = fakeBot();
    expect(await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "/mode" } }, db)).toBe(true);
    expect(sent[0].extra.reply_markup).toBeTruthy();
    expect(await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: "cmode|sham", message: { chat: { id: CHAT }, message_id: 1 } } }, db)).toBe(true);
    expect((await loadState(CHAT, db)).mode).toBe("sham");
    expect(await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "مرحبا" } }, db)).toBe(false);
    expect(await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: "cmode|coder", message: { chat: { id: CHAT }, message_id: 1 } } }, db)).toBe(true);
    expect((await loadState(CHAT, db)).mode).toBe("coder");
  });

  it("streams a long answer in parts under 4096 and finishes the run", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `سطر رقم ${i} من الشرح الطويل للكود`).join("\n");
    studio([{ type: "pending", job: "j1" }, { type: "pending", job: "j1", text: long.slice(0, 5000) }, { type: "done", job: "j1", text: long, tool_calls: [] }]);
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "اشرح" }], notes: "", inbox: [], run: { id: "r1", chain: "c1", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c1", db, 40000);
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect(st.messages[st.messages.length - 1]).toEqual({ role: "assistant", content: long });
    const joined = sent.map((s) => s.text).join("\n");
    expect(sent.every((s) => s.text.length < 4096)).toBe(true);
    expect(joined.replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
  });

  it("runs a tool, feeds the result back, and stops for confirmation before a push to main", async () => {
    const read = { id: "t1", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: "a/b", path: "README.md" }) } };
    const write = { id: "t2", type: "function", function: { name: "github_write_files", arguments: JSON.stringify({ repo: "a/b", branch: "main", message: "m", files: [{ path: "x.ts", content: "1" }] }) } };
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [read] }, { type: "done", job: "j2", text: "", tool_calls: [write] }, { type: "done", job: "j3", text: "تم الدفع.", tool_calls: [] }], {
      "GET /repos/a/b/contents/README.md": () => [200, { content: Buffer.from("# hello").toString("base64"), sha: "abc1234" }],
      "GET /repos/a/b/git/ref/heads/main": () => [200, { object: { sha: "p1" } }],
      "GET /repos/a/b/git/commits/p1": () => [200, { tree: { sha: "t0" } }],
      "POST /repos/a/b/git/blobs": () => [201, { sha: "b1" }],
      "POST /repos/a/b/git/trees": () => [201, { sha: "t1" }],
      "POST /repos/a/b/git/commits": () => [201, { sha: "c9" }],
      "PATCH /repos/a/b/git/refs/heads/main": () => [200, {}],
      "GET /repos/a/b": () => [200, { default_branch: "main" }],
    });
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "عدّل" }], notes: "", inbox: [], run: { id: "r1", chain: "c1", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c1", db, 40000);
    let st = await loadState(CHAT, db);
    expect(st.messages.find((m) => m.role === "tool")?.content).toContain("# hello");
    expect(st.run?.pending?.reason).toBe("دفع إلى الفرع الأساسي");
    expect(calls.some((c) => c.url.includes("/git/refs/heads/main") && c.body)).toBe(false);   // nothing pushed yet
    const confirm = sent[sent.length - 1];
    const yes = confirm.extra.reply_markup.inline_keyboard[0][0].callback_data;
    expect(yes).toMatch(/^ccf\|r1\|.+\|yes$/);
    await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: yes, message: { chat: { id: CHAT }, message_id: 9 } } }, db);
    await new Promise((r) => setTimeout(r, 300));
    st = await loadState(CHAT, db);
    expect(calls.some((c) => c.url.endsWith("/git/refs/heads/main") && c.body?.sha === "c9")).toBe(true);
    expect(st.run).toBeNull();
    expect(sent.map((s) => s.text)).toContain("تم الدفع.");
    const chatCalls = calls.filter((c) => c.url.includes("/call/v2/chat"));
    expect(JSON.parse(chatCalls[0].body.tools).length).toBeGreaterThan(5);
  });

  it("a declined delete is NOT executed and the model is told", async () => {
    const del = { id: "t3", type: "function", function: { name: "github_delete_branch", arguments: JSON.stringify({ repo: "a/b", branch: "old" }) } };
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [del] }, { type: "done", job: "j2", text: "حسناً، لم أحذف.", tool_calls: [] }]);
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "احذف الفرع old" }], notes: "", inbox: [], run: { id: "r2", chain: "c2", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c2", db, 40000);
    const no = sent[sent.length - 1].extra.reply_markup.inline_keyboard[0][1].callback_data;
    await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: no, message: { chat: { id: CHAT }, message_id: 9 } } }, db);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.url.includes("api.github.com") && c.url.includes("refs/heads/old"))).toBe(false);
    const st = await loadState(CHAT, db);
    expect(st.messages.some((m) => m.role === "tool" && m.content.includes("declined"))).toBe(true);
  });

  it("a stranger gets no GitHub tools", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "ok", tool_calls: [] }]);
    const db = memDb();
    const { bot } = fakeBot();
    await saveState(777, { mode: "coder", think: false, messages: [{ role: "user", content: "hi" }], notes: "", inbox: [], run: { id: "r3", chain: "c3", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, 777, "c3", db, 40000);
    const tools = JSON.parse(calls.find((c) => c.url.includes("/call/v2/chat"))!.body.tools).map((t: any) => t.function.name);
    expect(tools).not.toContain("github_write_files");
  });

  it("hands itself off, signed, before the time limit", async () => {
    const calls = studio([{ type: "pending", job: "j1" }]);
    const db = memDb();
    const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "r4", chain: "c4", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c4", db, 5000);
    const hop = calls.find((c) => c.url.endsWith("/api/coder/continue"));
    expect(hop).toBeTruthy();
    expect(verifyContinue("whs", "bot1", String(CHAT), "c4", hop!.body.sig)).toBe(true);
    expect(verifyContinue("whs", "bot1", String(CHAT), "c4", signContinue("other", "bot1", String(CHAT), "c4"))).toBe(false);
  });
});
