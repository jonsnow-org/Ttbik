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
