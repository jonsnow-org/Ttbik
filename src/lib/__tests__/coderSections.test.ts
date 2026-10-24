import { chunkRanges, parseCoderSse, renderRange, splitForTelegram, openFenceAt } from "@/lib/openCoderStudio";
import { guardCall, githubClient, trimMessages, coderTools, coderSystemPrompt } from "@/lib/coderAgent";
import { drive, handleCoderSections, loadState, saveState, signContinue, verifyContinue, type Db } from "@/lib/coderSections";

const CHAT = 4242;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

function memDb(): Db & { rows: Map<string, any>; stalls: any[]; conns: any[] } {
  const rows = new Map<string, any>();
  const stalls: any[] = [];
  const conns: any[] = [];
  return {
    rows, stalls, conns,
    exec: async (sql: string, ...args: unknown[]) => {
      if (sql.includes("coder_stall_log")) stalls.push({ run_id: args[0], step: args[2], pattern: args[3], level: args[4], detail: args[5] });
      else if (sql.includes("coder_connections")) conns.push({ chat_key: args[0], provider: args[1], token_enc: args[2], login: args[3] });
      else rows.set(String(args[0]), JSON.parse(String(args[1])));
    },
    query: async <T,>(sql: string, key: unknown) => {
      if (sql.includes("coder_connections")) return conns.filter((c) => c.chat_key === key) as T[];
      if (sql.includes("coder_stall_log")) return stalls as T[];
      return (rows.has(String(key)) ? [{ state: JSON.parse(JSON.stringify(rows.get(String(key)))) }] : []) as T[];
    },
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
  process.env.CODER_OUTAGE_STEP_MS = "5";
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
  it("keeps the start of the prompt stable between steps (the model server's prompt cache)", () => {
    const at = (m: number) => coderSystemPrompt({ github: true, notes: "", now: new Date(Date.UTC(2026, 9, 24, 12, m)) });
    expect(at(1)).toBe(at(40));                                    // the minute never reaches the prompt
    const hist = Array.from({ length: 120 }, (_, k) => ({ role: k % 3 === 0 ? "user" : k % 3 === 1 ? "assistant" : "tool", content: "x".repeat(100) })) as any[];
    let moves = 0;
    let prev = -1;
    for (let n = 40; n <= 120; n++) {
      const t = trimMessages(hist.slice(0, n), 3000);
      expect(t.reduce((a, m) => a + m.content.length, 0)).toBeLessThanOrEqual(3000);
      const start = n - t.length;
      if (prev >= 0 && start !== prev) moves++;
      prev = start;
    }
    expect(moves).toBeLessThan(20);                                // a sliding window would move on nearly every one of the 80 steps
  });
  it("never trims away the user's request, however large the tool results after it are", () => {
    const m: any[] = [{ role: "user", content: "اقرأ وحلّل" }];
    for (let k = 0; k < 6; k++) m.push({ role: "assistant", content: "", tool_calls: [{ id: `c${k}`, type: "function", function: { name: "fetch_page", arguments: "{}" } }] }, { role: "tool", content: "x".repeat(20000), tool_call_id: `c${k}`, name: "fetch_page" });
    for (const max of [1000, 40000, 70000]) {
      const t = trimMessages(m, max);
      expect(t[0].role).toBe("user");
      expect(t.some((x: any) => x.role === "user")).toBe(true);
    }
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
    // tools come in groups the model loads itself (load_tools); the GitHub group is offered here
    const first = JSON.parse(chatCalls[0].body.tools);
    expect(first.find((t: any) => t.function.name === "load_tools").function.parameters.properties.groups.items.enum).toContain("github");
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

import { HARD_MAX_STEPS } from "@/lib/coderStall";
import { saveConnection } from "@/lib/coderAuth";

describe("no pause: loops are detected, logged and recovered", () => {
  const readA = { id: "r", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: "a/b", path: "README.md" }) } };
  const ghRead = { "GET /repos/a/b/contents/README.md": () => [200, { content: Buffer.from("# same").toString("base64"), sha: "abc1234" }] as [number, any] };

  it("the same call 3× injects a reflection step, logs the stall, and a 4th identical call is not run — the task still finishes", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [readA] },
      { type: "done", job: "j2", text: "", tool_calls: [readA] },
      { type: "done", job: "j3", text: "", tool_calls: [readA] },
      { type: "done", job: "j4", text: "", tool_calls: [readA] },
      { type: "done", job: "j5", text: "انتهيت بطريقة أخرى.", tool_calls: [] },
    ], ghRead);
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "loop1", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect(sent.map((s) => s.text)).toContain("انتهيت بطريقة أخرى.");
    expect(sent.some((s) => /متابعة|أتابع؟/.test(s.text))).toBe(false);                 // no user-facing pause
    expect(st.messages.some((m) => m.role === "user" && m.content.startsWith("[harness] Loop detected"))).toBe(true);
    expect(st.messages.some((m) => m.role === "tool" && m.content.includes("Not run again"))).toBe(true);
    const ghReads = calls.filter((c) => c.url.includes("api.github.com") && c.url.includes("README.md"));
    expect(ghReads.length).toBe(3 + 1);                                                 // 3 real reads + 1 fresh re-read on the 2nd recovery; the 4th call was skipped
    expect(db.stalls.map((x) => x.pattern)).toEqual(["repeat_call", "repeat_call"]);
    expect(db.stalls[0].run_id).toBe("loop1");
    const lastChat = calls.filter((c) => c.url.includes("/call/v2/chat") && !/long-term memory about ONE user/.test(JSON.stringify(c.body))).pop()!;   // not the memory extraction after the task
    expect(lastChat.body.think).toBe("1");                                              // escalated recovery thinks harder
  });

  it("ends at the hard ceiling (no pause), and logs it — for a regular user; the owner has no ceiling", async () => {
    const USER = 5551;
    studio([{ type: "done", job: "j1", text: "", tool_calls: [readA] }], ghRead);
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(USER, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "cap", chain: "c", sent: 0, step: HARD_MAX_STEPS - 1, lease: Date.now() } }, db);
    await drive(bot, botRow, USER, "c", db, 40000);
    expect((await loadState(USER, db)).run).toBeNull();
    expect(sent[sent.length - 1].text).toContain("حلقة");
    expect(db.stalls.map((x) => x.pattern)).toContain("hard_ceiling");
  });

  it("a Studio hiccup is retried, not the end of the task", async () => {
    let n = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes("/call/v2/chat") && n++ === 0) return new Response("busy", { status: 503 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      return new Response(sse({ type: "done", job: "j", text: "تم", tool_calls: [] }), { status: 200 });
    });
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "h", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(sent.map((s) => s.text)).toContain("تم");
  });

  it("a longer Studio outage is waited out (several failed submits), the task still finishes", async () => {
    process.env.CODER_OUTAGE_STEP_MS = "5";
    let n = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes("/call/v2/chat") && n++ < 6) return new Response("down", { status: 503 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      return new Response(sse({ type: "done", job: "j", text: "عاد الخادم وتم", tool_calls: [] }), { status: 200 });
    });
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "o1", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    delete process.env.CODER_OUTAGE_STEP_MS;
    expect(n).toBeGreaterThanOrEqual(7);                                                    // more attempts than the old cap (5 retries) allowed
    expect(sent.map((s) => s.text)).toContain("عاد الخادم وتم");
    expect(sent.filter((s) => /غير متاح لحظياً/.test(s.text))).toHaveLength(1);              // told once, not on every try
  }, 60000);

  it("an outage that outlasts the patience ends the task visibly (never silently)", async () => {
    process.env.CODER_OUTAGE_MS = "150";
    process.env.CODER_OUTAGE_STEP_MS = "5";
    (global as any).fetch = jest.fn(async (url: string) => (url.includes("/call/v2/chat") ? new Response("down", { status: 503 }) : new Response("{}", { status: 200 })));
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "o2", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    delete process.env.CODER_OUTAGE_MS;
    delete process.env.CODER_OUTAGE_STEP_MS;
    expect((await loadState(CHAT, db)).run).toBeNull();
    expect(sent[sent.length - 1].text).toMatch(/مشغولة|تعذّر|الخدمة/);
  });

  it("a job the restarted Studio no longer knows is asked again, not failed", async () => {
    let polls = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("/gradio_api/call/job_result/")) return new Response(sse({ type: "gone", job: "j1" }), { status: 200 });
      if (url.includes("/gradio_api/call/chat/")) return new Response(sse(polls++ === 0 ? { type: "pending", job: "j1" } : { type: "done", job: "j2", text: "أجبتُ بعد إعادة الإرسال", tool_calls: [] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const db = memDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "g1", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(sent.map((s) => s.text)).toContain("أجبتُ بعد إعادة الإرسال");
  });
});

