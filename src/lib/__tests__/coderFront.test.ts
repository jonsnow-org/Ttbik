// The quick lane: a tiny acknowledgement from a Studio nobody is using, while the main worker reads the whole conversation.
import { handleCoderSections } from "@/lib/coderSections";
import { collapseRepeats } from "@/lib/coderAgent";
import { fakeBot, fakeDb } from "./coderFakes";

const CHAT = 5151;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

describe("repeated messages", () => {
  it("the same user text sent again with no answer between is read once", () => {
    const long = "اقرأ الملف README.md من المستودع ثم اشرح لي ما هو هذا المشروع";
    const out = collapseRepeats([{ role: "user", content: long }, { role: "user", content: long }, { role: "assistant", content: "ok" }, { role: "user", content: long }]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(collapseRepeats([{ role: "user", content: "hi" }, { role: "user", content: "hi" }])).toHaveLength(2);   // short texts are left alone
  });
});

describe("quick acknowledgement", () => {
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test";
    process.env.OPEN_CODER_STUDIO_URLS = "https://s1.test,https://s2.test";
    process.env.MODELSCOPE_API_TOKEN = "ms";
    process.env.CODER_POLL_MS = "5";
    process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
    process.env.CODER_TOKEN_KEY = "test-key";
    process.env.CODER_FRONT_ACK = "1";
  });
  afterEach(() => { delete process.env.OPEN_CODER_STUDIO_URLS; delete process.env.CODER_FRONT_ACK; });

  it("a new task gets a one-line model reaction within seconds, on a Studio of its own, even while the main call is still reading", async () => {
    const hits: { host: string; messages: string }[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const host = new URL(url).origin;
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) {
        const body = init?.body ? JSON.parse(init.body) : {};
        if (body.messages) hits.push({ host, messages: body.messages });
        return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      }
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/chat/") || url.includes("/gradio_api/call/job_result/")) {
        const last = hits[hits.length - 1]?.messages || "";
        // the quick lane's prompt is the short one; the main worker's call stays pending (still reading)
        if (/ONE or TWO short sentences/.test(last) && hits.length) return new Response(sse({ type: "done", job: "j", text: "فهمت: تريد قراءة README ثم شرح المشروع؛ سأبدأ بقراءته.", tool_calls: [] }), { status: 200 });
        return new Response(sse({ type: "pending", job: "main", status: "running", phase: "ready", queue_pos: 0, total: 0 }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    });
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اقرأ الملف README.md من المستودع ثم اشرح لي ما هو هذا المشروع" } }, db);
    for (let i = 0; i < 60 && !sent.some((s) => /🤖 فهمت/.test(s.text)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((s) => /🤖 فهمت/.test(s.text))).toBe(true);
    const quick = hits.find((h) => /ONE or TWO short sentences/.test(h.messages));
    expect(quick).toBeTruthy();
    expect(JSON.parse(quick!.messages)).toHaveLength(2);                 // system + the request only: no history to read
  });

  it("a one-Studio setup sends no quick call (it would only evict the conversation's cache)", async () => {
    delete process.env.OPEN_CODER_STUDIO_URLS;
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (init?.body && /ONE or TWO/.test(String(init.body))) seen.push(url);
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "pending", job: "main", status: "running", phase: "ready", queue_pos: 0, total: 0 }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اقرأ الملف README.md من المستودع ثم اشرح لي ما هو هذا المشروع" } }, fakeDb());
    await new Promise((r) => setTimeout(r, 1500));
    expect(seen).toHaveLength(0);
  });
});

describe("a Studio whose model server is in error", () => {
  it("the step goes to another Studio at once instead of waiting for the stall watchdog", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test";
    process.env.OPEN_CODER_STUDIO_URLS = "https://s1.test,https://s2.test";
    process.env.MODELSCOPE_API_TOKEN = "ms";
    process.env.CODER_POLL_MS = "5";
    process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT + 1);
    process.env.CODER_TOKEN_KEY = "test-key";
    let broken = "";
    const answered: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = new URL(url).origin;
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: host === broken ? "error" : "ready", queue: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/")) {
        if (!broken) broken = host;                                   // the first Studio asked is the one that is broken
        if (host === broken) return new Response(sse({ type: "pending", job: "j1", status: "running", phase: "error", queue_pos: 0, total: 0 }), { status: 200 });
        answered.push(host);
        return new Response(sse({ type: "done", job: "j2", text: "تم من الاستوديو الآخر", tool_calls: [] }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    });
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT + 1 }, text: "اشرح لي ما هو هذا المشروع بإيجاز شديد" } }, fakeDb());
    for (let i = 0; i < 80 && !sent.some((s) => /تم من الاستوديو الآخر/.test(s.text)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((s) => /تم من الاستوديو الآخر/.test(s.text))).toBe(true);
    expect(answered.length).toBeGreaterThan(0);
    delete process.env.OPEN_CODER_STUDIO_URLS;
  });
});

