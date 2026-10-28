// ONE message per request (owner 2026-10-28): "فهمت طلبك" + progress within seconds, the same message edited into the live answer; never two messages.
import { fakeBot, fakeDb } from "./coderFakes";
import { openCard, cardNote, cardFinish, understoodLine } from "@/lib/singleMessage";

describe("the shared one-message card", () => {
  it("opens at once with the understood request + progress block, and the final answer is edited INTO it", async () => {
    const { bot, sent, edits } = fakeBot();
    const card = await openCard(bot, 5, "قم بتوليد تقرير عن المشروع");
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/^🕒 .*\d\d:\d\d:\d\d\n💬 /);              // date + time, the neutral "received" line (the model's own line comes in later)
    expect(sent[0].text).not.toMatch(/قم بتوليد تقرير/);                     // never an echo of the request
    expect(sent[0].text).toMatch(/📋 التقدم/);
    await cardNote(bot, 5, card, "قراءة الملفات", true);
    expect(sent[0].text).toMatch(/▶️ \d\d:\d\d:\d\d {2}قراءة الملفات/);
    await cardFinish(bot, 5, card, "هذا هو الجواب النهائي", async (p) => { await bot.api.sendMessage(5, p); });
    expect(sent).toHaveLength(1);                                          // never a second message for a short answer
    expect(sent[0].text).toBe("هذا هو الجواب النهائي");
    expect(edits.length).toBe(2);
  });
  it("a very long final answer overflows into follow-up messages only, each under 4096", async () => {
    const { bot, sent } = fakeBot();
    const card = await openCard(bot, 5, "طلب");
    const long = Array.from({ length: 400 }, (_, i) => `سطر رقم ${i} ${"ا".repeat(30)}`).join("\n");
    await cardFinish(bot, 5, card, long, async (p) => { await bot.api.sendMessage(5, p); });
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((m) => m.text.length <= 4096)).toBe(true);
    expect(sent.map((m) => m.text).join("")).toBe(long);                   // nothing is lost
  });
  it("edits are throttled (Telegram rate limits)", async () => {
    const { bot, edits } = fakeBot();
    const card = await openCard(bot, 5, "x");
    for (let i = 0; i < 20; i++) await cardNote(bot, 5, card, `خطوة ${i}`);
    expect(edits.length).toBeLessThanOrEqual(1);
  });
  it("no card in groups (negative ids) or when switched off", async () => {
    const { bot, sent } = fakeBot();
    expect(await openCard(bot, -100, "x")).toBeNull();
    process.env.CODER_SINGLE_MESSAGE = "off";
    expect(await openCard(bot, 5, "x")).toBeNull();
    delete process.env.CODER_SINGLE_MESSAGE;
    expect(sent).toHaveLength(0);
    expect(understoodLine("")).toMatch(/فهمت طلبك/);                         // the old helper still exists, unused by the cards
  });
});

// ---- Nova engine: the whole path through handleCoderSections
import { handleCoderSections } from "@/lib/coderSections";
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;

describe("Nova: one message per request", () => {
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test"; delete process.env.OPEN_CODER_STUDIO_URLS;
    process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_POLL_MS = "5"; process.env.CODER_TOKEN_KEY = "test-key";
    process.env.SUPER_ADMIN_TELEGRAM_ID = "6161";
  });
  it("the card opens before the model says anything, streams the answer into the SAME message, and ends as that answer (no second message)", async () => {
    let polls = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/")) {
        polls++;
        if (polls < 3) return new Response(sse({ type: "pending", job: "j1", status: "running", phase: "ready", queue_pos: 0, total: 0, text: "الإجابة تبدأ هنا" }), { status: 200 });
        return new Response(sse({ type: "done", job: "j1", text: "الإجابة تبدأ هنا وتنتهي هنا", tool_calls: [] }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    });
    const { bot, sent, edits } = fakeBot();
    const db = fakeDb();
    await handleCoderSections(bot, botRow, { message: { chat: { id: 6161 }, text: "اشرح لي هذا المشروع بإيجاز" } }, db);
    expect(sent).toHaveLength(1);                                        // opened by the time the webhook returns: the instant line
    expect(sent[0].text).toMatch(/^🕒 /);
    expect(sent[0].text).not.toMatch(/فهمت طلبك|اشرح لي هذا المشروع/);       // no canned echo
    expect(sent[0].text).toMatch(/📋 التقدم/);
    for (let i = 0; i < 80 && !/وتنتهي هنا/.test(sent[0]?.text || ""); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(1);                                        // ONE message the whole time
    expect(sent[0].text).toMatch(/الإجابة تبدأ هنا وتنتهي هنا/);
    expect(sent[0].text).not.toMatch(/📋|🕒/);                           // the card is gone: it IS the answer now
    expect(edits.length).toBeGreaterThan(0);
  });
});
