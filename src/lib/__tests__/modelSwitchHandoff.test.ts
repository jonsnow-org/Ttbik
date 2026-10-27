// The Mini App model switch in the middle of a conversation: the new model gets the same connectors at once AND reads the conversation so far,
// then carries on. Chat-list ops per model, through the real op layer, on a real SQL engine.
import { appOp, AppError } from "@/lib/coderApp";
import { loadState, saveState } from "@/lib/coderSections";
import { updateModel } from "@/lib/coderModels";
import { shamVariant } from "@/lib/shamStudio";
import * as S from "@/lib/shamThreads";
import * as N from "@/lib/coderThreads";
import { shamContext, shamTools } from "@/lib/shamExec";
import { connectedIds } from "@/lib/coderConnectors";
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
  delete process.env.CODER_GITHUB_TOKEN;
});
const setup = () => { const db: any = pgDb(); const { bot } = fakeBot(); return { db, d: { db, bot, botRow, fetchImpl: (async (url: string) => (url === "https://api.vercel.com/v2/user" ? new Response(JSON.stringify({ user: { username: "ahmad" } })) : new Response("{}"))) as any } }; };
const novaSay = async (db: any, lines: [string, string][]) => {
  const st = await loadState(OWNER, db);
  st.messages = lines.flatMap(([q, a]) => [{ role: "user", content: q }, { role: "assistant", content: a }]) as any;
  await saveState(OWNER, st, db);
};