describe("the conversation window", () => {
  const { windowFrom } = require("@/lib/coderAgent");
  const m = (role: string, n: number, tag = "") => ({ role, content: `${tag}${"x".repeat(n)}` });
  it("only grows at its end while it is under the cap; past the cap it jumps forward to a small window that keeps the latest request", () => {
    const all: any[] = [];
    for (let i = 0; i < 6; i++) all.push(m("user", 1000, `u${i} `), m("assistant", 1000, `a${i} `));      // 12k chars
    const a = windowFrom(all, 0, 24000, 5000);
    expect(a.start).toBe(0);
    expect(a.msgs).toHaveLength(12);
    all.push(m("user", 1000, "u6 "), m("assistant", 1000, "a6 "));
    const b = windowFrom(all, a.start, 24000, 5000);
    expect(b.start).toBe(0);                                              // the start did not move: the new prompt extends the old one
    for (let i = 7; i < 14; i++) all.push(m("user", 1500, `u${i} `), m("assistant", 1500, `a${i} `));           // now > 24k
    const c = windowFrom(all, b.start, 24000, 5000);
    expect(c.start).toBeGreaterThan(0);
    expect(c.msgs[0].role).toBe("user");
    expect(c.msgs.reduce((t: number, x: any) => t + x.content.length, 0)).toBeLessThanOrEqual(6500);
    expect(String(c.msgs[c.msgs.length - 1].content).startsWith("a13")).toBe(true);
    const d = windowFrom(all, c.start, 24000, 5000);
    expect(d.start).toBe(c.start);                                        // stays put again until it is full again
  });
  it("a long current task is kept whole (its own steps are its working memory); the start never passes the latest request", () => {
    const all: any[] = [m("user", 800, "old "), m("assistant", 800), m("user", 500, "REQUEST ")];
    for (let i = 0; i < 12; i++) all.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "t", arguments: "{}" } }] }, { role: "tool", content: "r".repeat(3000), tool_call_id: `c${i}` });
    const w = windowFrom(all, 0, 24000, 5000);
    expect(String(w.msgs[0].content).startsWith("REQUEST")).toBe(true);
    expect(w.msgs.length).toBe(25);
  });
});

describe("a cold Studio", () => {
  it("when the Studio says it must read a huge prompt from zero, the step is sent again with a short window", async () => {
    const { saveState, loadState } = require("@/lib/coderSections");
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test";
    delete process.env.OPEN_CODER_STUDIO_URLS;
    process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_POLL_MS = "5"; process.env.CODER_PREFILL_POLL_MS = "0";
    process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT + 2); process.env.CODER_TOKEN_KEY = "test-key";
    const db = fakeDb();
    const msgs: any[] = [];
    for (let i = 0; i < 10; i++) msgs.push({ role: "user", content: `سؤال ${i} ` + "ن".repeat(1000) }, { role: "assistant", content: `جواب ${i} ` + "ج".repeat(1000) });      // ~20k chars: under the cap, so the first window is the whole of it
    await saveState(CHAT + 2, { mode: "coder", think: false, messages: msgs, notes: "", inbox: [], run: null }, db);
    const sizes: number[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) {
        const body = init?.body ? JSON.parse(init.body) : {};
        if (body.messages) sizes.push(body.messages.length);
        return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      }
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/")) {
        if (sizes.length < 2) return new Response(sse({ type: "pending", job: "j1", status: "running", phase: "ready", queue_pos: 0, total: 0, prefill: { total: 14000, cache: 0, processed: 14, time_ms: 300 } }), { status: 200 });
        return new Response(sse({ type: "done", job: "j2", text: "جاهز بعد التقصير", tool_calls: [] }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    });
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT + 2 }, text: "اشرح لي هذا المشروع بإيجاز" } }, db);
    for (let i = 0; i < 80 && !sent.some((s) => /جاهز بعد التقصير/.test(s.text)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((s) => /جاهز بعد التقصير/.test(s.text))).toBe(true);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(sizes[sizes.length - 1]).toBeLessThan(sizes[0] * 0.75);       // the second try carries far less history
    const st = await loadState(CHAT + 2, db);
    expect(st.winStart || 0).toBeGreaterThan(0);                           // and the new start is remembered, so later tasks extend it
  });
});

