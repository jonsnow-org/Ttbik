// The reply guard is actually wired into Nova's loop: a doubled sentence block the model returns is collapsed in the
// chat, and a word-for-word copy of the previous answer is replaced with the honest line, before it is shown or stored.
import { handleCoderSections, loadState } from "@/lib/coderSections";
import { fakeBot, fakeDb } from "./coderFakes";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const CHAT = 6161;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

function studio(texts: string[]) {
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/") && url.includes("/chat")) return new Response(JSON.stringify({ event_id: `e${i}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: `j${i}`, text: texts[Math.min(i++, texts.length - 1)], tool_calls: [] }), { status: 200 });
    return new Response("{}", { status: 202 });
  });
}

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
});
afterEach(() => { delete process.env.CODER_REPLY_GUARD; });

const msg = (update_id: number, text: string) => ({ update_id, message: { message_id: 7, from: { id: CHAT }, chat: { id: CHAT, type: "private" }, text } });
const shown = (sent: { text: string }[]) => sent.map((s) => s.text).join("\n");

describe("Nova's reply guard runs inside the loop", () => {
  it("collapses an adjacent repeated block the model returned before showing it", async () => {
    const block = "هذا جواب كامل ومفصّل كتبه النموذج لك عن طلبك تماماً.";
    studio([`${block} ${block}`]);
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, msg(7001, "اكتب لي فقرة قصيرة عن نفسك"), fakeDb());
    await new Promise((r) => setTimeout(r, 900));
    const text = shown(sent);
    expect(text).toContain(block);
    expect((text.match(/هذا جواب كامل/g) || []).length).toBe(1);         // shown once, not twice
  });

  it("replaces a word-for-word copy of the previous answer with the honest line", async () => {
    const prior = "أهلاً بك! أنا Nova AI، وأساعدك في البرمجة والبحث.";
    studio([prior, prior]);
    const { bot, sent } = fakeBot();
    const db = fakeDb();
    await handleCoderSections(bot, botRow, msg(7002, "مرحباً"), db);
    await new Promise((r) => setTimeout(r, 900));
    await handleCoderSections(bot, botRow, msg(7003, "أخبرني عن نفسك مرة أخرى بالتفصيل"), db);
    await new Promise((r) => setTimeout(r, 900));
    const text = shown(sent);
    expect(text).toContain("تعذّر تكوين جواب مناسب");                    // the copy was replaced, not delivered again
  });
});
