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
