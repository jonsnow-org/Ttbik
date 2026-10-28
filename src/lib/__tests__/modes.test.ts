// ONE mode system for every model (src/lib/modes.ts, docs/MODES.md): classification, the mode table, thinking rules, Nova's real loop, Sham's agent, the owner's force.
import { classifyRequest, effectiveMode, resolveProfile, normalizePref, NOVA_LITE_SYSTEM } from "@/lib/modes";
import { _setForcedForTests, forcedMode, refreshForced } from "@/lib/modeForce";
import { drive, saveState, loadState, type Db } from "@/lib/coderSections";
import { shamAgentRun } from "@/lib/shamAgent";
import { shamModeCtx, shamVariant } from "@/lib/shamStudio";
import { shamToolDefs } from "@/lib/shamAgent";
import { appOp } from "@/lib/coderApp";
import { fakeBot as appBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const CHAT = 4242;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
function memDb(): Db {
  const rows = new Map<string, any>();
  return {
    exec: async (sql: string, ...args: unknown[]) => { if (!sql.includes("coder_stall_log") && !sql.includes("coder_connections")) rows.set(String(args[0]), JSON.parse(String(args[1]))); },
    query: async <T,>(sql: string, key: unknown) => (sql.includes("coder_connections") || sql.includes("coder_stall_log") ? [] : rows.has(String(key)) ? [{ state: JSON.parse(JSON.stringify(rows.get(String(key)))) }] : []) as T[],
  };
}
function fakeBot() {
  const sent: { text: string }[] = [];
  const api = { sendMessage: jest.fn(async (_c: number, text: string) => { sent.push({ text }); return {}; }), sendChatAction: jest.fn(async () => ({})), answerCallbackQuery: jest.fn(async () => ({})), editMessageReplyMarkup: jest.fn(async () => ({})) };
  return { bot: { api } as any, sent };
}
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
function studio(replies: object[]) {
  const calls: { url: string; body?: any }[] = [];
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: `e${calls.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse(replies[Math.min(i++, replies.length - 1)] as object), { status: 200 });
    if (url.startsWith("https://api.github.com")) return new Response(JSON.stringify({ content: Buffer.from("# hi").toString("base64"), sha: "abc1234" }), { status: 200 });
    return new Response("{}", { status: 202 });
  });
  return calls;
}
const chats = (calls: { url: string; body?: any }[]) => calls.filter((c) => c.url.includes("/call/v2/chat") && !/long-term memory about ONE user/.test(JSON.stringify(c.body)));

beforeEach(() => {
  _setForcedForTests({});
  process.env.CODER_OUTAGE_STEP_MS = "5";
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
});

describe("classifyRequest", () => {
  it.each([
    ["مرحبا", "trivial"], ["السلام عليكم", "trivial"], ["شكرا لك", "trivial"], ["hi", "trivial"], ["من انت", "trivial"], ["كيف حالك؟", "trivial"],
    ["قم بتوليد صورة أسد", "media"], ["make a short video of a rabbit", "media"],
    ["ما هي عاصمة فرنسا؟", "chat"], ["ما سعر الذهب اليوم؟", "chat"], ["اشرح لي الفرق بين الذكاء الاصطناعي والتعلم الآلي", "chat"], ["نعم", "chat"], ["اكمل", "chat"],
    ["اكتب دالة بايثون تعكس النص", "code"], ["fix this bug: TypeError in my function", "code"], ["```js\nconst a = 1\n```\nما الخطأ؟", "code"],
    ["اقرأ ملف README في مستودع octocat/Hello-World ولخصه", "agentic"], ["merge the open PRs of acme/app and deploy", "agentic"], ["حلل المشروع كله ثم اكتب تقريراً", "agentic"], ["x".repeat(800), "agentic"],
  ])("%s -> %s", (text, klass) => { expect(classifyRequest(text as string)).toBe(klass); });
});

describe("the mode table", () => {
  it("trivial and media are always fast, whatever the preference or Auto", () => {
    for (const pref of ["fast", "balanced", "precise"] as const) for (const auto of [true, false]) for (const k of ["trivial", "media"] as const) expect(effectiveMode(pref, k, auto)).toBe("fast");
  });
  it("Auto: chat is fast (balanced for a precise user), code follows the preference, agent work is never below balanced", () => {
    expect([effectiveMode("fast", "chat", true), effectiveMode("balanced", "chat", true), effectiveMode("precise", "chat", true)]).toEqual(["fast", "fast", "balanced"]);
    expect([effectiveMode("fast", "code", true), effectiveMode("balanced", "code", true), effectiveMode("precise", "code", true)]).toEqual(["fast", "balanced", "precise"]);
    expect([effectiveMode("fast", "agentic", true), effectiveMode("balanced", "agentic", true), effectiveMode("precise", "agentic", true)]).toEqual(["balanced", "balanced", "precise"]);
  });
  it("Auto off: exactly the user's mode (but trivial / media stay fast)", () => {
    expect(effectiveMode("precise", "chat", false)).toBe("precise");
    expect(effectiveMode("fast", "agentic", false)).toBe("fast");
  });
  it("'accurate' is accepted as 'precise'", () => { expect(normalizePref("accurate")).toBe("precise"); expect(normalizePref("x")).toBeUndefined(); });
});

describe("resolveProfile: thinking, budgets, lite", () => {
  const p = (o: Parameters<typeof resolveProfile>[0]) => resolveProfile(o);
  it("never thinks for a greeting or a media request, whatever the policy, mode or switch", () => {
    for (const text of ["مرحبا", "قم بتوليد صورة أسد"]) for (const model of ["nova", "sham_v2"] as const) for (const policy of ["adaptive", "always"]) {
      const r = p({ model, pref: "precise", policy, text });
      expect(r.think).toBe(false); expect(r.thinkAct).toBe(false); expect(r.thinkTokens).toBe(0); expect(r.mode).toBe("fast");
    }
  });
  it("Nova, adaptive (the default): thinks at the PLAN stage of code and agent work in every mode, never on the tool steps, never for plain chat", () => {
    for (const pref of ["fast", "balanced", "precise"]) {
      for (const text of ["اكتب دالة بايثون", "اقرأ README في octocat/Hello-World"]) expect(p({ model: "nova", pref, text })).toMatchObject({ policy: "adaptive", think: true, thinkAct: false });
      expect(p({ model: "nova", pref, text: "ما هي عاصمة فرنسا؟" })).toMatchObject({ think: false, thinkAct: false });
    }
  });
  it("Nova, always (the old 'deeper thinking' switch): every stage of every non-trivial request; never: nothing", () => {
    expect(p({ model: "nova", thinkSwitch: true, text: "اكتب دالة بايثون" })).toMatchObject({ policy: "always", think: true, thinkAct: true });
    expect(p({ model: "nova", thinkSwitch: true, text: "ما هي عاصمة فرنسا؟" })).toMatchObject({ think: true, thinkAct: true });
    expect(p({ model: "nova", policy: "never", thinkSwitch: true, text: "اكتب دالة بايثون" })).toMatchObject({ policy: "never", think: false, thinkAct: false });
  });
  it("the thought budget keeps its old sizes: 500 / 1200 / 3000 characters", () => {
    expect(["fast", "balanced", "precise"].map((m) => p({ model: "nova", pref: m, auto: false, text: "اكتب دالة" }).thinkCapChars)).toEqual([500, 1200, 3000]);
  });
  it("the env default policy applies when the user chose nothing", () => {
    process.env.CODER_THINK_POLICY = "never";
    try { expect(p({ model: "nova", text: "اكتب دالة بايثون" }).think).toBe(false); expect(p({ model: "nova", policy: "adaptive", text: "اكتب دالة بايثون" }).think).toBe(true); }
    finally { delete process.env.CODER_THINK_POLICY; }
  });
  it("Sham v2 was never trained to think: no automatic thought, only when asked, only on code / agent work", () => {
    expect(p({ model: "sham_v2", pref: "precise", text: "اكتب دالة بايثون" })).toMatchObject({ think: false, thinkAct: false });
    expect(p({ model: "sham_v2", thinkSwitch: true, text: "اكتب دالة بايثون" })).toMatchObject({ think: true });
    expect(p({ model: "sham_v2", thinkSwitch: true, text: "ما هي عاصمة فرنسا؟" }).think).toBe(false);
  });
  it("Nova: plain replies are capped, code and tool steps are not; greetings and plain fast chat use the lite path, code never", () => {
    expect(p({ model: "nova", text: "مرحبا" })).toMatchObject({ lite: true, maxTokens: 200 });
    expect(p({ model: "nova", text: "ما هي عاصمة فرنسا؟" })).toMatchObject({ lite: true, maxTokens: 450 });
    expect(p({ model: "nova", text: "اكتب دالة بايثون" })).toMatchObject({ lite: false, maxTokens: 0 });
    expect(p({ model: "nova", text: "عدّل" }).lite).toBe(false);                                   // a terse command continues a task: every tool stays
    expect(p({ model: "nova", text: "كمل من حيث توقفت" }).lite).toBe(false);
    expect(p({ model: "nova", text: "ما سعر الذهب اليوم؟" }).lite).toBe(false);                    // needs today's facts: the web tools stay
    expect(p({ model: "nova", pref: "precise", text: "ما هي عاصمة فرنسا؟" }).lite).toBe(false);     // a precise user gets a balanced chat WITH tools
    expect(p({ model: "nova", text: "اقرأ README في octocat/Hello-World" }).lite).toBe(false);
    expect(p({ model: "sham_v2", text: "مرحبا" }).lite).toBe(true);                                   // Sham v2: no tool block for a greeting only
    expect(p({ model: "sham_v2", text: "ما هي عاصمة فرنسا؟" }).lite).toBe(false);
    expect(p({ model: "sham_v2", text: "اكتب دالة بايثون" }).lite).toBe(false);
  });
  it("the old Sham body cannot think", () => { expect(p({ model: "sham", pref: "precise", thinkSwitch: true, text: "اكتب دالة بايثون" }).think).toBe(false); });
  it("explicit settings of each mode", () => {
    const t = (pref: any) => p({ model: "nova", pref, auto: false, text: "اكتب دالة" });
    expect([t("fast").temperature, t("balanced").temperature, t("precise").temperature]).toEqual([0.7, 0.6, 0.2]);
    expect([t("fast").corrections, t("balanced").corrections, t("precise").corrections]).toEqual([1, 2, 3]);
    expect([t("fast").maxNewFactor, t("balanced").maxNewFactor, t("precise").maxNewFactor]).toEqual([0.6, 1, 1.5]);
    expect(t("fast").note).toMatch(/SPEED/); expect(t("precise").note).toMatch(/ACCURACY/); expect(t("balanced").note).toBe("");
  });
  it("the owner's force wins over the preference and Auto", () => {
    const r = p({ model: "nova", pref: "fast", auto: true, force: "precise", text: "اكتب دالة بايثون" });
    expect(r).toMatchObject({ mode: "precise", auto: false, think: true });
    expect(p({ model: "nova", force: "precise", thinkSwitch: true, text: "مرحبا" }).think).toBe(false);          // …but a greeting still never thinks
  });
  it("pictures: always ONE step (SDXS is a one-step model: more steps are noise), the side grows with the mode, pressure mode shrinks it", () => {
    expect(p({ model: "sham_v2", pref: "precise", auto: false, text: "x" }).image).toEqual({ size: 640, steps: 1 });
    expect(p({ model: "sham_v2", pref: "fast", auto: false, text: "x" }).image).toEqual({ size: 512, steps: 1 });
    expect(p({ model: "sham_v2", pressure: true, text: "x" }).image).toEqual({ size: 384, steps: 1 });
  });
});

describe("Nova's real loop uses the profile", () => {
  it("a greeting: the short system text, no tool list, an answer cap, no thinking — in one call", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "أهلاً بك!", tool_calls: [] }]);
    const db = memDb(); const { bot, sent } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: true, accuracy: "precise", messages: [{ role: "user", content: "مرحبا" }], notes: "", inbox: [], run: { id: "r1", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const first = chats(calls)[0].body;
    expect(first.tools).toBe(""); expect(first.think).toBe(""); expect(first.max_tokens).toBe(200);
    expect(JSON.parse(first.messages)[0].content).toBe(NOVA_LITE_SYSTEM);
    expect(sent.map((s) => s.text)).toContain("أهلاً بك!");
  });
  it("a greeting right after a question or a tool call keeps the full path (it may be the answer to it)", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "تمام.", tool_calls: [] }]);
    const db = memDb(); const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "اقرأ ملف README" }, { role: "assistant", content: "هل تريد المتابعة؟" }, { role: "user", content: "شكرا" }], notes: "", inbox: [], run: { id: "r1b", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(chats(calls)[0].body.tools).not.toBe("");
  });
  it("plain code writing keeps every tool AND its thought at the plan stage; no answer cap", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "```python\ndef f(): pass\n```", tool_calls: [] }]);
    const db = memDb(); const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, accuracy: "balanced", messages: [{ role: "user", content: "اكتب دالة بايثون تعكس النص" }], notes: "", inbox: [], run: { id: "r1c", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const first = chats(calls)[0].body;
    expect(first.tools).not.toBe(""); expect(first.think).toBe("1"); expect(first.max_tokens).toBe(0);
    expect(JSON.parse(first.messages)[0].content).not.toBe(NOVA_LITE_SYSTEM);
  });
  it("agent work, adaptive (default): a thought at the PLAN stage only; the tool steps do not think", async () => {
    const readA = { id: "r", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: "a/b", path: "README.md" }) } };
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [readA] }, { type: "done", job: "j2", text: "انتهيت.", tool_calls: [] }]);
    const db = memDb(); const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, accuracy: "balanced", messages: [{ role: "user", content: "اقرأ ملف README في مستودع a/b ولخصه" }], notes: "", inbox: [], run: { id: "r2", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const c = chats(calls);
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c[0].body.think).toBe("1"); expect(c[0].body.max_tokens).toBe(0);
    expect(c[1].body.think).toBe("");
  });
  it("agent work with the 'deeper thinking' switch (policy always): every step thinks", async () => {
    const readA = { id: "r", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: "a/b", path: "README.md" }) } };
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [readA] }, { type: "done", job: "j2", text: "انتهيت.", tool_calls: [] }]);
    const db = memDb(); const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: true, accuracy: "balanced", messages: [{ role: "user", content: "اقرأ ملف README في مستودع a/b ولخصه" }], notes: "", inbox: [], run: { id: "r2b", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const c = chats(calls);
    expect(c[0].body.think).toBe("1"); expect(c[1].body.think).toBe("1");
  });
  it("policy never: no thought even for agent work", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "تم.", tool_calls: [] }]);
    const db = memDb(); const { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, perModel: { coder: { policy: "never" } }, messages: [{ role: "user", content: "اقرأ ملف README في مستودع a/b ولخصه" }], notes: "", inbox: [], run: { id: "r2c", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(chats(calls)[0].body.think).toBe("");
  });
  it("fast / balanced chat never thinks and is capped; the owner's force changes it for everyone", async () => {
    let calls = studio([{ type: "done", job: "j1", text: "باريس.", tool_calls: [] }]);
    let db = memDb(); let { bot } = fakeBot();
    await saveState(CHAT, { mode: "coder", think: false, accuracy: "balanced", messages: [{ role: "user", content: "ما هي عاصمة فرنسا؟" }], notes: "", inbox: [], run: { id: "r3", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(chats(calls)[0].body).toMatchObject({ think: "", max_tokens: 450, temperature: 0.7, tools: "" });
    _setForcedForTests({ coder: "precise" });
    calls = studio([{ type: "done", job: "j2", text: "باريس.", tool_calls: [] }]); db = memDb(); ({ bot } = fakeBot());
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "ما هي عاصمة فرنسا؟" }], notes: "", inbox: [], run: { id: "r4", chain: "c", sent: 0, step: 0, lease: Date.now() } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(chats(calls)[0].body).toMatchObject({ think: "", max_tokens: 1600, temperature: 0.2 });
  });
});

describe("Sham's agent uses the same profile", () => {
  const ctx = { userId: "u", chatId: 1, githubToken: "", connectors: [] } as any;
  async function run(text: string, mode: any, variant: "v1" | "v2" = "v2") {
    const prompts: string[] = [];
    const maxNews: number[] = [];
    await shamVariant.run(variant, () => shamAgentRun({ text, ctx, tools: shamToolDefs(false, false), budgetMs: 20000, mode, ask: async (p, n) => { prompts.push(p); maxNews.push(n); return { type: "text", text: "تمام" } as any; }, maxSteps: 1 }));
    return { prompts, maxNews };
  }
  it("a greeting with thinking on: the note is the fast one, and the prompt has no tool block", async () => {
    const r = await run("مرحبا", { accuracy: "precise", think: true });
    expect(r.prompts[0]).toContain("المستخدم يفضّل جواباً سريعاً");
    expect(r.prompts[0]).not.toContain("الأدوات المتاحة");
  });
  it("only a greeting drops the tool block; agent work and code keep it", async () => {
    expect((await run("اقرأ README في مستودع octocat/Hello-World", {})).prompts[0]).toContain("الأدوات المتاحة");
    expect((await run("اكتب دالة بايثون تعكس النص", { accuracy: "precise" })).prompts[0]).toContain("الأدوات المتاحة");
    expect((await run("اكتب دالة بايثون تعكس النص", { accuracy: "balanced" })).prompts[0]).toContain("الأدوات المتاحة");
  });
  it("the header of the real Studio call: no thought for a greeting, a short one for code with the switch", async () => {
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (url.includes("/gradio_api/call/v2/")) { seen.push(String(body.prompt || "")); return new Response(JSON.stringify({ event_id: "e" }), { status: 200 }); }
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "text", text: "تمام" } as any).replace(/data: \[.*\]/, `data: [${JSON.stringify(JSON.stringify({ type: "text", text: "تمام" }))}]`), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    process.env.SHAM_V2_URL = "https://v2.test";
    for (const [text, think] of [["مرحبا", true], ["اكتب دالة بايثون تعكس النص", true]] as const) {
      await shamVariant.run("v2", () => shamModeCtx.run({ accuracy: "balanced", think }, () => shamAgentRun({ text, ctx, tools: shamToolDefs(false, false), budgetMs: 20000, maxSteps: 1, mode: shamModeCtx.getStore() })));
    }
    const heads = seen.filter((s) => s.startsWith("[[sham"));
    expect(heads[0]).toMatch(/^\[\[sham temp=0\.70\]\]/);                       // greeting: fast sampling, no think=
    expect(heads[1]).toMatch(/^\[\[sham temp=0\.60 think=400\]\]/);             // code with the switch on: a 250-token thought
  });
});

describe("owner override op", () => {
  const owner = { chatId: 1, tier: "owner" as const }, user = { chatId: 50, tier: "user" as const };
  it("only the owner sets or clears a forced mode (shared through the database); `me` shows it", async () => {
    process.env.SUPER_ADMIN_TELEGRAM_ID = "1";
    await resetPg();
    const d: any = pgDb(); const { bot } = appBot();
    await expect(appOp(user, "mode_force", { for: "coder", mode: "fast" }, { db: d, bot, botRow })).rejects.toMatchObject({ status: 403 });
    expect(await appOp(owner, "mode_force", { for: "coder", mode: "accurate" }, { db: d, bot, botRow })).toEqual({ forced: { coder: "precise" } });
    _setForcedForTests({});                                              // another instance with a stale cache
    expect(await refreshForced(d, true)).toEqual({ coder: "precise" });
    expect(forcedMode("coder")).toBe("precise");
    const me: any = await appOp(user, "me", {}, { db: d, bot, botRow });
    expect(me.settings.forced).toEqual({ coder: "precise" });
    expect(await appOp(owner, "mode_force", { for: "sham_v2", mode: "fast" }, { db: d, bot, botRow })).toEqual({ forced: { coder: "precise", sham_v2: "fast" } });
    expect(await appOp(owner, "mode_force", { for: "coder", mode: "" }, { db: d, bot, botRow })).toEqual({ forced: { sham_v2: "fast" } });
  });
});

import { detectMediaIntent, stripOwnersExcuse, OWNERS_ONLY_FIX } from "@/lib/coderMediaFast";
describe("media intent: every spelling the owner types, and no invented 'owners only'", () => {
  const yes: [string, "image" | "video"][] = [
    ["قم بتوليد فديو ارنب يلعب في الحديقة", "video"],
    ["قم بتوليد فيديو ارنب يلعب في الحديقة", "video"],
    ["قم بتوليد فيديو أرنب يلعب في الحديقة", "video"],
    ["قم بتوليد صورة ارنب", "image"],
    ["اصنع فديو لاسد يركض", "video"], ["سوي فيديو لقطة", "video"], ["أنشئ فيديو غروب", "video"], ["انشئ مقطع فديو لحصان", "video"],
    ["سويلي فديو ارنب", "video"], ["ولد لي فيديو بحر", "video"], ["اعمل فيديوهات ارنب", "video"], ["ابي فدو ارنب", "video"], ["اصنع ڤيديو قطة", "video"], ["اريد الفيديو ارنب يلعب", "video"],
    ["اصنع صورة اسد", "image"], ["سوي صورة قطة", "image"], ["أنشئ صورة غروب", "image"],
  ];
  it.each(yes)("%s", (text, kind) => { const i = detectMediaIntent(text); expect(i?.kind).toBe(kind); expect(i?.subject).not.toMatch(/فديو|فيديو|توليد/); });
  it("code / explanation requests are not media", () => {
    for (const t of ["اشرح لي كيف يعمل الفيديو في المتصفح", "اكتب كود لتشغيل فيديو html", "ماذا يوجد في هذا الفيديو"]) expect(detectMediaIntent(t)).toBeNull();
  });
  it("a model-written 'owners only' excuse about media never reaches the user", () => {
    const bad = "لا يمكنني توليد الفيديو لأن هذه الميزة متاحة فقط للمالكين. هل تود أن أبحث عن هذا الفيديو لك؟";
    expect(stripOwnersExcuse(bad)).toBe(OWNERS_ONLY_FIX);
    expect(stripOwnersExcuse("Video generation is for owners only")).toBe(OWNERS_ONLY_FIX);
    expect(stripOwnersExcuse("هذه الميزة للمالك فقط، مقطع الفيديو")).toBe(OWNERS_ONLY_FIX);
    expect(stripOwnersExcuse("هذا المستودع للمالك فقط")).toBe("هذا المستودع للمالك فقط");        // not about media: untouched
    expect(stripOwnersExcuse("تم إنشاء الفيديو.")).toBe("تم إنشاء الفيديو.");
  });
});