describe("tiers in the loop", () => {
  it("a regular user with their OWN linked token gets GitHub tools, and settings changes wait for ✅ (the owner's would not)", async () => {
    process.env.CODER_TOKEN_KEY = "test-key";
    const settings = { id: "s", type: "function", function: { name: "github_update_repo", arguments: JSON.stringify({ repo: "a/b", settings: { private: false } }) } };
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [settings] }]);
    const db = memDb();
    await saveConnection(555, "github", "user-own-token", "u", db);
    const { bot, sent } = fakeBot();
    await saveState(555, { mode: "coder", think: false, messages: [{ role: "user", content: "اجعل المستودع عاماً" }], notes: "", inbox: [], run: { id: "u1", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db);
    await drive(bot, botRow, 555, "c", db, 40000);
    const tools = JSON.parse(calls.find((c) => c.url.includes("/call/v2/chat"))!.body.tools).map((t: any) => t.function.name);
    const offered = JSON.parse(calls.find((c) => c.url.includes("/call/v2/chat"))!.body.tools).find((t: any) => t.function.name === "load_tools");
    expect(tools.includes("github_write_files") || offered?.function.parameters.properties.groups.items.enum.includes("github")).toBe(true);
    expect((await loadState(555, db)).run?.pending?.reason).toBe("تغيير إعدادات المستودع");
    expect(sent[sent.length - 1].extra.reply_markup).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith("https://api.github.com") && c.body)).toBe(false);

    // the owner: same call runs at once, with the owner token
    const calls2 = studio([{ type: "done", job: "j1", text: "", tool_calls: [settings] }, { type: "done", job: "j2", text: "تم.", tool_calls: [] }], { "PATCH /repos/a/b": () => [200, {}] });
    const db2 = memDb();
    const b2 = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: [], run: { id: "o1", chain: "c", sent: 0, step: 0, lease: Date.now() } }, db2);
    await drive(b2.bot, botRow, CHAT, "c", db2, 40000);
    expect(calls2.some((c) => c.url === "https://api.github.com/repos/a/b" && c.body?.private === false)).toBe(true);
    expect(b2.sent.map((s) => s.text)).toContain("تم.");
  });
});

