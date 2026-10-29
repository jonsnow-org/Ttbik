// Model switching is routing-only: every model keeps a distinct transcript and task feed.
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
import { listTasks, taskStart } from "@/lib/coderTasks";

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

describe("switching model keeps independent conversation histories", () => {
  it("Nova → Sham v2 changes routing, not conversation content; connectors remain account-level", async () => {
    const { db, d } = setup();
    await appOp(o, "connector_link", { id: "vercel", token: "vercel-token-ok-1" }, d);
    await novaSay(db, [["أنشئ لي موقعاً", "أنشأت المجلد site"], ["أضف صفحة about", "أضفتها"]]);

    const sw = await appOp(o, "settings", { model: "sham_v2" }, d);
    expect(sw).toMatchObject({ ok: true, model: "sham_v2" });
    expect((await loadState(OWNER, db)).model).toBe("sham_v2");
    expect(await S.listThreads(OWNER, "v2", {}, db)).toEqual([]);
    expect((await loadState(OWNER, db)).messages.map((m: any) => m.content)).toEqual([
      "أنشئ لي موقعاً", "أنشأت المجلد site", "أضف صفحة about", "أضفتها",
    ]);

    expect(await connectedIds(OWNER, db)).toContain("vercel");
    const ctx = await shamContext(OWNER, "bot1", db);
    expect(ctx.connectors).toContain("vercel");
    expect(shamTools(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)).map((t) => t.function.name)).toEqual(expect.arrayContaining(["connector_api", "mcp_call"]));

    await shamVariant.run("v2", () => S.saveChatTurn(OWNER, "أول طلب في شام v2", "رد شام v2", db));
    const v2Memory = await shamVariant.run("v2", () => S.loadChatMemory(OWNER, "سؤال تالٍ", db));
    expect(v2Memory?.history.map((x) => x.q)).toEqual(["أول طلب في شام v2"]);

    await appOp(o, "settings", { model: "coder" }, d);
    const state = await loadState(OWNER, db);
    expect(state.model).toBe("coder");
    expect(state.messages.map((m: any) => m.content)).toEqual([
      "أنشئ لي موقعاً", "أنشأت المجلد site", "أضف صفحة about", "أضفتها",
    ]);
    expect((await S.listThreads(OWNER, "v2", {}, db))[0].title).toBe("أول طلب في شام v2");
    expect(await connectedIds(OWNER, db)).toContain("vercel");
  });

  it("Sham v1 and Sham v2 never copy messages to one another when switched", async () => {
    const { db, d } = setup();
    await shamVariant.run("v1", () => S.saveChatTurn(OWNER, "سؤال شام القديم", "جواب شام القديم", db));
    expect((await S.listThreads(OWNER, "v1", {}, db))[0].title).toBe("سؤال شام القديم");

    await appOp(o, "settings", { model: "sham_v2" }, d);
    expect(await S.listThreads(OWNER, "v2", {}, db)).toEqual([]);
    await shamVariant.run("v2", () => S.saveChatTurn(OWNER, "سؤال شام الجديد", "جواب شام الجديد", db));
    const v2Memory = await shamVariant.run("v2", () => S.loadChatMemory(OWNER, "سؤال تالٍ", db));
    expect(v2Memory?.history.map((x) => x.q)).toEqual(["سؤال شام الجديد"]);

    await appOp(o, "settings", { model: "sham" }, d);
    const v1Memory = await shamVariant.run("v1", () => S.loadChatMemory(OWNER, "سؤال تالٍ", db));
    expect(v1Memory?.history.map((x) => x.q)).toContain("سؤال شام القديم");
    expect(v1Memory?.history.map((x) => x.q)).not.toContain("سؤال شام الجديد");
    expect((await S.listThreads(OWNER, "v2", {}, db))[0].title).toBe("سؤال شام الجديد");
  });

  it("filters task history by the selected model", async () => {
    const { db } = setup();
    await taskStart(OWNER, { runId: "isol-sham-v1", slot: "sham_v1", source: "interactive", title: "v1" }, db);
    await taskStart(OWNER, { runId: "isol-sham-v2", slot: "sham_v2", source: "interactive", title: "v2" }, db);
    await taskStart(OWNER, { runId: "isol-nova", slot: "", source: "interactive", title: "Nova" }, db);
    const v1 = await listTasks(OWNER, { model: "sham" }, db);
    const v2 = await listTasks(OWNER, { model: "sham_v2" }, db);
    const nova = await listTasks(OWNER, { model: "coder" }, db);
    expect(v1.map((x) => x.run_id)).toContain("isol-sham-v1");
    expect(v1.map((x) => x.run_id)).not.toContain("isol-sham-v2");
    expect(v1.map((x) => x.run_id)).not.toContain("isol-nova");
    expect(v2.map((x) => x.run_id)).toContain("isol-sham-v2");
    expect(v2.map((x) => x.run_id)).not.toContain("isol-sham-v1");
    expect(v2.map((x) => x.run_id)).not.toContain("isol-nova");
    expect(nova.map((x) => x.run_id)).toContain("isol-nova");
    expect(nova.map((x) => x.run_id)).not.toContain("isol-sham-v1");
    expect(nova.map((x) => x.run_id)).not.toContain("isol-sham-v2");
  });

  it("a user who may not use Sham cannot switch to it, and no transcript is imported", async () => {
    const { db, d } = setup();
    await expect(appOp(u, "settings", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    expect(await S.listThreads(USER, "v2", {}, db)).toEqual([]);
  });
});
