// 2026-10-28 live failures (owner re-test after #518), proven on a REAL SQL engine:
//  1. the Chats tab said "no chats" while Home listed the same conversations (the open conversation had been hidden by a delete that raced a running task),
//  2. 9 Sham runs stayed "running" for days (the orphan claim re-bumped their heartbeat for ever),
//  3. "قم بتوليد صورة فرس ابيض" got "the image service is unavailable" from the general worker, which never called make_media, while the media Studio was healthy.
import { appOp } from "@/lib/coderApp";
import { handleCoderSections, loadState, saveState } from "@/lib/coderSections";
import { claimOrphanTasks, reapStaleTasks, taskStart, listTasks } from "@/lib/coderTasks";
import { coderChatKey } from "@/lib/coderAuth";
import { detectMediaIntent, glossaryPrompt, cleanEnglishPrompt } from "@/lib/coderMediaFast";
import { fakeBot } from "./coderFakes";
import { b64, png } from "./mediaFixtures";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const OWNER = 4242, FREE = 9101;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const db = (): any => pgDb();
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => Promise<boolean> | boolean, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(40); } return false; };

beforeEach(async () => {
  await resetPg();
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.SHAM_STUDIO_URL; delete process.env.SHAM_V2_URL;
});

describe("which requests take the fast media lane", () => {
  it("clear picture / video requests, Arabic and English", () => {
    expect(detectMediaIntent("قم بتوليد صورة فرس ابيض")).toEqual({ kind: "image", subject: "فرس ابيض" });
    expect(detectMediaIntent("ولد لي صورة أسد")?.kind).toBe("image");
    expect(detectMediaIntent("ارسم قطة سوداء")?.kind).toBe("image");
    expect(detectMediaIntent("generate an image of a white horse")).toEqual({ kind: "image", subject: "white horse" });
    expect(detectMediaIntent("اعمل فيديو عن غروب الشمس")).toEqual({ kind: "video", subject: "غروب الشمس" });
  });
  it("code, questions, files, existing pictures and greetings are for the general worker", () => {
    for (const t of ["اكتب كود html لموقع", "اشرح هذه الصورة", "كيف أرسم", "مرحبا", "حلل الصورة", "/start", "make a python script", "ارسم لي موقع", "ولد صورة من الملف https://x.test/a.png"]) expect(detectMediaIntent(t)).toBeNull();
  });
  it("the English prompt: the glossary never guesses an unknown Arabic word; a model answer must be English", () => {
    expect(glossaryPrompt("فرس ابيض")).toBe("white horse");
    expect(glossaryPrompt("كلمةمجهولة")).toBeNull();
    expect(cleanEnglishPrompt('"a white horse, studio light"\nextra')).toBe("a white horse, studio light");
    expect(cleanEnglishPrompt("حصان أبيض")).toBeNull();
  });
});

describe("Nova in the chat: 'قم بتوليد صورة فرس ابيض' makes a real picture", () => {
  function net(media: object, translate = "a white horse") {
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      urls.push(url + (init?.body ? " " + String(init.body).slice(0, 400) : ""));
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.startsWith("https://media.test")) return url.includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "m1" }), { status: 200 }) : new Response(sse(media), { status: 200 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: translate, tool_calls: [] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    return urls;
  }
  const say = (text: string, from = FREE) => ({ message: { chat: { id: from }, from: { id: from, first_name: "Ali" }, text } });

  it("sends the picture alone (no caption), records both turns in the thread, counts the quota, task done", async () => {
    const urls = net({ type: "image", b64: b64(await png("gradient", 256)) });
    const { bot, api, sent } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة فرس ابيض"), db());
    expect(await until(() => (api as any).sendPhoto.mock.calls.length === 1)).toBe(true);
    expect((api as any).sendPhoto.mock.calls[0][2]?.caption).toBeUndefined();                       // never the raw (English) prompt as a caption
    expect(urls.filter((u) => u.startsWith("https://media.test")).some((u) => /white horse/.test(u))).toBe(true);   // the Studio got the English prompt
    expect(sent.some((s) => /غير متاح|unavailable/.test(s.text))).toBe(false);
    await until(async () => (await listTasks(FREE, { limit: 5 }, db()))[0]?.status === "done");
    const t = (await listTasks(FREE, { limit: 5 }, db()))[0];
    expect(t.status).toBe("done");
    const st = await loadState(FREE, db());
    expect(st.run).toBeNull();
    expect(st.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    const th = await db().query(`SELECT messages FROM coder_threads WHERE chat_key = $1`, coderChatKey(FREE));
    expect(th.length).toBe(1);
    expect((await db().query(`SELECT sum(n)::int AS n FROM coder_media_daily WHERE chat_key = $1`, coderChatKey(FREE)))[0].n).toBe(1);
  });

  it("a black result is never sent; the user is told plainly, the quota is handed back", async () => {
    net({ type: "image", b64: b64(await png("black", 256)) });
    const { bot, api, sent } = fakeBot();
    (api as any).sendPhoto = jest.fn();
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة فرس ابيض"), db());
    expect(await until(() => sent.some((s) => /تعذّر إنشاء الصورة/.test(s.text)))).toBe(true);
    expect((api as any).sendPhoto).not.toHaveBeenCalled();
    expect((await db().query(`SELECT coalesce(sum(n),0)::int AS n FROM coder_media_daily WHERE chat_key = $1`, coderChatKey(FREE)))[0].n).toBe(0);
    await until(async () => (await listTasks(FREE, { limit: 5 }, db()))[0]?.status === "failed");
    expect((await listTasks(FREE, { limit: 5 }, db()))[0].status).toBe("failed");
  });

  it("the 4th picture of the day gets the quota message and nothing is generated", async () => {
    const urls = net({ type: "image", b64: b64(await png("gradient", 256)) });
    const { bot, api, sent } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    for (let i = 0; i < 4; i++) { await handleCoderSections(bot, botRow, say(`ارسم صورة قطة ${i}`), db()); await until(async () => (await listTasks(FREE, { limit: 9 }, db())).filter((x) => x.status !== "running").length === i + 1); }
    expect((api as any).sendPhoto).toHaveBeenCalledTimes(3);
    expect(sent.some((s) => /حدّك اليومي/.test(s.text))).toBe(true);
    expect(urls.filter((u) => u.startsWith("https://media.test") && u.includes("/call/v2/")).length).toBe(3);
  });

  it("a normal request (not a media one) still goes to the general worker", async () => {
    net({ type: "image", b64: "" });
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, say("اشرح لي كيف أرسم"), db());
    await wait(200);
    const st = await loadState(FREE, db());
    expect(st.run || st.messages.length).toBeTruthy();
    expect((await listTasks(FREE, { limit: 5 }, db())).every((x) => !/media/.test(x.source))).toBe(true);
  });
});

