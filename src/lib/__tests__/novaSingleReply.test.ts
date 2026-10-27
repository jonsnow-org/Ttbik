// One user message -> exactly ONE answer, even when Telegram re-delivers the update (same update_id) while the first answer is being written.
import { handleCoderSections, loadState } from "@/lib/coderSections";
import { claimTelegramUpdate } from "@/lib/telegramDedupe";
import { fakeBot, fakeDb } from "./coderFakes";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const CHAT = 5151;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

function studio(texts: string[]) {
  const chatCalls: any[] = [];
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/")) { if (url.includes("/chat")) chatCalls.push(init?.body); return new Response(JSON.stringify({ event_id: `e${chatCalls.length}` }), { status: 200 }); }
    if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: `j${i}`, text: texts[Math.min(i++, texts.length - 1)], tool_calls: [] }), { status: 200 });
    return new Response("{}", { status: 202 });
  });
  return chatCalls;
}

/** a fake db that also keeps the dedupe table */
function dbWithSeen() {
  const db = fakeDb() as any;
  const seen = new Set<string>();
  const q = db.query;
  db.query = async (sql: string, ...a: any[]) => {
    if (/INSERT INTO tg_seen_updates/.test(sql)) { const k = a.join("|"); if (seen.has(k)) return []; seen.add(k); return [{ update_id: String(a[2]) }]; }
    return q(sql, ...a);
  };
  return db;
}

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
});

const msg = (update_id: number | undefined, text = "مرحباً، كيف حالك؟") => ({ ...(update_id ? { update_id } : {}), message: { message_id: 7, from: { id: CHAT }, chat: { id: CHAT, type: "private" }, text } });
const answers = (sent: { text: string }[]) => sent.filter((s) => /أهلاً بك، أنا بخير/.test(s.text)).length;

describe("claimTelegramUpdate", () => {
  it("first delivery goes on, the re-delivery of the same update id is dropped, other ids and chats are independent", async () => {
    const db = dbWithSeen();
    expect(await claimTelegramUpdate("coder", 1, 100, db)).toBe(true);
    expect(await claimTelegramUpdate("coder", 1, 100, db)).toBe(false);
    expect(await claimTelegramUpdate("coder", 1, 101, db)).toBe(true);
    expect(await claimTelegramUpdate("coder", 2, 100, db)).toBe(true);
    expect(await claimTelegramUpdate("other", 1, 100, db)).toBe(true);
  });
  it("no update id (internal calls) or a broken store never blocks a message", async () => {
    expect(await claimTelegramUpdate("coder", 1, undefined, dbWithSeen())).toBe(true);
    const broken: any = { exec: async () => { throw new Error("db down"); }, query: async () => { throw new Error("db down"); } };
    expect(await claimTelegramUpdate("coder", 1, 5, broken)).toBe(true);
  });
});

describe("Nova answers a message once", () => {
  it("a Telegram re-delivery while the first answer is still being written produces no second answer and no queued copy", async () => {
    const calls = studio(["أهلاً بك، أنا بخير الحمد لله."]);
    const db = dbWithSeen();
    const { bot, sent } = fakeBot();
    expect(await handleCoderSections(bot, botRow, msg(900), db)).toBe(true);
    expect(await handleCoderSections(bot, botRow, msg(900), db)).toBe(true);           // the same webhook, delivered again
    expect((await loadState(CHAT, db)).inbox).toEqual([]);                             // not queued as a follow-up
    await new Promise((r) => setTimeout(r, 900));
    expect(calls.length).toBe(1);                                                      // the model was asked once
    expect(answers(sent)).toBe(1);
    const st = await loadState(CHAT, db);
    expect(st.messages.filter((m: any) => m.role === "user").length).toBe(1);
    expect(st.run).toBeNull();                                                         // no task left running in the background
  });

  it("a re-delivery after the answer was sent is dropped too", async () => {
    const calls = studio(["أهلاً بك، أنا بخير الحمد لله."]);
    const db = dbWithSeen();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, msg(901), db);
    await new Promise((r) => setTimeout(r, 900));
    await handleCoderSections(bot, botRow, msg(901), db);
    await new Promise((r) => setTimeout(r, 600));
    expect(calls.length).toBe(1);
    expect(answers(sent)).toBe(1);
  });

  it("a genuinely new message (new update id) is answered", async () => {
    const calls = studio(["أهلاً بك، أنا بخير الحمد لله.", "ردّ ثانٍ."]);
    const db = dbWithSeen();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, msg(902, "الأولى"), db);
    await new Promise((r) => setTimeout(r, 900));
    await handleCoderSections(bot, botRow, msg(903, "الثانية"), db);
    await new Promise((r) => setTimeout(r, 900));
    expect(calls.length).toBe(2);
  });

  it("control: without the claim (no update id) the copy IS queued as a follow-up while the first run is active — the bug this prevents", async () => {
    studio(["أهلاً بك، أنا بخير الحمد لله.", "أهلاً بك، أنا بخير الحمد لله."]);
    const db = dbWithSeen();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, msg(undefined), db);
    await handleCoderSections(bot, botRow, msg(undefined), db);
    const st = await loadState(CHAT, db);
    expect(st.inbox.length + st.messages.filter((m: any) => m.role === "user").length).toBeGreaterThan(1);
  });
});

describe("no quick-lane message in the chat, and Nova's identity is its own", () => {
  it("the 'understood, I will do X first' ack is never sent into the Telegram chat (it was the first of two replies)", async () => {
    process.env.CODER_FRONT_ACK = "1";
    process.env.OPEN_CODER_STUDIO_URLS = "https://coder2.test";
    const calls = studio(["أهلاً بك، أنا بخير الحمد لله.", "سأبدأ بقراءة الملف."]);
    const db = dbWithSeen();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, msg(910), db);
    await new Promise((r) => setTimeout(r, 1600));
    delete process.env.CODER_FRONT_ACK; delete process.env.OPEN_CODER_STUDIO_URLS;
    expect(sent.filter((s) => /^🤖/.test(s.text)).length).toBe(0);
    expect(calls.some((b) => /longer worker is starting/.test(String(b)))).toBe(false);   // not even a model call for it
  });
  it("welcome text and system prompt say Nova AI, never 'from the Sham team'", async () => {
    const { welcomeText } = await import("@/lib/coderSections");
    const { coderSystemPrompt } = await import("@/lib/coderAgent");
    expect(welcomeText("سامر")).toContain("Nova AI");
    expect(welcomeText("سامر")).not.toMatch(/فريق شام/);
    for (const owner of [true, false]) {
      const sp = coderSystemPrompt({ github: true, owner, connectors: [], notes: "", date: false } as any);
      expect(sp).toMatch(/I'm Nova AI/);
      expect(sp).not.toMatch(/assistant by the Sham|built by the Sham team\.|say you are Nova AI by the Sham/);
    }
  });
});
