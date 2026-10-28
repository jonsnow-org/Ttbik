// The progress card (owner 2026-10-28): the understanding line comes from the MODEL (time-boxed, neutral fallback), the steps come from REAL events with their exact
// Istanbul time and duration, still ONE message edited in place. Nothing is invented: no event, no line.
import { beginStep, cleanUnderstanding, clockAt, dateAt, endStep, fmtDur, NEUTRAL_ACK, newTimeline, renderTimeline, stepLabel, understandRequest, understandingPrompt } from "@/lib/agentCard";
import { cardFinish, cardPhase, cardRestore, cardSnapshot, cardStepDone, cardTool, openCard } from "@/lib/singleMessage";
import { shamAgentRun, shamToolDefs, type ShamAsk, type ShamStepEvent } from "@/lib/shamAgent";
import { shamVariant } from "@/lib/shamStudio";
import type { ShamCtx } from "@/lib/shamExec";
import { fakeBot, fakeDb } from "./coderFakes";

beforeEach(() => { process.env.CARD_TZ = "Europe/Istanbul"; });
afterEach(() => { jest.useRealTimers(); });

describe("clock and durations (Istanbul)", () => {
  it("12:00:05 UTC is 15:00:05 in Istanbul, with the Arabic date", () => {
    const t = Date.parse("2026-10-28T12:00:05Z");
    expect(clockAt(t)).toBe("15:00:05");
    expect(dateAt(t)).toBe("الأربعاء 28 أكتوبر 2026");
  });
  it("durations are short and exact", () => {
    expect(fmtDur(400)).toBe("0.4ث");
    expect(fmtDur(3200)).toBe("3.2ث");
    expect(fmtDur(42000)).toBe("42ث");
    expect(fmtDur(125000)).toBe("2د 05ث");
  });
});

describe("what a tool step says", () => {
  it.each([
    ["sandbox_read_file", { path: "src/a.ts" }, "قراءة ملف src/a.ts"],
    ["github_read_file", { repo: "o/r", path: "README.md" }, "قراءة ملف o/r:README.md"],
    ["sandbox_edit_file", { path: "src/a.ts", old: "x", new: "y" }, "تعديل ملف src/a.ts"],
    ["github_edit_file", { repo: "o/r", path: "a.ts" }, "تعديل ملف o/r:a.ts"],
    ["sandbox_exec", { command: "npm test" }, "تشغيل أمر: npm test"],
    ["web_search", { query: "next.js 16" }, "بحث في الويب: next.js 16"],
    ["make_media", { kind: "video" }, "توليد فيديو"],
    ["make_media", { kind: "image" }, "توليد صورة"],
    ["fetch_page", { url: "https://example.com/docs/a" }, "قراءة صفحة example.com/docs/a"],
  ])("%s", (name, args, want) => expect(stepLabel(name, JSON.stringify(args))).toBe(want));
  it("a bad or missing argument string never throws", () => {
    expect(stepLabel("sandbox_read_file", "{broken")).toBe("قراءة ملف");
    expect(stepLabel("unknown_tool")).toBe("أداة unknown_tool");
  });
});

describe("the timeline renders only what happened", () => {
  it("exact times, durations, a running step, a failed step; the earlier steps fold", () => {
    const t0 = Date.parse("2026-10-28T12:00:00Z");
    const tl = newTimeline(t0);
    tl.ack = "سأقرأ ملف الدخول ثم أصلح الخطأ.";
    beginStep(tl, "phase", "think", "جاري التفكير", t0 + 1000);
    beginStep(tl, "tool", "tool", "قراءة ملف src/auth.ts", t0 + 4000);
    beginStep(tl, "tool", "tool", "تشغيل أمر: npm test", t0 + 5200);
    endStep(tl, false, t0 + 9200);
    beginStep(tl, "phase", "write", "جاري الكتابة", t0 + 9300);
    const text = renderTimeline(tl, t0 + 15000);
    expect(text).toContain("🕒 الأربعاء 28 أكتوبر 2026 · 15:00:00");
    expect(text).toContain("💬 سأقرأ ملف الدخول ثم أصلح الخطأ.");
    expect(text).toContain("✅ 15:00:01  جاري التفكير · 3.0ث");
    expect(text).toContain("✅ 15:00:04  قراءة ملف src/auth.ts · 1.2ث");
    expect(text).toContain("❌ 15:00:05  تشغيل أمر: npm test · 4.0ث");
    expect(text).toContain("▶️ 15:00:09  جاري الكتابة… · منذ 5.7ث");
    for (let i = 0; i < 20; i++) beginStep(tl, "tool", "tool", `قراءة ملف f${i}`, t0 + 20000 + i * 1000);
    const folded = renderTimeline(tl, t0 + 60000);
    expect(folded).toMatch(/… \d+ خطوات سابقة/);
    expect(folded.length).toBeLessThanOrEqual(4000);
  });
  it("the same phase refreshes its label (reading 40% -> 70%) instead of adding a line", () => {
    const tl = newTimeline(1000);
    expect(beginStep(tl, "phase", "read", "جاري قراءة المهمة 40%", 2000)).toBe(true);
    expect(beginStep(tl, "phase", "read", "جاري قراءة المهمة 70%", 3000)).toBe(false);
    expect(tl.steps).toHaveLength(1);
    expect(tl.steps[0].label).toBe("جاري قراءة المهمة 70%");
  });
  it("without an ack the card says a neutral line, never the request", () => {
    const tl = newTimeline(1000);
    expect(renderTimeline(tl, 2000)).toContain(`💬 ${NEUTRAL_ACK}`);
  });
});

