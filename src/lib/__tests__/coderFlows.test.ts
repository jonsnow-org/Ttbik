// Permission policy, "allow for the rest of this task", task history, scheduled runs in their own slot, and the schedule store.
import { drive, handleCoderSections, loadState, resolvePending, saveState, startScheduledRun, type Db } from "@/lib/coderSections";
import { setPref } from "@/lib/coderPrefs";
import { claimDue, createSchedule, deleteSchedule, eventSummary, fanOut, listSchedules, scheduleChatId, setPaused, updateSchedule, verifyHubSignature, verifyRun } from "@/lib/coderSchedules";
import { createHmac } from "crypto";
import { fakeBot, fakeDb } from "./coderFakes";

const CHAT = 4242;
const USER = 9001;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function studio(replies: object[], github: Record<string, (b: any) => [number, any]> = {}) {
  const calls: { url: string; body?: any }[] = [];
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: `e${calls.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse(replies[Math.min(i++, replies.length - 1)]), { status: 200 });
    if (url.startsWith("https://api.github.com")) {
      const key = `${init?.method || "GET"} ${url.slice(22)}`;
      for (const [k, fn] of Object.entries(github)) if (key.startsWith(k)) {
        const [s, d] = fn(body);
        return new Response(JSON.stringify(d), { status: s });
      }
      return new Response(JSON.stringify({ message: "nf" }), { status: 404 });
    }
    return new Response("{}", { status: 202 });
  });
  return calls;
}
const run = (id: string) => ({ id, chain: "c", sent: 0, step: 0, lease: Date.now(), source: "interactive" as const, slot: "" });
const st0 = (content: string, r: any) => ({ mode: "coder" as const, think: false, messages: [{ role: "user" as const, content }], notes: "", inbox: [], run: r });

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
  process.env.CRON_SECRET = "cron-secret";
});

describe("confirmation policy in the loop", () => {
  it("auto-allow: the owner's delete runs without a tap and is written to the task history", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [call("d", "github_delete_branch", { repo: "a/b", branch: "old" })] }, { type: "done", job: "j2", text: "حذفت.", tool_calls: [] }], { "DELETE /repos/a/b/git/refs/heads/old": () => [204, {}] });
    const db = fakeDb();
    await setPref(CHAT, { category: "delete", repo: "*", context: "*", policy: "allow" }, db);
    const { bot, sent } = fakeBot();
    await saveState(CHAT, st0("احذف old", run("p1")), db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect(calls.some((c) => c.url.endsWith("/git/refs/heads/old"))).toBe(true);
    expect(sent.some((s) => /يحتاج تأكيدك/.test(s.text))).toBe(false);
    expect(db.t.events.some((e) => e.run_id === "p1" && e.kind === "auto_allowed" && /github_delete_branch/.test(e.text))).toBe(true);
  });

  it("auto-deny: nothing runs, the model is told it was denied and adapts", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [call("w", "github_write_files", { repo: "a/b", branch: "main", message: "m", files: [{ path: "x", content: "1" }] })] }, { type: "done", job: "j2", text: "سأفتح PR بدلاً من ذلك.", tool_calls: [] }]);
    const db = fakeDb();
    await setPref(USER, { category: "main", repo: "*", context: "*", policy: "deny" }, db);
    const { bot, sent } = fakeBot();
    await saveState(USER, st0("ادفع", run("p2")), db);
    await drive(bot, botRow, USER, "c", db, 40000);
    const st = await loadState(USER, db);
    expect(st.messages.some((m) => m.role === "tool" && /DENIED by the user's standing policy/.test(m.content))).toBe(true);
    expect(sent.some((s) => /رُفض تلقائياً/.test(s.text))).toBe(true);
    expect(calls.some((c) => c.url.startsWith("https://api.github.com") && c.body)).toBe(false);
    expect(db.t.events.some((e) => e.kind === "auto_denied")).toBe(true);
  });

  it("'allow for the rest of this task' runs this one and the next of the same kind without asking", async () => {
    const d1 = call("d1", "github_delete_branch", { repo: "a/b", branch: "x1" });
    const d2 = call("d2", "github_delete_branch", { repo: "a/b", branch: "x2" });
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [d1] }, { type: "done", job: "j2", text: "", tool_calls: [d2] }, { type: "done", job: "j3", text: "انتهيت.", tool_calls: [] }], { "DELETE /repos/a/b/git/refs/heads/": () => [204, {}] });
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "احذف الفرعين" } }, db);   // a real start: task row + history
    await new Promise((r) => setTimeout(r, 400));
    const card = sent.find((s) => /يحتاج تأكيدك/.test(s.text))!;
    const all = card.extra.reply_markup.inline_keyboard[1][0];
    expect(all.text).toBe("✅ اسمح لبقية المهمة");
    expect((await loadState(CHAT, db)).run?.pending?.msgId).toBeGreaterThan(100);
    expect(db.t.tasks[0]).toMatchObject({ status: "waiting", title: "احذف الفرعين", source: "interactive", slot: "" });
    await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: all.callback_data, message: { chat: { id: CHAT }, message_id: 7 } } }, db);
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => /refs\/heads\/x[12]$/.test(c.url))).toHaveLength(2);
    expect(sent.filter((s) => /يحتاج تأكيدك/.test(s.text))).toHaveLength(1);
    expect(sent.map((s) => s.text)).toContain("انتهيت.");
    expect(db.t.tasks[0].status).toBe("done");
    expect(db.t.events.filter((e) => e.kind === "auto_allowed")).toHaveLength(1);           // the 2nd delete: allowed by the button, logged
  });

  it("the app's approve/deny resolves the same pending card and removes the Telegram buttons", async () => {
    studio([{ type: "done", job: "j1", text: "", tool_calls: [call("d", "github_delete_branch", { repo: "a/b", branch: "z" })] }, { type: "done", job: "j2", text: "حسناً.", tool_calls: [] }]);
    const db = fakeDb();
    const { bot, api } = fakeBot();
    await saveState(CHAT, st0("احذف z", run("p4")), db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    const p = (await loadState(CHAT, db)).run!.pending!;
    expect(await resolvePending(bot, botRow, CHAT, "p4", "wrong", "yes", db)).toBe(false);
    expect(await resolvePending(bot, botRow, CHAT, "p4", p.nonce, "no", db)).toBe(true);
    expect(api.editMessageReplyMarkup).toHaveBeenCalledWith(CHAT, p.msgId, expect.anything());
    await new Promise((r) => setTimeout(r, 300));
    expect((await loadState(CHAT, db)).messages.some((m) => m.role === "tool" && /declined/.test(m.content))).toBe(true);
    expect(db.t.events.some((e) => e.kind === "declined")).toBe(true);
  });
});

describe("scheduled runs", () => {
  it("run in their own slot with a fresh step counter, leave the chat untouched, and use the 'scheduled' policy", async () => {
    const db = fakeDb();
    await saveState(USER, { ...st0("محادثة جارية", null), messages: [{ role: "user", content: "محادثة جارية" }] }, db);
    await setPref(USER, { category: "delete", repo: "*", context: "scheduled", policy: "deny" }, db);
    studio([{ type: "done", job: "j1", text: "", tool_calls: [call("d", "github_delete_branch", { repo: "a/b", branch: "stale" })] }, { type: "done", job: "j2", text: "تقرير: لا شيء للحذف.", tool_calls: [] }]);
    const { bot, sent } = fakeBot();
    const r = await startScheduledRun(bot, botRow, USER, { scheduleId: "abcdefabcdef", title: "تنظيف أسبوعي", prompt: "نظّف الفروع", source: "scheduled" }, db);
    expect(r).toBe("started");
    await new Promise((res) => setTimeout(res, 400));
    expect(sent[0].text).toMatch(/⏰ بدأت مهمة مجدولة: تنظيف أسبوعي/);
    const slot = await loadState(USER, db, "s:abcdefabcdef");
    expect(slot.messages.some((m) => /DENIED/.test(String(m.content)))).toBe(true);           // the scheduled-context rule applied
    expect((await loadState(USER, db)).messages).toEqual([{ role: "user", content: "محادثة جارية" }]);   // the chat is untouched
    const task = db.t.tasks.find((x) => x.slot === "s:abcdefabcdef");
    expect(task).toMatchObject({ source: "scheduled", schedule_id: "abcdefabcdef", status: "done" });
    expect(sent.map((s) => s.text)).toContain("تقرير: لا شيء للحذف.");
  });

  it("a confirmation inside a scheduled run is answered from the chat and finds its slot", async () => {
    const db = fakeDb();
    const calls = studio([{ type: "done", job: "j1", text: "", tool_calls: [call("d", "github_delete_branch", { repo: "a/b", branch: "old" })] }, { type: "done", job: "j2", text: "تم.", tool_calls: [] }], { "DELETE /repos/a/b/git/refs/heads/old": () => [204, {}] });
    const { bot, sent } = fakeBot();
    await startScheduledRun(bot, botRow, CHAT, { scheduleId: "aaaaaaaaaaaa", title: "t", prompt: "p", source: "event" }, db);
    await new Promise((res) => setTimeout(res, 400));
    const card = sent.find((s) => /يحتاج تأكيدك/.test(s.text))!;
    expect(card.text).toMatch(/^⏰ t/);
    await handleCoderSections(bot, botRow, { callback_query: { id: "q", data: card.extra.reply_markup.inline_keyboard[0][0].callback_data, message: { chat: { id: CHAT }, message_id: 5 } } }, db);
    await new Promise((res) => setTimeout(res, 400));
    expect(calls.some((c) => c.url.endsWith("/refs/heads/old"))).toBe(true);
    expect((await loadState(CHAT, db, "s:aaaaaaaaaaaa")).run).toBeNull();
  });

  it("a second start while the previous run of the same schedule is going says busy", async () => {
    const db = fakeDb();
    studio([{ type: "pending", job: "j1" }]);
    const { bot } = fakeBot();
    await saveState(CHAT, { ...st0("x", { ...run("old"), slot: "s:bbbbbbbbbbbb", source: "scheduled" }) }, db, "s:bbbbbbbbbbbb");
    expect(await startScheduledRun(bot, botRow, CHAT, { scheduleId: "bbbbbbbbbbbb", title: "t", prompt: "p", source: "scheduled" }, db)).toBe("busy");
  });
});

describe("schedule store and dispatcher", () => {
  it("creates, lists, edits, pauses/resumes; deleting needs confirmation", async () => {
    const db = fakeDb();
    const r = await createSchedule(USER, "bot1", { kind: "cron", recurrence: "daily 09:00", tz: "Europe/Istanbul", prompt: "راجع PRs المفتوحة" }, db, new Date("2026-10-21T05:00:00Z"));
    if (!r.ok) throw new Error(r.error);
    expect(r.schedule.next_run_at).toBe("2026-10-21T06:00:00.000Z");
    expect(r.schedule.chat_enc).not.toContain(String(USER));
    expect(scheduleChatId(r.schedule)).toBe(USER);
    expect((await listSchedules(USER, db)).map((s) => s.id)).toEqual([r.schedule.id]);
    expect(await listSchedules(CHAT, db)).toEqual([]);                                   // another user's list is empty
    const u = await updateSchedule(USER, r.schedule.id, { recurrence: "weekdays 08:00" }, db, new Date("2026-10-23T06:00:00Z"));
    expect(u.ok && u.schedule.cron).toBe("0 8 * * 1-5");
    expect((await setPaused(USER, r.schedule.id, true, db))?.paused).toBe(true);
    expect(await setPaused(CHAT, r.schedule.id, false, db)).toBeNull();                 // not yours
    expect(await deleteSchedule(USER, r.schedule.id, false, db)).toBe("confirm");
    expect(await deleteSchedule(CHAT, r.schedule.id, true, db)).toBe("not_found");
    expect(await deleteSchedule(USER, r.schedule.id, true, db)).toBe("deleted");
    expect(await listSchedules(USER, db)).toEqual([]);
  });

  it("validates input", async () => {
    const db = fakeDb();
    expect(await createSchedule(USER, "b", { kind: "cron", recurrence: "daily 99:00", prompt: "x" }, db)).toMatchObject({ ok: false });
    expect(await createSchedule(USER, "b", { kind: "cron", recurrence: "daily 09:00", prompt: "" }, db)).toMatchObject({ ok: false });
    expect(await createSchedule(USER, "b", { kind: "event", repo: "bad", events: ["push"], prompt: "x" }, db)).toMatchObject({ ok: false });
    expect(await createSchedule(USER, "b", { kind: "event", repo: "o/r", events: ["fork"], prompt: "x" }, db)).toMatchObject({ ok: false });
  });

  it("claims due rows once (moving next_run forward) and fans out one signed request per run", async () => {
    const db = fakeDb();
    const now = new Date("2026-10-21T06:01:00Z");
    const a = await createSchedule(USER, "bot1", { kind: "cron", recurrence: "daily 09:00", tz: "Europe/Istanbul", prompt: "a" }, db, new Date("2026-10-21T05:00:00Z"));
    const b = await createSchedule(CHAT, "bot1", { kind: "cron", recurrence: "daily 12:00", tz: "UTC", prompt: "b" }, db, new Date("2026-10-21T05:00:00Z"));
    if (!a.ok || !b.ok) throw new Error("create");
    const first = await claimDue(db, now);
    expect(first.map((s) => s.id)).toEqual([a.schedule.id]);
    expect(first[0].next_run_at).toBe("2026-10-22T06:00:00.000Z");
    expect(await claimDue(db, now)).toEqual([]);                                     // a second tick does not double-run
    const posts: any[] = [];
    const res = await fanOut(first, "https://site.test/", (async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return new Response("", { status: 202 }); }) as any);
    expect(res).toEqual([{ id: a.schedule.id, ok: true }]);
    expect(posts[0].url).toBe("https://site.test/api/coder/schedules/run");
    expect(verifyRun(posts[0].body.id, posts[0].body.at, posts[0].body.sig)).toBe(true);
    expect(verifyRun(b.schedule.id, posts[0].body.at, posts[0].body.sig)).toBe(false);
    expect(verifyRun(posts[0].body.id, posts[0].body.at - 3600_000, posts[0].body.sig)).toBe(false);
  });

  it("event tasks install a webhook with the user's own token and verify deliveries", async () => {
    const db = fakeDb();
    const calls = studio([], { "POST /repos/o/r/hooks": (b) => [201, { id: 77, config: b.config }] });
    // a linked user: resolveConnections reads coder_connections; this fake returns none -> manual instructions
    const r = await createSchedule(USER, "bot1", { kind: "event", repo: "o/r", events: ["pull_request", "push"], prompt: "راجع كل PR جديد" }, db);
    if (!r.ok) throw new Error(r.error);
    expect(r.hook?.ok).toBe(false);
    expect(r.hook?.note).toMatch(/\/api\/coder\/hooks\/github\?s=/);
    // the owner: env token -> installed
    const o = await createSchedule(CHAT, "bot1", { kind: "event", repo: "o/r", events: ["issues"], prompt: "صنّف القضايا" }, db);
    if (!o.ok) throw new Error(o.error);
    expect(o.hook?.ok).toBe(true);
    const sent = calls.find((c) => c.url.endsWith("/repos/o/r/hooks"))!.body;
    expect(sent.events).toEqual(["issues"]);
    expect(sent.config.url).toContain(`s=${o.schedule.id}`);
    const secret = sent.config.secret;
    const body = JSON.stringify({ action: "opened" });
    expect(verifyHubSignature(secret, body, "sha256=" + createHmac("sha256", secret).update(body).digest("hex"))).toBe(true);
    expect(verifyHubSignature(secret, body, "sha256=00")).toBe(false);
    expect(verifyHubSignature(secret, body, null)).toBe(false);
  });

  it("summarises only the events/actions worth a run", () => {
    expect(eventSummary("pull_request", { action: "opened", repository: { full_name: "o/r" }, sender: { login: "u" }, pull_request: { number: 3, title: "Fix", html_url: "h", head: { ref: "f" }, base: { ref: "main" } } })).toMatch(/Pull request #3 opened by u on o\/r/);
    expect(eventSummary("pull_request", { action: "closed", repository: {}, sender: {} })).toBeNull();
    expect(eventSummary("push", { ref: "refs/heads/main", commits: [{ id: "abcdef123", message: "m\nbody", author: { username: "u" } }], repository: { full_name: "o/r" }, sender: { login: "u" } })).toMatch(/Push to main .*\n- abcdef1 m \(u\)/);
    expect(eventSummary("push", { deleted: true, sender: {} })).toBeNull();
    expect(eventSummary("issues", { action: "opened", sender: { type: "Bot" } })).toBeNull();     // no loops on bot activity
    expect(eventSummary("workflow_run", { action: "completed", workflow_run: { conclusion: "failure", name: "CI", head_branch: "x", head_sha: "1234567890" }, repository: { full_name: "o/r" }, sender: {} })).toMatch(/FAILED/);
  });
});

describe("ask_user: the agent asks one question and waits for the answer", () => {
  it("asks in the chat, waits without a time limit, takes the next message as the answer and goes on", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("q1", "ask_user", { question: "أي فرع تقصد؟", options: ["main", "dev"] })] },
      { type: "done", job: "j2", text: "حسناً، سأعمل على dev.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "نظّف الفروع" } }, db);
    await new Promise((r) => setTimeout(r, 500));
    expect(sent.some((s) => /أي فرع تقصد/.test(s.text) && /1\. main/.test(s.text))).toBe(true);
    let st = await loadState(CHAT, db);
    expect(st.run?.asking?.id).toBe("q1");
    const before = calls.filter((c) => c.url.includes("/call/v2/chat")).length;
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.filter((c) => c.url.includes("/call/v2/chat")).length).toBe(before);   // nothing more is asked of the model while it waits
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "dev" } }, db);   // the answer
    await new Promise((r) => setTimeout(r, 600));
    st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect(st.messages.some((m: any) => m.role === "tool" && m.name === "ask_user" && m.content === "dev")).toBe(true);
    expect(sent.some((s) => /سأعمل على dev/.test(s.text))).toBe(true);
  });
});

describe("the model schedules a task from the chat, and the tick runs it", () => {
  it("schedule_create from a chat message creates the schedule; the next due tick starts the run", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("l1", "load_tools", { groups: ["schedule"] })] },
      { type: "done", job: "j2", text: "", tool_calls: [call("s1", "schedule_create", { title: "تقرير يومي", prompt: "اكتب تقرير حالة المستودع a/b", kind: "cron", recurrence: "daily 09:00" })] },
      { type: "done", job: "j3", text: "جدولتُ المهمة يومياً الساعة 09:00.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "كل صباح الساعة 9 اكتب تقرير حالة المستودع a/b" } }, db);
    await new Promise((r) => setTimeout(r, 900));
    expect(db.t.schedules).toHaveLength(1);
    const sch = db.t.schedules[0];
    expect(sch).toMatchObject({ kind: "cron", cron: "0 9 * * *", paused: false, title: "تقرير يومي" });
    expect(sch.next_run_at).toBeTruthy();
    expect(sent.some((s) => /جدولتُ المهمة/.test(s.text))).toBe(true);
    // the dispatcher: not yet due -> nothing; due -> one signed run request, and the next run moves forward
    const { runCoderTick } = await import("@/lib/coderTick");
    const before = calls.length;
    expect((await runCoderTick(db, new Date(Date.now() - 3600_000))).due).toBe(0);
    const later1 = new Date(new Date(sch.next_run_at).getTime() + 60_000);
    const r1 = await runCoderTick(db, later1);
    expect(r1).toMatchObject({ due: 1 });
    expect(calls.slice(before).some((c) => c.url.endsWith("/api/coder/schedules/run"))).toBe(true);
    expect(new Date(db.t.schedules[0].next_run_at).getTime()).toBeGreaterThan(later1.getTime());
    expect((await runCoderTick(db, later1)).due).toBe(0);                    // claimed once: a second tick in the same minute does not start it again
  });
});

describe("delegate: read-only sub-agents report back to the parent run", () => {
  it("two sub-agents run quietly on their own slots, the parent waits, gets both reports and answers", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "قراءة الواجهة", task: "اقرأ مجلد web في a/b وصف ملفاته" }, { title: "قراءة الخادم", task: "اقرأ مجلد api في a/b وصف ملفاته" }] })] },
      { type: "done", job: "j2", text: "تقرير الوكيل: الواجهة فيها ثلاثة ملفات.", tool_calls: [] },
      { type: "done", job: "j3", text: "تقرير الوكيل: الخادم فيه ملفان.", tool_calls: [] },
      { type: "done", job: "j4", text: "الخلاصة: المشروع واجهة وخادم.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "حلّل المشروع a/b: الواجهة والخادم" } }, db);
    await new Promise((r) => setTimeout(r, 2500));
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    const tool = st.messages.find((m: any) => m.role === "tool" && m.name === "delegate") as any;
    expect(tool.tool_call_id).toBe("d1");
    expect(tool.content).toMatch(/## Agent 1: قراءة الواجهة/);
    expect(tool.content).toMatch(/## Agent 2: قراءة الخادم/);
    expect(tool.content).toMatch(/الواجهة فيها ثلاثة ملفات/);
    expect(tool.content).toMatch(/الخادم فيه ملفان/);
    expect(sent.some((s) => /الخلاصة: المشروع واجهة وخادم/.test(s.text))).toBe(true);
    expect(sent.some((s) => /تقرير الوكيل/.test(s.text))).toBe(false);               // a sub-agent never writes to the chat
    const chatCalls = calls.filter((c) => c.url.includes("/call/v2/chat"));
    expect(chatCalls).toHaveLength(4);
    const childCall = chatCalls.find((c) => /read-only research sub-agent/.test(String(c.body?.data?.[0] ?? JSON.stringify(c.body))))!;
    expect(childCall).toBeTruthy();
    expect(JSON.stringify(childCall.body)).not.toMatch(/github_write_files|sandbox_exec|ask_user|delegate/);   // only the read-only tools
  });

  it("a sub-agent that asks for a writing tool is refused by the runner and still reports", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { task: "نظّف الفروع القديمة في a/b" })] },
      { type: "done", job: "j2", text: "", tool_calls: [call("x1", "github_delete_branch", { repo: "a/b", branch: "old" })] },
      { type: "done", job: "j3", text: "تقرير: لم أستطع الحذف، قراءة فقط.", tool_calls: [] },
      { type: "done", job: "j4", text: "تم.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "نظّف a/b" } }, db);
    await new Promise((r) => setTimeout(r, 2500));
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect((st.messages.find((m: any) => m.name === "delegate") as any).content).toMatch(/قراءة فقط/);
    expect(calls.some((c) => c.url.includes("api.github.com") && /git\/refs/.test(c.url))).toBe(false);   // nothing was deleted
  });
});

describe("delegate: the tester sub-agent", () => {
  it("only the tester gets the sandbox tools (reader does not), at most one tester per call", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "اختبار", task: "شغّل اختبارات a/b", role: "tester" }, { title: "اختبار ثان", task: "شغّل اختبارات a/b أيضاً", role: "tester" }, { title: "قراءة", task: "اقرأ README في a/b" }] })] },
      { type: "done", job: "j2", text: "تقرير 1", tool_calls: [] },
      { type: "done", job: "j3", text: "تقرير 2", tool_calls: [] },
      { type: "done", job: "j4", text: "تقرير 3", tool_calls: [] },
      { type: "done", job: "j5", text: "انتهى.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اختبر المشروع a/b" } }, db);
    await new Promise((r) => setTimeout(r, 3000));
    const chat = calls.filter((c) => c.url.includes("/call/v2/chat")).map((c) => JSON.stringify(c.body));
    expect(chat).toHaveLength(5);
    const withSandbox = chat.filter((b) => /sandbox_exec/.test(b) && /test-runner sub-agent/.test(b));
    expect(withSandbox).toHaveLength(1);                                                  // the second "tester" became a reader
    expect(chat.filter((b) => /read-only research sub-agent/.test(b))).toHaveLength(2);
    expect(chat.filter((b) => /read-only research sub-agent/.test(b)).some((b) => /sandbox_exec/.test(b))).toBe(false);
    expect(withSandbox[0]).not.toMatch(/sandbox_write_file|github_write_files|github_delete_branch/);   // no writing tools, even for the tester
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
  });

  it("the tester cannot write files into the VM or touch GitHub: those calls are refused and it still reports", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "اختبار", task: "شغّل اختبارات a/b", role: "tester" }] })] },
      { type: "done", job: "j2", text: "", tool_calls: [call("x1", "sandbox_write_file", { path: "a.txt", content: "x" }), call("x2", "github_write_files", { repo: "a/b", branch: "main", message: "m", files: [] })] },
      { type: "done", job: "j3", text: "تقرير: لم أستطع تعديل شيء، تشغيل فقط.", tool_calls: [] },
      { type: "done", job: "j4", text: "تم.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اختبر a/b" } }, db);
    await new Promise((r) => setTimeout(r, 3000));
    const chat = calls.filter((c) => c.url.includes("/call/v2/chat"));
    expect(chat).toHaveLength(4);
    expect(JSON.stringify(chat[2].body)).toMatch(/DENIED: sub-agents are read-only/);          // the tester's next step shows both refusals
    expect(calls.some((c) => c.url.includes("api.github.com") && /git\/(blobs|commits|refs)/.test(c.url))).toBe(false);
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect((st.messages.find((m: any) => m.name === "delegate") as any).content).toMatch(/تشغيل فقط/);
  });
});

describe("delegate inside a scheduled task", () => {
  it("a scheduled run can delegate: the children stay silent, the scheduled run finishes and reports to the chat", async () => {
    const db = fakeDb();
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "الفروع", task: "اقرأ قائمة الفروع في a/b" }, { title: "الطلبات", task: "اقرأ طلبات الدمج المفتوحة في a/b" }] })] },
      { type: "done", job: "j2", text: "تقرير داخلي: ثلاثة فروع.", tool_calls: [] },
      { type: "done", job: "j3", text: "تقرير داخلي: طلب دمج واحد.", tool_calls: [] },
      { type: "done", job: "j4", text: "تقرير الساعة: ثلاثة فروع وطلب دمج.", tool_calls: [] },
    ]);
    const { bot, sent } = fakeBot();
    const r = await startScheduledRun(bot, botRow, USER, { scheduleId: "abcdefabcdef", title: "تقرير كل ساعة", prompt: "لخّص حالة المستودع a/b", source: "scheduled" }, db);
    expect(r).toBe("started");
    await new Promise((res) => setTimeout(res, 3000));
    const parent = await loadState(USER, db, "s:abcdefabcdef");
    expect(parent.run).toBeNull();
    expect((parent.messages.find((m: any) => m.name === "delegate") as any).content).toMatch(/ثلاثة فروع[\s\S]*طلب دمج واحد/);
    expect(db.t.tasks.find((x: any) => x.slot === "s:abcdefabcdef")).toMatchObject({ source: "scheduled", status: "done" });
    const texts = sent.map((s) => s.text);
    expect(texts).toContain("تقرير الساعة: ثلاثة فروع وطلب دمج.");
    expect(texts.some((t) => /تقرير داخلي/.test(t))).toBe(false);                     // children never write to the chat
    expect(calls.filter((c) => c.url.includes("/call/v2/chat")).length).toBeGreaterThanOrEqual(4);   // (a scheduled run also learns memories afterwards)
  });
});

describe("delegate: the sham role (owner only) puts a question to Sham and brings back its raw answer", () => {
  it("the owner's sub-agent asks Sham (no tools, no system prompt, one step); the parent receives the raw answer to judge", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "اختبار شام", task: "ما عاصمة سوريا؟", role: "sham" }] })] },
      { type: "text", text: "دمشق هي عاصمة سوريا." },                                         // Sham's own reply (generate_any)
      { type: "done", job: "j3", text: "حكمي: إجابة شام صحيحة وقصيرة.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اسأل شام عن عاصمة سوريا وقيّم جوابه" } }, db);
    await new Promise((r) => setTimeout(r, 2500));
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    const tool = (st.messages.find((m: any) => m.name === "delegate") as any).content;
    expect(tool).toMatch(/## Agent 1: Sham: اختبار شام/);
    expect(tool).toMatch(/دمشق هي عاصمة سوريا/);
    expect(sent.some((s) => /حكمي: إجابة شام صحيحة/.test(s.text))).toBe(true);
    expect(calls.some((c) => c.url.includes("/gradio_api/call/v2/generate_any"))).toBe(true);
    expect(calls.filter((c) => c.url.includes("/call/v2/chat"))).toHaveLength(2);                // the parent's two steps only: Sham's call is not a coder-Studio chat
    const sham = calls.find((c) => c.url.includes("/call/v2/generate_any"))!;
    expect(sham.body).toMatchObject({ prompt: "ما عاصمة سوريا؟" });                                // only the task text goes to Sham
  });

  it("a regular user cannot reach Sham through delegate: the role becomes a normal read-only reader", async () => {
    const calls = studio([
      { type: "done", job: "j1", text: "", tool_calls: [call("d1", "delegate", { tasks: [{ title: "x", task: "ما عاصمة سوريا؟", role: "sham" }] })] },
      { type: "done", job: "j2", text: "تقرير القارئ.", tool_calls: [] },
      { type: "done", job: "j3", text: "تم.", tool_calls: [] },
    ]);
    const db = fakeDb();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: USER }, text: "اسأل شام" } }, db);
    await new Promise((r) => setTimeout(r, 2500));
    expect(calls.some((c) => c.url.includes("generate_any"))).toBe(false);
    expect(calls.filter((c) => c.url.includes("/call/v2/chat")).some((c) => /read-only research sub-agent/.test(JSON.stringify(c.body)))).toBe(true);
  });
});

describe("research fast path: one deep research first, then the report", () => {
  it("a plain research request gets the sources before the first model step and ends in one model step", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "التقرير: الطوابير وإعادة المحاولة هي الحل الشائع [1].", tool_calls: [] }]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اذهب وابحث عن مشاريع ذكاء اصطناعي تستخدم تلجرام كواجهة وكيف تحل مشكلة التأخر وانقطاع الاتصال" } }, db);
    for (let i = 0; i < 80 && !calls.some((c) => c.url.includes("/call/v2/chat")); i++) await new Promise((r) => setTimeout(r, 250));   // the searches run first
    await new Promise((r) => setTimeout(r, 1500));
    const chat = calls.filter((c) => c.url.includes("/call/v2/chat"));
    expect(chat).toHaveLength(1);                                                         // the harness did the searching; the model wrote the report in ONE step
    const body = JSON.stringify(chat[0].body);
    expect(body).toMatch(/deep_research/);
    expect(body).toMatch(/already run for you/);
    expect(JSON.parse(chat[0].body.tools).length).toBeGreaterThan(0);
    expect(sent.some((s) => /التقرير: الطوابير/.test(s.text))).toBe(true);
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect(st.messages.some((m: any) => m.role === "tool" && m.name === "deep_research")).toBe(true);
  }, 40000);

  it("a request that writes, schedules or is about the user's own repo is NOT turned into a research", async () => {
    const calls = studio([{ type: "done", job: "j1", text: "تم.", tool_calls: [] }]);
    const db = fakeDb();
    const { bot } = fakeBot();
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اكتب لي دالة بايثون تبحث عن أكبر رقم في قائمة وتعيده مع شرح" } }, db);
    await new Promise((r) => setTimeout(r, 1500));
    expect(JSON.stringify(calls.filter((c) => c.url.includes("/call/v2/chat"))[0]?.body)).not.toMatch(/already run for you/);
  });
});

describe("Sham (advanced): Sham inside the engine, with the engine's research as its sources", () => {
  it("the owner's research request runs deep research first, hands Sham the sources, and Sham's answer is delivered", async () => {
    const calls = studio([{ type: "text", text: "بحسب المصادر: الطوابير وإعادة المحاولة هي الحل الشائع للانقطاع في بوتات تلجرام الذكية." }]);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await saveState(CHAT, { ...st0("x", null), model: "sham_loop", messages: [] } as any, db);
    await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "اذهب وابحث عن مشاريع ذكاء اصطناعي تستخدم تلجرام كواجهة وكيف تحل مشكلة التأخر وانقطاع الاتصال" } }, db);
    for (let i = 0; i < 80 && !calls.some((c) => c.url.includes("/call/v2/generate_any")); i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 1500));
    const sham = calls.find((c) => c.url.includes("/call/v2/generate_any"))!;
    expect(sham).toBeTruthy();
    expect(String(sham.body.prompt)).toMatch(/السؤال: اذهب وابحث عن مشاريع/);
    expect(String(sham.body.prompt)).not.toMatch(/Nova AI|IDENTITY|load_tools/);              // no Nova system prompt or tool schemas for Sham
    expect(calls.some((c) => c.url.includes("/call/v2/chat"))).toBe(false);                    // the coder Studio was not used for the answer
    expect(sent.some((s) => /الطوابير وإعادة المحاولة هي الحل الشائع/.test(s.text))).toBe(true);
    expect((await loadState(CHAT, db)).run).toBeNull();
  }, 40000);
});
