// Memory / save switches in the app, per model, wired to the real backend: Sham's facts + turns (shamMemory), Nova's long-term memories + saved chats.
// Each test flips a switch and checks the behaviour changes (a stored row appears or does not; the model is or is not given the memory).
import { appOp, AppError } from "@/lib/coderApp";
import { loadState, novaMemoryPrompt, shamContextFor, switchThread } from "@/lib/coderSections";
import { memorySettings, setMemorySettings } from "@/lib/coderModels";
import { runTool } from "@/lib/coderAgent";
import * as N from "@/lib/coderThreads";
import { saveMemory } from "@/lib/coderMemory";
import { shamModeCtx, shamVariant } from "@/lib/shamStudio";
import * as S from "@/lib/shamThreads";
import { forgetFacts, shamFacts } from "@/lib/shamMemory";
import { fakeBot } from "./coderFakes";
import { pgDb } from "./pgDb";

const OWNER = 4242, USER = 9001;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const o = { chatId: OWNER, tier: "owner" as const }, u = { chatId: USER, tier: "user" as const };
beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
  process.env.SHAM_MEMORY = "1";
  delete process.env.CODER_MEMORY;
});
const mkd = () => { const db: any = pgDb(); const { bot } = fakeBot(); return { db, d: { db, bot, botRow } }; };
const on = { remember: true, recall: true, save: true };
/** run as Sham `variant` with these memory switches (what shamContextFor hands the bot) */
const as = <T,>(variant: "v1" | "v2", memory: Partial<typeof on>, f: () => Promise<T>) => shamVariant.run(variant, () => shamModeCtx.run({ memory: { ...on, ...memory } }, f));
const count = async (db: any) => (await db.query(`SELECT count(*)::int AS n FROM sham_chat_memory`))[0].n as number;

describe("memorySettings (pure)", () => {
  it("all on by default; a change touches only that model", () => {
    const st: any = {};
    expect(memorySettings(st, "sham_v2")).toEqual(on);
    setMemorySettings(st, "sham_v2", { recall: false });
    expect(memorySettings(st, "sham_v2")).toEqual({ ...on, recall: false });
    expect(memorySettings(st, "sham")).toEqual(on);
    expect(memorySettings(st, "coder")).toEqual(on);
    expect(memorySettings(st, "sham_loop")).toEqual(on);          // the old alias is old Sham
  });
});