describe("the model's own understanding line", () => {
  it("the prompt asks for one short sentence in the request's language, no answer, no tools", () => {
    const p = understandingPrompt("أصلح الخطأ في auth.ts");
    expect(p).toMatch(/SAME language/);
    expect(p).toMatch(/ONE short sentence/);
    expect(p).toContain("أصلح الخطأ في auth.ts");
  });
  it("cleaning: first sentence, no think markup, no tool plan, no echo of the request", () => {
    expect(cleanUnderstanding("<think>hmm</think>فهمت أنك تريد إصلاح خطأ الدخول؛ سأقرأ الملف أولاً. وبعدها أجرب.", "أصلح الخطأ")).toBe("فهمت أنك تريد إصلاح خطأ الدخول؛ سأقرأ الملف أولاً.");
    expect(cleanUnderstanding('<tool_call>{"name":"sandbox_exec","arguments":{}}</tool_call>')).toBeNull();
    expect(cleanUnderstanding("أصلح الخطأ في ملف auth.ts الموجود في المشروع", "أصلح الخطأ في ملف auth.ts الموجود في المشروع")).toBeNull();
    expect(cleanUnderstanding("ok")).toBeNull();
    expect(cleanUnderstanding("x".repeat(400))!.length).toBeLessThanOrEqual(160);
  });
  it("a fast model: its line is returned", async () => {
    expect(await understandRequest(async () => "تريد شرح المشروع؛ سأقرأ ملفاته أولاً.", "اشرح المشروع")).toBe("تريد شرح المشروع؛ سأقرأ ملفاته أولاً.");
  });
  it("a slow model: null at the cap (neutral line), and the real line is handed over late", async () => {
    const late: string[] = [];
    const t0 = Date.now();
    const r = await understandRequest(() => new Promise((res) => setTimeout(() => res("تريد شرح المشروع؛ سأقرأ ملفاته أولاً."), 120)), "اشرح المشروع", { ms: 30, lateMs: 1000, onLate: (l) => late.push(l) });
    expect(r).toBeNull();
    expect(Date.now() - t0).toBeLessThan(110);                            // never waits longer than the cap
    await new Promise((res) => setTimeout(res, 200));
    expect(late).toEqual(["تريد شرح المشروع؛ سأقرأ ملفاته أولاً."]);
  });
  it("a model that fails or never answers cannot break the card", async () => {
    expect(await understandRequest(async () => { throw new Error("503"); }, "x", { ms: 20 })).toBeNull();
    expect(await understandRequest(() => new Promise(() => undefined), "x", { ms: 20, lateMs: 20, onLate: () => { throw new Error("never"); } })).toBeNull();
  });
});

describe("the one Telegram message (Sham / shared card)", () => {
  it("opens at once, takes the model's line, shows real tool steps, and the answer replaces it; never a second message", async () => {
    const { bot, sent, edits } = fakeBot();
    const card = await openCard(bot, 5, "اقرأ README", { understand: async () => "تريد قراءة ملف README؛ سأفتحه أولاً." });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(`💬 ${NEUTRAL_ACK}`);                  // first paint: no wait for the model
    await new Promise((r) => setTimeout(r, 20));
    expect(sent[0].text).toContain("💬 تريد قراءة ملف README؛ سأفتحه أولاً.");   // the model's own line, edited in
    await cardPhase(bot, 5, card, "think", "جاري التفكير");
    await cardTool(bot, 5, card, "قراءة ملف o/r:README.md");
    await cardStepDone(bot, 5, card, true);
    await cardFinish(bot, 5, card, "هذا هو الملخص.", async (p) => { await bot.api.sendMessage(5, p); });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("هذا هو الملخص.");
    const n = edits.length;
    await new Promise((r) => setTimeout(r, 2300));                        // a late timer / late ack can never overwrite the answer
    expect(edits.length).toBe(n);
    expect(sent[0].text).toBe("هذا هو الملخص.");
  });
  it("the last event is never lost to the edit throttle (a timer flushes it)", async () => {
    const { bot, sent } = fakeBot();
    const card = await openCard(bot, 5, "x");
    await cardTool(bot, 5, card, "تشغيل أمر: npm test");
    expect(sent[0].text).not.toContain("npm test");                       // within the 2 s window: not edited yet
    await new Promise((r) => setTimeout(r, 2200));
    expect(sent[0].text).toContain("تشغيل أمر: npm test");
  });
  it("a long task keeps its card between legs: snapshot -> restore keeps the steps and the ack", async () => {
    const { bot, sent } = fakeBot();
    const card = await openCard(bot, 5, "x", { understand: async () => "سأنفذ المهمة على مراحل." });
    await new Promise((r) => setTimeout(r, 20));
    await cardTool(bot, 5, card, "قراءة ملف a.ts");
    const snap = JSON.parse(JSON.stringify(cardSnapshot(card!)));
    const again = cardRestore(snap);
    expect(again.ack).toBe("سأنفذ المهمة على مراحل.");
    expect(again.steps.map((s) => s.label)).toContain("قراءة ملف a.ts");
    await cardTool(bot, 5, again, "تعديل ملف a.ts");
    await cardStepDone(bot, 5, again, true);
    await new Promise((r) => setTimeout(r, 2200));
    expect(sent[0].text).toContain("تعديل ملف a.ts");
  });
});