describe("the Chats tab shows the open conversation, and Home's running list clears", () => {
  const user = { chatId: OWNER, tier: "owner" as const };
  it("an open conversation that was hidden (delete raced a running task) is shown again by the list", async () => {
    const d = db();
    const { bot } = fakeBot();
    const { ensureThread } = await import("@/lib/coderSections") as any;
    void ensureThread;
    const st = await loadState(OWNER, d);
    st.messages.push({ role: "user", content: "مرحبا" }, { role: "assistant", content: "أهلاً" });
    const T = await import("@/lib/coderThreads");
    const id = await T.createThread(OWNER, st, d, "مرحبا");
    st.threadId = id;
    await saveState(OWNER, st, d);
    await T.syncThread(coderChatKey(OWNER), id, st, d, false);
    await T.hideThread(OWNER, id, d);                                                                 // what the owner saw: hidden while being the open chat
    expect((await T.listThreads(OWNER, {}, d)).length).toBe(0);
    const out: any = await appOp(user, "chats", { model: "coder" }, { db: d, bot, botRow });
    expect(out.items.map((x: any) => x.id)).toContain(id);
    expect(out.current).toBe(id);
    const home: any = await appOp(user, "threads", {}, { db: d, bot, botRow });
    expect(home.threads.map((x: any) => x.id)).toContain(id);
  });
  it("deleting the open EMPTY chat does not hide the conversation the next message goes to", async () => {
    const d = db();
    const { bot } = fakeBot();
    const first: any = await appOp(user, "thread_new", {}, { db: d, bot, botRow });
    const r: any = await appOp(user, "thread_delete", { id: first.id }, { db: d, bot, botRow });
    expect(r.ok).toBe(true);
    const row = (await d.query(`SELECT deleted_at FROM coder_threads WHERE id = $1`, first.id))[0];
    expect(row.deleted_at).toBeNull();
    expect((await loadState(OWNER, d)).threadId).toBe(first.id);
  });
  it("a run that started long ago is closed (Sham after 20 min, any other after 60), a young one is not, a waiting one is left", async () => {
    const d = db();
    const key = coderChatKey(OWNER);
    await taskStart(OWNER, { runId: "sham-1-old", slot: "sham", source: "interactive", title: "old sham" }, d);
    await taskStart(OWNER, { runId: "sham-2-new", slot: "sham", source: "interactive", title: "new sham" }, d);
    await taskStart(OWNER, { runId: "nova-old-1", slot: "", source: "interactive", title: "old nova" }, d);
    await taskStart(OWNER, { runId: "wait-old-1", slot: "", source: "interactive", title: "asks" }, d);
    await d.exec(`UPDATE coder_tasks SET started_at = now() - interval '2 days', updated_at = now() WHERE run_id IN ('sham-1-old','nova-old-1','wait-old-1')`);
    await d.exec(`UPDATE coder_tasks SET status = 'waiting' WHERE run_id = 'wait-old-1'`);
    expect(await reapStaleTasks(OWNER, d)).toBe(2);
    const rows: any[] = await d.query(`SELECT run_id, status FROM coder_tasks WHERE chat_key = $1 ORDER BY run_id`, key);
    expect(Object.fromEntries(rows.map((r) => [r.run_id, r.status]))).toEqual({ "nova-old-1": "failed", "sham-1-old": "failed", "sham-2-new": "running", "wait-old-1": "waiting" });
  });
  it("the orphan claim no longer re-bumps a run that started over 30 minutes ago", async () => {
    const d = db();
    await taskStart(OWNER, { runId: "ghost-run-1", slot: "", source: "interactive", title: "ghost", botId: "bot1" }, d);
    await d.exec(`UPDATE coder_tasks SET started_at = now() - interval '3 hours', updated_at = now() - interval '10 minutes' WHERE run_id = 'ghost-run-1'`);
    expect(await claimOrphanTasks(d)).toEqual([]);
  });
  it("Home can stop one running task or all of them", async () => {
    const d = db();
    const { bot } = fakeBot();
    for (const id of ["sham-1-a", "sham-2-b", "sham-3-c"]) await taskStart(OWNER, { runId: id, slot: "sham", source: "interactive", title: id }, d);
    const one: any = await appOp(user, "task_stop", { runId: "sham-1-a" }, { db: d, bot, botRow });
    expect(one.stopped).toBe(1);
    expect((await listTasks(OWNER, { active: true, limit: 20 }, d)).length).toBe(2);
    const all: any = await appOp(user, "stop_all", {}, { db: d, bot, botRow });
    expect(all.stopped).toBe(2);
    expect((await listTasks(OWNER, { active: true, limit: 20 }, d)).length).toBe(0);
  });
});