describe("delivery to the chat by what is happening", () => {
  const mk = (draft: "ok" | "refuse" | "none") => {
    const sent: string[] = [];
    const drafts: string[] = [];
    const api: any = { sendMessage: jest.fn(async (_c: number, t: string) => { sent.push(t); return { message_id: 1 }; }) };
    if (draft !== "none") api.sendMessageDraft = jest.fn(async (_c: number, _id: number, t: string) => { if (draft === "refuse") throw new Error("not allowed"); drafts.push(t); return true; });
    return { bot: { api } as any, sent, drafts };
  };
  const para = (n: number) => Array.from({ length: n }, (_, i) => `فقرة رقم ${i} ` + "x".repeat(90)).join("\n\n");
  it("a short answer streams in a draft and arrives as one message", async () => {
    const { deliverToChat } = await import("@/lib/coderSections");
    const { bot, sent, drafts } = mk("ok");
    const run: any = { id: "r", surface: "app" };
    await deliverToChat(bot, 5, "أهلاً! كيف", run, false);
    await deliverToChat(bot, 5, "أهلاً! كيف حالك؟", run, false);        // inside the throttle window: no second draft
    expect(drafts).toHaveLength(1);
    expect(sent).toHaveLength(0);
    await deliverToChat(bot, 5, "أهلاً! كيف حالك؟", run, true);
    expect(sent).toHaveLength(1);
  });
  it("a long answer commits finished parts as messages and keeps streaming the tail; the final is not fragmented", async () => {
    const { deliverToChat } = await import("@/lib/coderSections");
    const { bot, sent, drafts } = mk("ok");
    const run: any = { id: "r", surface: "app" };
    const text = para(60);                                              // ~6000 characters
    await deliverToChat(bot, 5, text, run, false);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.every((m) => m.length <= 4096)).toBe(true);
    expect(drafts.length).toBe(1);
    await deliverToChat(bot, 5, text, run, true);
    expect(sent.join("\n").replace(/<[^>]+>/g, "").length).toBeGreaterThan(5000);
    expect(sent.length).toBeLessThanOrEqual(3);                          // not 1,200-character fragments
  });
  it("a refused draft falls back to readable batches", async () => {
    const { deliverToChat } = await import("@/lib/coderSections");
    const { bot, sent } = mk("refuse");
    const run: any = { id: "r", surface: "app" };
    await deliverToChat(bot, 5, para(15), run, false);                   // ~1,500 characters
    expect(run.noDraft).toBe(true);
    await deliverToChat(bot, 5, para(15), run, false);
    expect(sent.length).toBeGreaterThanOrEqual(1);
  });
  it("without the draft method (old API) it still delivers", async () => {
    const { deliverToChat } = await import("@/lib/coderSections");
    const { bot, sent } = mk("none");
    await deliverToChat(bot, 5, "رد قصير", { id: "r", surface: "app" } as any, true);
    expect(sent).toHaveLength(1);
  });
});

describe("notices of a task started from the chat", () => {
  it("a chat-started task keeps its failure notices in the chat; an app-started one stays quiet", async () => {
    const { surfaceBot } = await import("@/lib/coderSections");
    const mk = () => { const sent: string[] = []; return { sent, bot: { api: { sendMessage: jest.fn(async (_c: number, t: string) => { sent.push(t); return { message_id: 1 }; }) } } as any }; };
    const a = mk();
    await surfaceBot(a.bot, "app", "chat").api.sendMessage(1, "⚠️ توقفت المهمة");
    expect(a.sent).toEqual(["⚠️ توقفت المهمة"]);
    const b = mk();
    await surfaceBot(b.bot, "app").api.sendMessage(1, "⚠️ توقفت المهمة");
    expect(b.sent).toEqual([]);
  });
});
