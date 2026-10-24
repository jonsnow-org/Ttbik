// Conversation threads (src/lib/coderThreads.ts): separate chats, nothing wiped, delete = hide, every message goes to the model,
// the app's ⏹ cancels the Studio job like /stop, memory extraction happens in quiet time and not on the reply path.
import { appOp } from "@/lib/coderApp";
import { capMessages } from "@/lib/coderThreads";
import { fakeBot, fakeDb } from "./coderFakes";

const U = 3003;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const urls: string[] = [];
beforeAll(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "k";
});
beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  urls.length = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    urls.push(url);
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: "أهلاً! كيف بقدر ساعدك؟", tool_calls: [], timings: { prompt_n: 900, predicted_n: 12 } }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
});
const wait = () => new Promise((r) => setTimeout(r, 300));

describe("conversation threads", () => {
  it("a greeting goes to the model (no canned reply) and lands in a thread; a new chat keeps the old one", async () => {
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    const { handleCoderSections, loadState } = await import("@/lib/coderSections");
    await handleCoderSections(bot, botRow, { message: { chat: { id: U }, from: { id: U, first_name: "Ali" }, text: "مرحبا" } }, db);
    await wait();
    expect(urls.some((u) => u.includes("/call/v2/chat"))).toBe(true);
    expect(sent.some((s) => s.text.includes("كيف بقدر ساعدك"))).toBe(true);
    const st = await loadState(U, db);
    expect(st.threadId).toBeTruthy();
    expect(db.t.tasks[0].thread_id).toBe(st.threadId);
    const first = st.threadId;
    const user = { chatId: U, tier: "user" as const };
    const r = await appOp(user, "thread_new", {}, { db, bot, botRow });
    expect(r.id).not.toBe(first);
    const again = await appOp(user, "thread_new", {}, { db, bot, botRow });
    expect(again.id).toBe(r.id);                                                  // an empty new chat is reused
    const list = await appOp(user, "threads", {}, { db, bot, botRow });
    expect(list.threads.map((x: any) => x.id)).toEqual(expect.arrayContaining([first, r.id]));
    expect(list.current).toBe(r.id);
    const old = db.t.threads.find((x: any) => x.id === first);
    expect(old.messages.length).toBeGreaterThan(0);                               // nothing wiped
    expect(old.title).toBe("مرحبا");
    await appOp(user, "thread_open", { id: first }, { db, bot, botRow });
    expect((await loadState(U, db)).messages.length).toBe(old.messages.length);
    await appOp(user, "thread_rename", { id: first, title: "تحية" }, { db, bot, botRow });
    await appOp(user, "thread_delete", { id: first }, { db, bot, botRow });
    expect(db.t.threads.find((x: any) => x.id === first).deleted_at).toBeTruthy();  // hidden, kept
    expect((await loadState(U, db)).threadId).not.toBe(first);
  });
  it("the app's stop cancels the Studio job, like /stop", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    const { saveState, loadState } = await import("@/lib/coderSections");
    await saveState(U, { mode: "coder", think: false, messages: [{ role: "user", content: "x" }], notes: "", inbox: ["y"], run: { id: "r1", chain: "c", sent: 0, step: 1, lease: Date.now(), job: "j9" } }, db);
    const r = await appOp({ chatId: U, tier: "user" }, "stop", { runId: "r1", slot: "" }, { db, bot, botRow });
    expect(r.ok).toBe(true);
    await wait();
    expect(urls.some((u) => /cancel/.test(u))).toBe(true);
    expect((await loadState(U, db)).run).toBeNull();
  });
  it("the stored copy is capped and never starts with an orphan tool result", () => {
    const msgs: any[] = [{ role: "tool", content: "t" }, ...Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }))];
    expect(capMessages(msgs, 40).length).toBe(40);
    expect(capMessages([{ role: "tool", content: "t" } as any, { role: "user", content: "u" }], 40)[0].role).toBe("user");
  });
});