describe("chat list ops, one list per model", () => {
  it("chats / chat_new / chat_open / chat_rename / chat_pin / chat_archive / chat_delete / chat_messages for Nova, Sham and Sham v2", async () => {
    const { db, d } = setup();
    // Nova: two older conversations
    const n1 = await N.createThread(OWNER, { title: "نوفا واحد", messages: [{ role: "user", content: "اكتب دالة" }, { role: "assistant", content: "ها هي" }] as any }, db);
    const n2 = await N.createThread(OWNER, { title: "نوفا اثنان", messages: [{ role: "user", content: "اشرح git" }, { role: "assistant", content: "git نظام" }] as any }, db);
    // Sham and Sham v2: one chat each
    await shamVariant.run("v1", () => S.saveChatTurn(OWNER, "سؤال شام", "جواب شام", db));
    await shamVariant.run("v2", () => S.saveChatTurn(OWNER, "سؤال شام ٢", "جواب شام ٢", db));
    const titles = async (model: string, extra: object = {}) => ((await appOp(o, "chats", { model, ...extra }, d)).items as any[]).map((i) => i.title);
    expect(await titles("coder")).toEqual(["نوفا اثنان", "نوفا واحد"]);
    expect(await titles("sham")).toEqual(["سؤال شام"]);
    expect(await titles("sham_v2")).toEqual(["سؤال شام ٢"]);
    expect(await titles("sham_v2", { q: "٢" })).toEqual(["سؤال شام ٢"]);
    expect(await titles("coder", { q: "git" })).toEqual(["نوفا اثنان"]);

    // open an old Nova chat: the model is Nova, its history is the chat's full history
    const r = await appOp(o, "chat_open", { model: "coder", id: n1 }, d);
    expect(r.messages.map((m: any) => m.text)).toEqual(["اكتب دالة", "ها هي"]);
    expect((await loadState(OWNER, db)).threadId).toBe(n1);
    expect((await loadState(OWNER, db)).messages.map((m: any) => m.content)).toEqual(["اكتب دالة", "ها هي"]);
    // opening a Sham chat selects that Sham
    const sh = (await S.listThreads(OWNER, "v2", {}, db))[0];
    await appOp(o, "chat_open", { model: "sham_v2", id: sh.id }, d);
    expect((await loadState(OWNER, db)).model).toBe("sham_v2");
    expect((await appOp(o, "chat_messages", { model: "sham_v2", id: sh.id }, d)).messages.map((m: any) => m.text)).toEqual(["سؤال شام ٢", "جواب شام ٢"]);
    await expect(appOp(o, "chat_open", { model: "sham", id: sh.id }, d)).rejects.toThrow(AppError);   // not that Sham's chat

    // rename / pin / archive / delete through the ops
    await appOp(o, "chat_rename", { model: "coder", id: n2, title: "اسم جديد" }, d);
    await appOp(o, "chat_pin", { model: "coder", id: n2, pinned: true }, d);
    expect((await titles("coder"))[0]).toBe("اسم جديد");
    await appOp(o, "chat_archive", { model: "coder", id: n2, archived: true }, d);
    expect(await titles("coder")).not.toContain("اسم جديد");
    expect(await titles("coder", { archived: "only" })).toEqual(["اسم جديد"]);
    expect((await appOp(o, "chat_delete", { model: "coder", archived: true }, d)).deleted).toEqual([n2]);        // "finished" ones
    await appOp(o, "chat_new", { model: "sham", }, d);
    await shamVariant.run("v1", () => S.saveChatTurn(OWNER, "ثاني", "رد", db));
    expect((await appOp(o, "chat_delete", { model: "sham", ids: [(await S.listThreads(OWNER, "v1", {}, db))[0].id, "nope"] }, d)).deleted).toHaveLength(1);
    await expect(appOp(o, "chat_delete", { model: "sham" }, d)).rejects.toThrow(AppError);                      // nothing named
    await expect(appOp(o, "chat_delete", { model: "nova9", all: true }, d)).rejects.toThrow(AppError);
  });

  it("the owner-only models stay owner-only here too; Nova's list is open to everyone and private to its owner", async () => {
    const { db, d } = setup();
    await N.createThread(OWNER, { title: "سري", messages: [{ role: "user", content: "x" }] as any }, db);
    await shamVariant.run("v2", () => S.saveChatTurn(USER, "سؤال", "جواب", db));
    await expect(appOp(u, "chats", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    await expect(appOp(u, "chats", { model: "sham" }, d)).rejects.toThrow(AppError);
    await expect(appOp(u, "chat_messages", { model: "sham_v2", id: "x" }, d)).rejects.toThrow(AppError);
    expect((await appOp(u, "chats", { model: "coder" }, d)).items).toEqual([]);                                  // the owner's chat is not the user's
  });
});

describe("owner's expose toggle", () => {
  it("once the owner switches Sham v2 on for everyone, a user gets its chat list — still only their own chats; Sham stays closed", async () => {
    const { db, d } = setup();
    await shamVariant.run("v2", async () => { await S.saveChatTurn(USER, "سؤال المستخدم", "جواب", db); await S.saveChatTurn(OWNER, "سؤال المالك", "جواب", db); });
    await updateModel("sham_v2", { visible: true }, db);
    const r = await appOp(u, "chats", { model: "sham_v2" }, d);
    expect(r.items.map((i: any) => i.title)).toEqual(["سؤال المستخدم"]);
    await expect(appOp(u, "chats", { model: "sham" }, d)).rejects.toThrow(AppError);
  });
});

describe("switching model mid-conversation", () => {
  it("Nova → Sham v2: the same connectors at once, the conversation so far is read, and the work continues; back again with the new turns", async () => {
    const { db, d } = setup();
    await appOp(o, "connector_link", { id: "vercel", token: "vercel-token-ok-1" }, d);
    await novaSay(db, [["أنشئ لي موقعاً", "أنشأت المجلد site"], ["أضف صفحة about", "أضفتها"]]);

    const sw = await appOp(o, "settings", { model: "sham_v2" }, d);
    expect(sw.carried).toBe(4);
    // connectors: the same, immediately (the user's, not the model's)
    expect(await connectedIds(OWNER, db)).toContain("vercel");
    const ctx = await shamContext(OWNER, "bot1", db);
    expect(ctx.connectors).toContain("vercel");
    expect(shamTools(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)).map((t) => t.function.name)).toEqual(expect.arrayContaining(["connector_api", "mcp_call"]));
    // history: Sham v2's open chat IS the conversation, and its next message is answered with it in context
    await shamVariant.run("v2", async () => {
      const mem = await S.loadChatMemory(OWNER, "تابع", db);
      expect(mem?.history.map((t) => t.q)).toEqual(["أنشئ لي موقعاً", "أضف صفحة about"]);
      expect(mem?.history.map((t) => t.a)).toEqual(["أنشأت المجلد site", "أضفتها"]);
      await S.saveChatTurn(OWNER, "انشره على vercel", "نشرت الموقع", db);
    });
    expect((await S.listThreads(OWNER, "v2", {}, db))[0].turns).toBe(3);
    // nothing leaked into old Sham
    expect(await S.listThreads(OWNER, "v1", {}, db)).toEqual([]);

    // back to Nova: it reads what happened in Sham v2 too, and the connector is still there
    const back = await appOp(o, "settings", { model: "coder" }, d);
    expect(back.carried).toBe(6);
    const st = await loadState(OWNER, db);
    expect(st.model).toBe("coder");
    expect(st.messages.map((m: any) => m.content)).toEqual(["أنشئ لي موقعاً", "أنشأت المجلد site", "أضف صفحة about", "أضفتها", "انشره على vercel", "نشرت الموقع"]);
    expect(await connectedIds(OWNER, db)).toContain("vercel");
    // the original Nova chat is still in Nova's list (nothing was lost on the way)
    expect((await appOp(o, "chats", { model: "coder" }, d)).items.length).toBeGreaterThanOrEqual(1);
  });

  it("a switch with nothing said in between carries nothing, and ping-pong does not pile up copies", async () => {
    const { db, d } = setup();
    await novaSay(db, [["سؤال", "جواب"]]);
    expect((await appOp(o, "settings", { model: "sham" }, d)).carried).toBe(2);
    expect((await appOp(o, "settings", { model: "coder" }, d)).carried).toBe(0);              // sham's chat only holds what it was handed
    expect((await appOp(o, "settings", { model: "sham" }, d)).carried).toBe(2);               // Nova's open chat is still the same conversation
    expect((await S.listThreads(OWNER, "v1", {}, db)).length).toBeLessThanOrEqual(2);
    // an empty conversation carries nothing
    const e = setup();
    expect((await appOp(o, "settings", { model: "sham_v2" }, e.d)).carried).toBe(0);
    expect(await S.listThreads(OWNER, "v2", {}, e.db)).toEqual([]);
  });

  it("carry:false switches cleanly; the same model again is a no-op; the model's own chat is kept", async () => {
    const { db, d } = setup();
    await novaSay(db, [["a", "b"]]);
    expect((await appOp(o, "settings", { model: "sham_v2", carry: false }, d)).carried).toBe(0);
    expect(await S.listThreads(OWNER, "v2", {}, db)).toEqual([]);
    expect((await appOp(o, "settings", { model: "sham_v2" }, d)).carried).toBe(0);
  });

  it("a user who may not use Sham cannot switch to it, and nothing is carried", async () => {
    const { db, d } = setup();
    await expect(appOp(u, "settings", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    expect(await S.listThreads(USER, "v2", {}, db)).toEqual([]);
  });
});
