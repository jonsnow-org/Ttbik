// The owner's live @Slaselbot task (2026-11-24): Nova listed the account's repositories and asked which one;
// the owner answered «هذا بوت تلجرام وليس مستودع وهو موجود في مستودعنا jonsnow-org/Ttbik» and the task then died —
// the model kept repeating «سأبدأ الآن…», the reply guard blocked the copy, the chat received the engine's own
// «تعذّر تكوين جواب مناسب لهذه الرسالة» three times, and the run ended with nothing changed.
//
// These tests drive the REAL loop (handleCoderSections → driveLoop) with a fake Studio, and hold the two fixes:
// 1) a blocked reply is not the answer of an owner action request: the run goes back to work and, at the end of its
//    attempts, says honestly what happened (never the engine placeholder);
// 2) a bot handle / project name is not a repository: the prompt tells the model to search inside the named repository.
import { handleCoderSections, loadState } from "@/lib/coderSections";
import { coderSystemPrompt } from "@/lib/coderAgent";
import { stalledActionNote, finishNudge } from "@/lib/coderFinishGate";
import { NOVA_STALE_AR } from "@/lib/novaReplyGuard";
import { fakeBot, fakeDb } from "./coderFakes";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const CHAT = 4242;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;

function studio(replies: object[]) {
  const calls: { url: string; body?: any }[] = [];
  const pendingReplies = new Map<string, object>();
  let nextReply = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/status")) return new Response(JSON.stringify({ event_id: `status${calls.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/status/")) return new Response(sse({ phase: "ready", queue: 0, model: "coder" }), { status: 200 });
    if (url.includes("/gradio_api/call/v2/chat")) {
      const id = `e${calls.length}`;
      pendingReplies.set(id, replies[Math.min(nextReply++, replies.length - 1)] as object);
      return new Response(JSON.stringify({ event_id: id }), { status: 200 });
    }
    if (url.includes("/gradio_api/call/chat/")) {
      const id = url.slice(url.lastIndexOf("/") + 1);
      return new Response(sse(pendingReplies.get(id) || { type: "done", text: "", tool_calls: [] }), { status: 200 });
    }
    if (url.startsWith("https://api.github.com")) return new Response(JSON.stringify({ message: "nf" }), { status: 404 });
    return new Response("{}", { status: 202 });
  });
  return calls;
}

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.OPEN_CODER_STUDIO_URLS = "https://coder2.test,https://coder3.test,https://coder4.test,https://coder5.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
  process.env.CRON_SECRET = "cron-secret";
});

describe("the owner's action task survives a repeated announcement", () => {
  it("never shows the engine's placeholder: it goes back to work, then says honestly that nothing was changed", async () => {
    // the same plan announcement, over and over (what the live model did after the correction)
    const announced = { type: "done", job: "j", text: "شكراً للتوضيح. سأبدأ الآن بتحليل البوت داخل مستودع jonsnow-org/Ttbik وتطبيقه المصغر.", tool_calls: [] };
    studio(Array(14).fill(announced));
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اذهب لمستودعنا على جيتهوب موقع شام آي بوت سلاسل يومية @Slaselbot\nقم بتحليل البوت وتطبيقه المصغر بشكل كامل\nوقم باصلاح اخطاء البوت والتطبيق وقم بتطوير التطبيق المصغر بشكل احترافي" } }, db);
    for (let i = 0; i < 80 && (await loadState(CHAT, db)).run; i++) await new Promise((r) => setTimeout(r, 250));

    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "هذا بوت تلجرام وليس مستودع وهو موجود في مستودعنا jonsnow-org/Ttbik" } }, db);
    for (let i = 0; i < 120 && (await loadState(CHAT, db)).run; i++) await new Promise((r) => setTimeout(r, 250));

    const texts = sent.map((s: any) => String(s.text));
    expect(texts.join("\n")).not.toContain(NOVA_STALE_AR);          // the engine's placeholder is never the answer
    expect(texts.some((t) => /تابع/.test(t))).toBe(true);            // an honest line the owner can act on
    expect(texts.join("\n")).toMatch(/لم يُغيَّر أي ملف/);
    expect((await loadState(CHAT, db)).run).toBeNull();              // the run ends instead of hanging
  }, 60000);
});

describe("a bot handle or project name is not a repository", () => {
  const prompt = coderSystemPrompt({ github: true, notes: "", owner: true });
  it("tells the model to search inside the named repository instead of asking again", () => {
    expect(prompt).toMatch(/NAME RULE/);
    expect(prompt).toMatch(/is NOT a repository/);
    expect(prompt).toMatch(/github_search_code/);
    expect(prompt).toMatch(/do NOT ask again/);
    expect(prompt).toMatch(/One clarifying question per request is the maximum/);
  });
});

describe("stalledActionNote", () => {
  it("speaks for an action request that changed nothing, and stays silent otherwise", () => {
    expect(stalledActionNote("طوّر التطبيق المصغر وأصلح أخطاءه", ["github_read_files"])).toMatch(/لم يُغيَّر أي ملف/);
    expect(stalledActionNote("طوّر التطبيق المصغر", ["github_write_files"])).toBe("");
    expect(stalledActionNote("كيف حالك", [])).toBe("");
  });
  it("is only reached when the nudge budget is used up", () => {
    expect(finishNudge("طوّر التطبيق", ["github_read_files"], "سأبدأ الآن بتحليل البوت داخل مستودع jonsnow-org/Ttbik وتطبيقه المصغر.", 3)).toBe("");
  });
});