describe("a Studio queue that does not move", () => {
  it("the step is cancelled and sent to another, idle Studio instead of waiting minutes behind the job ahead", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test";
    process.env.OPEN_CODER_STUDIO_URLS = "https://s1.test,https://s2.test";
    process.env.MODELSCOPE_API_TOKEN = "ms";
    process.env.CODER_POLL_MS = "5";
    process.env.CODER_QUEUE_MOVE_MS = "0";
    process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT + 2);
    process.env.CODER_TOKEN_KEY = "test-key";
    let stuck = "";
    const answered: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = new URL(url).origin;
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: host === stuck ? 1 : 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/")) {
        if (!stuck) stuck = host;                                     // the first Studio asked is the one with a job ahead that never finishes
        if (host === stuck) return new Response(sse({ type: "pending", job: "j1", status: "queued", phase: "ready", queue_pos: 1, total: 0 }), { status: 200 });
        answered.push(host);
        return new Response(sse({ type: "done", job: "j2", text: "تم من الاستوديو الفارغ", tool_calls: [] }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    });
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT + 2 }, text: "اشرح لي ما هو هذا المشروع بإيجاز شديد" } }, fakeDb());
    for (let i = 0; i < 100 && !sent.some((s) => /تم من الاستوديو الفارغ/.test(s.text)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent.some((s) => /تم من الاستوديو الفارغ/.test(s.text))).toBe(true);
    expect(answered.length).toBeGreaterThan(0);
    delete process.env.OPEN_CODER_STUDIO_URLS; delete process.env.CODER_QUEUE_MOVE_MS;
  });
});

describe("thinking budget by accuracy mode", () => {
  it("fast thinks briefly, balanced uses the Studio's default (nothing extra is sent), precise is given room; env can override", () => {
    const { thinkCapFor } = require("@/lib/coderSections");
    expect(thinkCapFor("fast")).toBeLessThan(thinkCapFor("balanced"));
    expect(thinkCapFor("balanced")).toBe(1200);
    expect(thinkCapFor("precise")).toBeGreaterThan(thinkCapFor("balanced"));
    expect(thinkCapFor(undefined)).toBe(1200);
    process.env.CODER_THINK_CAP_FAST = "700"; expect(thinkCapFor("fast")).toBe(700); delete process.env.CODER_THINK_CAP_FAST;
  });
});

describe("the model is told how long it has been working", () => {
  const { progressNote } = require("@/lib/coderSections");
  it("nothing early; from step 6 or minute 8 a one-line note with the step and the minutes; off with CODER_TIME_NOTE=off; never for agents", () => {
    const t0 = 1_000_000;
    expect(progressNote({ step: 2, startedAt: t0 }, t0 + 3 * 60000)).toBe("");
    expect(progressNote({ step: 6, startedAt: t0 }, t0 + 12 * 60000)).toMatch(/step 7, 12 min spent/);
    expect(progressNote({ step: 1, startedAt: t0 }, t0 + 9 * 60000)).toMatch(/9 min spent/);
    expect(progressNote({ step: 9, startedAt: t0 }, t0 + 25 * 60000)).toMatch(/already long/);
    expect(progressNote({ step: 9, startedAt: t0, agent: true }, t0 + 25 * 60000)).toBe("");
    process.env.CODER_TIME_NOTE = "off"; expect(progressNote({ step: 9, startedAt: t0 }, t0 + 25 * 60000)).toBe(""); delete process.env.CODER_TIME_NOTE;
  });
});

describe("a warm-up must not stand in front of a real request", () => {
  it("the warm-up of a chat is cancelled on the Studio when a real request of that chat is about to be sent; a big conversation is not warmed at all", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://w1.test"; delete process.env.OPEN_CODER_STUDIO_URLS;
    process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_PREWARM = "1"; process.env.CODER_PREWARM_POLL_MS = "20"; process.env.CODER_TOKEN_KEY = "test-key";
    const { prewarmChat, cancelWarm } = require("@/lib/coderSections");
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      if (url.includes("/gradio_api/call/v2/")) { seen.push(url.split("/call/v2/")[1]); return new Response(JSON.stringify({ event_id: "e" }), { status: 200 }); }
      if (url.includes("/gradio_api/call/chat/")) return new Response(sse({ type: "pending", job: "warm1", status: "running", phase: "ready", queue_pos: 0, total: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/cancel/")) return new Response(sse({ type: "cancelled", job: "warm1" }), { status: 200 });
      if (url.includes("/gradio_api/call/job_result/")) return new Response(sse({ type: "pending", job: "warm1", status: "running", phase: "ready" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0 }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const db = fakeDb();
    const p = prewarmChat(777001, db);
    for (let i = 0; i < 60 && !seen.includes("chat"); i++) await new Promise((r) => setTimeout(r, 50));
    expect(seen).toContain("chat");
    await new Promise((r) => setTimeout(r, 100));
    await cancelWarm(777001);
    expect(seen).toContain("cancel");                              // the Studio was told to drop it
    await p;                                                        // and the warm-up's own loop has ended
    delete process.env.CODER_PREWARM; delete process.env.CODER_PREWARM_POLL_MS;
  });
});