describe("the background executor (terminal): the chat and the app are front-ends", () => {
  const say = (text: string, from = FREE) => ({ message: { chat: { id: from }, from: { id: from, first_name: "Ali" }, text } });
  it("media is made in the background: the webhook call returns at once, the picture arrives later (a dropped connection loses nothing)", async () => {
    const good = b64(await png("gradient", 256));
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.startsWith("https://media.test")) { await wait(400); return url.includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "m1" }), { status: 200 }) : new Response(sse({ type: "image", b64: good }), { status: 200 }); }
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: "a white horse", tool_calls: [] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة فرس ابيض"), db());
    expect((api as any).sendPhoto).not.toHaveBeenCalled();                            // the request already returned; the work is the executor's
    expect((await listTasks(FREE, { active: true, limit: 5 }, db())).length).toBe(1);   // visible in the shared task list (terminal) while it runs
    expect(await until(() => (api as any).sendPhoto.mock.calls.length === 1)).toBe(true);
  });
  it("a command from the chat reaches a running task: a message joins its queue; /stop ends it", async () => {
    const { bot } = fakeBot();
    const st: any = await loadState(OWNER, db());
    st.messages.push({ role: "user", content: "مهمة طويلة" });
    st.run = { id: "longrun-1", chain: "c", sent: 0, logged: 0, step: 3, lease: Date.now(), startedAt: Date.now(), source: "interactive", slot: "", surface: "telegram" };
    await saveState(OWNER, st, db());
    await taskStart(OWNER, { runId: "longrun-1", slot: "", source: "interactive", title: "مهمة طويلة" }, db());
    await handleCoderSections(bot, botRow, say("وأضف أيضاً هذا الطلب", OWNER), db());
    expect((await loadState(OWNER, db())).inbox).toEqual(["وأضف أيضاً هذا الطلب"]);
    await handleCoderSections(bot, botRow, say("/stop", OWNER), db());
    await wait(100);
    expect((await loadState(OWNER, db())).run).toBeNull();
  });
  it("a long report is delivered in chunks that respect Telegram's 4096 limit, in order, nothing cut (Sham's delivery)", async () => {
    const { sendShamReply } = await import("@/lib/novaBotLogic");
    const calls: string[] = [];
    const tg: any = { api: { sendMessage: async (_c: number, t: string) => void calls.push(t) } };
    const text = Array.from({ length: 900 }, (_, i) => `سطر ${i} من التقرير الطويل`).join("\n");
    expect(text.length).toBeGreaterThan(9000);
    await sendShamReply(tg, 1, { type: "text", text });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.length <= 4096)).toBe(true);
    expect(calls.join("")).toBe(text);                                                // nothing cut
    const docs: any[] = [];
    const tg2: any = { api: { sendMessage: async () => undefined, sendDocument: async (...a: any[]) => void docs.push(a) } };
    await sendShamReply(tg2, 1, { type: "text", text: text + text });                 // beyond ~24k characters: the whole report as a file
    expect(docs.length).toBe(1);
  });
});