// ---- Sham v2's real agent events reach the card
const ctx = { chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: "t", chatKey: "sham:1", runId: "sham-1", owner: true } as unknown as ShamCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say>>): ShamAsk => async () => (answers.shift() ?? null) as any;

describe("Sham v2 agent -> card events (real, in order)", () => {
  const read = '<tool_call>{"name":"github_read_file","arguments":{"repo":"o/r","path":"README.md"}}</tool_call>';
  it("think, tool start (with the repo and path), tool end ok, think again", async () => {
    const ev: ShamStepEvent[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "اقرأ README", ctx, tools: shamToolDefs(true), budgetMs: 60000, now: () => Date.now(), ask: script([say(read), say("الملف يشرح المشروع.")]),
      exec: async () => "# Title\nhello", onStep: (e) => ev.push(e),
    }));
    expect(r).toMatchObject({ kind: "text", text: "الملف يشرح المشروع." });
    expect(ev.map((e) => e.type)).toEqual(["think", "tool_start", "tool_end", "think"]);
    expect(ev[1]).toMatchObject({ type: "tool_start", name: "github_read_file" });
    expect(stepLabel((ev[1] as any).name, (ev[1] as any).args)).toBe("قراءة ملف o/r:README.md");
    expect(ev[2]).toMatchObject({ type: "tool_end", ok: true });
  });
  it("a tool that fails is reported as failed (❌), never as done", async () => {
    const ev: ShamStepEvent[] = [];
    await shamVariant.run("v2", () => shamAgentRun({
      text: "اقرأ README", ctx, tools: shamToolDefs(true), budgetMs: 60000, now: () => Date.now(), ask: script([say(read), say("تعذر."), say("تعذر قراءة الملف.")]),
      exec: async () => "error: not found", onStep: (e) => ev.push(e),
    }));
    expect(ev.find((e) => e.type === "tool_end")).toMatchObject({ ok: false });
  });
});

// ---- Nova's real events reach the card
import { handleCoderSections } from "@/lib/coderSections";
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const tc = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("Nova: the card is written from the loop's real events", () => {
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test"; delete process.env.OPEN_CODER_STUDIO_URLS;
    process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_POLL_MS = "5"; process.env.CODER_TOKEN_KEY = "test-key";
    process.env.SUPER_ADMIN_TELEGRAM_ID = "6161"; process.env.CODER_GITHUB_TOKEN = "gh"; process.env.CODER_CARD_GAP_MS = "0";
  });
  afterEach(() => { delete process.env.CODER_CARD_GAP_MS; });
  it("a file read shows «قراءة ملف repo:path» with its time, then ✅ with a duration; the answer replaces the card in the same message", async () => {
    const replies = [
      { type: "done", job: "j1", text: "", tool_calls: [tc("r1", "github_read_file", { repo: "a/b", path: "src/x.ts" })] },
      { type: "done", job: "j2", text: "الملف يعرّف دالة واحدة.", tool_calls: [] },
    ];
    let i = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0 }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse(replies[Math.min(i++, replies.length - 1)]), { status: 200 });
      if (url.startsWith("https://api.github.com")) return new Response(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from("export const x = 1;\n").toString("base64"), size: 20, name: "x.ts", path: "src/x.ts" }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const { bot, sent, edits } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: 6161 }, text: "اشرح الملف src/x.ts في a/b" } }, fakeDb());
    for (let k = 0; k < 80 && !/دالة واحدة/.test(sent[0]?.text || ""); k++) await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("الملف يعرّف دالة واحدة.");
    const seen = edits.map((e) => e.text);
    expect(seen.some((t) => /▶️ \d\d:\d\d:\d\d {2}جاري التنفيذ · قراءة ملف a\/b:src\/x\.ts/.test(t))).toBe(true);   // while it ran
    expect(seen.some((t) => /✅ \d\d:\d\d:\d\d {2}قراءة ملف a\/b:src\/x\.ts · [\d.]+ث/.test(t))).toBe(true);        // when it ended, with its duration
    expect(seen.every((t) => !/فهمت طلبك/.test(t))).toBe(true);
  });
});