describe("Sham: the three switches change what is stored and what the model is given", () => {
  it("save OFF: the turn is not stored and no chat appears; remember still learns the facts", async () => {
    const { db } = mkd();
    await as("v2", { save: false }, () => S.saveChatTurn(OWNER, "اسمي سامي وأعيش في دمشق", "أهلاً سامي", db));
    expect(await count(db)).toBe(0);
    expect(await S.listThreads(OWNER, "v2", {}, db)).toEqual([]);
    expect(await shamFacts(OWNER, db, "v2")).toMatchObject({ name: "سامي" });
    await as("v2", {}, () => S.saveChatTurn(OWNER, "سؤال", "جواب", db));                // switched back on: stored
    expect(await count(db)).toBe(1);
    expect((await S.listThreads(OWNER, "v2", {}, db)).map((t) => t.title)).toEqual(["سؤال"]);
  });
  it("remember OFF: no new facts are learned (what was known stays); the conversation is still saved", async () => {
    const { db } = mkd();
    await as("v1", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    await as("v1", { remember: false }, () => S.saveChatTurn(OWNER, "أعيش في حلب", "تشرفنا", db));
    expect(await shamFacts(OWNER, db, "v1")).toEqual({ name: "سامي" });                       // the city was NOT learned
    expect(await count(db)).toBe(2);
    await as("v1", {}, () => S.saveChatTurn(OWNER, "أعيش في حمص", "تشرفنا مرة أخرى", db));
    expect(await shamFacts(OWNER, db, "v1")).toMatchObject({ name: "سامي", city: "حمص" });
  });
  it("remember OFF + save OFF: nothing at all is written", async () => {
    const { db } = mkd();
    await as("v2", { remember: false, save: false }, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    expect(await count(db)).toBe(0);
    expect(await shamFacts(OWNER, db, "v2")).toEqual({});
  });
  it("recall OFF: stored facts and earlier chats are not given to the model; this chat's own turns still are", async () => {
    const { db } = mkd();
    await as("v2", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً سامي", db));
    await S.newThread(OWNER, "v2", db);
    await as("v2", {}, () => S.saveChatTurn(OWNER, "ما أفضل لغة برمجة؟", "بايثون", db));
    const withRecall = await as("v2", {}, () => S.loadChatMemory(OWNER, "مرحبا", db));
    expect(withRecall?.facts).toMatchObject({ name: "سامي" });
    const without = await as("v2", { recall: false }, () => S.loadChatMemory(OWNER, "مرحبا", db));
    expect(without?.facts).toEqual({});
    expect(without?.summary).toBe("");
    expect(without?.history.map((t) => t.q)).toEqual(["ما أفضل لغة برمجة؟"]);            // the open conversation still continues
  });
  it("per model: Sham v1 with recall off while Sham v2 has it on", async () => {
    const { db } = mkd();
    await as("v2", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    expect((await as("v1", { recall: false }, () => S.loadChatMemory(OWNER, "x", db)))?.facts).toEqual({});
    expect((await as("v2", {}, () => S.loadChatMemory(OWNER, "x", db)))?.facts).toMatchObject({ name: "سامي" });
  });
  it("the server's own kill switch still wins over the user's switches", async () => {
    const { db } = mkd();
    process.env.SHAM_MEMORY = "off";
    await as("v1", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    expect(await count(db)).toBe(0);
    expect(await as("v1", {}, () => S.loadChatMemory(OWNER, "x", db))).toBeNull();
  });
  it("forgetFacts removes what was learned but keeps the conversations", async () => {
    const { db } = mkd();
    await as("v1", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    expect(await forgetFacts(OWNER, db)).toBe(true);
    expect(await shamFacts(OWNER, db, "v1")).toEqual({});
    expect(await count(db)).toBe(1);
    expect(await S.listThreads(OWNER, "v1", {}, db)).toHaveLength(1);
  });
});

describe("Mini App settings op", () => {
  it("each model keeps its own memory switches; `me` returns them; `for` edits another model", async () => {
    const { d, db } = mkd();
    await appOp(o, "settings", { memory: { recall: false } }, d);                              // Nova (selected)
    await appOp(o, "settings", { for: "sham_v2", memory: { save: false, remember: false } }, d);
    const me = await appOp(o, "me", {}, d);
    expect(me.settings.memory).toEqual({ ...on, recall: false });
    expect(me.settings.perModel.sham_v2.memory).toEqual({ remember: false, recall: true, save: false });
    expect(me.settings.perModel.sham.memory).toEqual(on);
    await appOp(o, "settings", { model: "sham_v2" }, d);
    expect((await appOp(o, "me", {}, d)).settings.memory).toEqual({ remember: false, recall: true, save: false });
    // the bot's Sham context carries exactly the selected Sham's switches
    const ctx = await shamContextFor({ message: { chat: { id: OWNER } } }, db);
    expect(ctx.variant).toBe("v2");
    expect(ctx.mode.memory).toEqual({ remember: false, recall: true, save: false });
    await appOp(o, "settings", { model: "sham" }, d);
    expect((await shamContextFor({ message: { chat: { id: OWNER } } }, db)).mode.memory).toEqual(on);
  });
  it("a user cannot set memory switches of a model that is not open to them", async () => {
    const { d } = mkd();
    await expect(appOp(u, "settings", { for: "sham_v2", memory: { save: false } }, d)).rejects.toThrow(AppError);
    await appOp(u, "settings", { memory: { save: false } }, d);                              // Nova is always allowed
  });
  it("sham_memory: view what Sham learned and forget it (owner's / exposed Sham only)", async () => {
    const { d, db } = mkd();
    await as("v2", {}, () => S.saveChatTurn(OWNER, "اسمي سامي", "أهلاً", db));
    expect((await appOp(o, "sham_memory", { model: "sham_v2" }, d)).facts).toMatchObject({ name: "سامي" });
    expect((await appOp(o, "sham_memory", { model: "sham_v2", forget: true }, d)).ok).toBe(true);
    expect((await appOp(o, "sham_memory", { model: "sham_v2" }, d)).facts).toEqual({});
    await expect(appOp(u, "sham_memory", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    await expect(appOp(o, "sham_memory", { model: "coder" }, d)).rejects.toThrow(AppError);
  });
});

describe("Nova: remember / recall / save", () => {
  const seed = async (db: any, title: string) => {
    const st = await loadState(OWNER, db);
    st.messages = [{ role: "user", content: title }, { role: "assistant", content: "رد" }] as any;
    st.threadId = await N.createThread(OWNER, { title }, db);
    return st;
  };
  it("save OFF: a chat is not kept once it is left; ON: it stays in the list", async () => {
    const { db } = mkd();
    let st = await seed(db, "محادثة تبقى");
    await switchThread(OWNER, st, null, db);
    expect((await N.listThreads(OWNER, {}, db)).map((t) => t.title)).toEqual(["محادثة تبقى"]);
    st = await loadState(OWNER, db);
    setMemorySettings(st, "coder", { save: false });
    st.messages = [{ role: "user", content: "محادثة لا تُحفظ" }, { role: "assistant", content: "رد" }] as any;
    await N.syncThread((await import("@/lib/coderAuth")).coderChatKey(OWNER), st.threadId!, st, db, false);
    await switchThread(OWNER, st, null, db);
    expect((await N.listThreads(OWNER, {}, db)).map((t) => t.title)).toEqual(["محادثة تبقى"]);
  });
  it("remember OFF: the left chat is not queued for memory learning; ON: it is", async () => {
    const { db } = mkd();
    const due = async (id: string) => (await db.query(`SELECT memory_due FROM coder_threads WHERE id = $1`, id))[0].memory_due as boolean;
    let st = await seed(db, "أ");
    const a = st.threadId!;
    setMemorySettings(st, "coder", { remember: false });
    await switchThread(OWNER, st, null, db);
    expect(await due(a)).toBe(false);
    st = await seed(db, "ب");
    const b = st.threadId!;
    await switchThread(OWNER, st, null, db);
    expect(await due(b)).toBe(true);
  });
  it("recall OFF: the memories are not put in front of the model for a task; ON: they are", async () => {
    const { db } = mkd();
    expect((await saveMemory(OWNER, { text: "يفضّل Tailwind في كل مشاريعه", kind: "preference" }, db)).action).toBe("added");
    const st = await loadState(OWNER, db);
    expect(await novaMemoryPrompt(OWNER, st, "ابنِ لي صفحة بـ Tailwind", db)).toMatch(/Tailwind/);
    setMemorySettings(st, "coder", { recall: false });
    expect(await novaMemoryPrompt(OWNER, st, "ابنِ لي صفحة بـ Tailwind", db)).toBe("");
    setMemorySettings(st, "sham", { recall: false });                                      // another model's switch does not matter to Nova
    setMemorySettings(st, "coder", { recall: true });
    expect(await novaMemoryPrompt(OWNER, st, "ابنِ لي صفحة بـ Tailwind", db)).toMatch(/Tailwind/);
  });
  it("recall / remember OFF: the model's memory tools refuse; ON: they work", async () => {
    const { db } = mkd();
    await saveMemory(OWNER, { text: "يحب Tailwind", kind: "preference" }, db);
    const call = (name: string, args: object) => ({ id: "c", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
    const ctx = (memory?: { remember: boolean; recall: boolean }) => ({ gh: null, addNote: () => {}, userId: OWNER, db, memory } as any);
    expect(await runTool(call("memory_search", { query: "Tailwind" }), ctx({ remember: true, recall: false }))).toMatch(/switched off/);
    expect(await runTool(call("memory_save", { text: "يستخدم Vue", kind: "fact" }), ctx({ remember: false, recall: true }))).toMatch(/switched off/);
    expect(await runTool(call("memory_forget", { id: 1 }), ctx({ remember: false, recall: true }))).toMatch(/switched off/);
    expect(await runTool(call("memory_search", { query: "Tailwind" }), ctx({ remember: false, recall: true }))).not.toMatch(/switched off/);   // search needs only recall
    expect(await runTool(call("memory_save", { text: "يستخدم Vue", kind: "fact" }), ctx({ remember: true, recall: false }))).toMatch(/added memory/);
    expect(await runTool(call("memory_search", { query: "Vue" }), ctx())).toMatch(/Vue/);                                                  // default: all on
  });
});

describe("Nova's identity text is Nova's own", () => {
  it("the system prompt names Nova AI and never presents itself as SHAM AI", async () => {
    const { coderSystemPrompt } = await import("@/lib/coderAgent");
    for (const owner of [true, false]) expect(coderSystemPrompt({ github: false, notes: "", owner })).not.toMatch(/SHAM AI|you are sham|شام AI/i);
    expect(coderSystemPrompt({ github: false, notes: "", owner: true })).toMatch(/Nova AI/);
  });
});
