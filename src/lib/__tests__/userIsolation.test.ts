// Every job, chat, report and terminal view is keyed by the verified user id: one user never sees, reads, stops, continues or deletes another's. Real SQL engine.
import { appOp } from "@/lib/coderApp";
import { loadState, saveState } from "@/lib/coderSections";
import { coderChatKey } from "@/lib/coderAuth";
import { taskStart, taskEvent, listTasks, taskEvents, stopTaskRow } from "@/lib/coderTasks";
import { shamVariant } from "@/lib/shamStudio";
import * as S from "@/lib/shamThreads";
import * as N from "@/lib/coderThreads";
import { setSubscription } from "@/lib/coderPlans";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const A = 4242, B = 9300;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const ua = { chatId: A, tier: "user" as const }, ub = { chatId: B, tier: "user" as const };
beforeEach(async () => { await resetPg(); process.env.SHAM_MEMORY = "1"; process.env.CODER_TOKEN_KEY = "test-key"; process.env.SUPER_ADMIN_TELEGRAM_ID = "1"; });

async function seed(d: any) {
  await taskStart(A, { runId: "aaaa-run-1", slot: "", source: "interactive", title: "مهمة سرية لأحمد", botId: "bot1" }, d);
  await taskEvent("aaaa-run-1", "text", "تقرير أحمد السري", d);
  await taskStart(A, { runId: "sham-4242-x1", slot: "sham", source: "interactive", title: "مهمة شام لأحمد", botId: "bot1" }, d);
  await taskStart(B, { runId: "bbbb-run-1", slot: "", source: "interactive", title: "مهمة بشير", botId: "bot1" }, d);
  const st = await loadState(A, d);
  st.messages.push({ role: "user", content: "رسالة أحمد" }, { role: "assistant", content: "جواب" });
  const id = await N.createThread(A, st, d, "رسالة أحمد");
  st.threadId = id; await saveState(A, st, d); await N.syncThread(coderChatKey(A), id, st, d, false);
  await shamVariant.run("v2", () => S.saveChatTurn(A, "سؤال شام أحمد", "جواب", d));
  return id;
}

describe("cross-user isolation", () => {
  it("the terminal lists only the caller's tasks and reads only the caller's events", async () => {
    const d: any = pgDb(); await seed(d);
    expect((await listTasks(B, { limit: 50 }, d)).map((t: any) => t.run_id)).toEqual(["bbbb-run-1"]);
    expect((await listTasks(A, { limit: 50 }, d)).map((t: any) => t.run_id).sort()).toEqual(["aaaa-run-1", "sham-4242-x1"]);
    expect(await taskEvents(B, "aaaa-run-1", 0, d)).toEqual([]);                     // knowing another's run id gives nothing
    expect((await taskEvents(A, "aaaa-run-1", 0, d)).some((e: any) => /تقرير أحمد/.test(e.text))).toBe(true);
  });
  it("another user can neither stop nor close a task that is not theirs", async () => {
    const d: any = pgDb(); await seed(d); const { bot } = fakeBot();
    expect(await stopTaskRow(B, "aaaa-run-1", d)).toBe(false);
    await appOp(ub, "task_stop", { runId: "aaaa-run-1" }, { db: d, bot, botRow });
    const r: any = await appOp(ub, "stop_all", {}, { db: d, bot, botRow });
    expect(r.stopped).toBe(1);                                                        // only B's own
    const mine = await listTasks(A, { limit: 50 }, d);
    expect(mine.every((t: any) => t.status === "running")).toBe(true);
  });
  it("chat lists, messages, open, delete are the caller's only", async () => {
    const d: any = pgDb(); const id = await seed(d); const { bot } = fakeBot();
    const lb: any = await appOp(ub, "chats", { model: "all" }, { db: d, bot, botRow });
    expect(JSON.stringify(lb.items)).not.toMatch(/أحمد/); expect(lb.items.some((x: any) => x.id === id)).toBe(false);   // B sees at most its own (empty) open chat
    const la: any = await appOp(ua, "chats", { model: "all" }, { db: d, bot, botRow });
    expect(la.items.some((x: any) => x.id === id)).toBe(true);
    const m: any = await appOp(ub, "chat_messages", { model: "coder", id }, { db: d, bot, botRow }).catch((e: any) => ({ err: e }));
    expect(m.messages?.length || 0).toBe(0);
    await appOp(ub, "chat_open", { model: "coder", id }, { db: d, bot, botRow }).catch(() => null);
    expect((await loadState(B, d)).threadId || null).not.toBe(id);
    await appOp(ub, "thread_delete", { id }, { db: d, bot, botRow }).catch(() => null);
    await appOp(ub, "chat_delete", { model: "coder", id }, { db: d, bot, botRow }).catch(() => null);
    const after: any = await appOp(ua, "chats", { model: "all" }, { db: d, bot, botRow });
    expect(after.items.some((x: any) => x.id === id)).toBe(true);   // A's chat is still there
  });
  it("two users' jobs do not share a lane: B's list and live view never show A's running work", async () => {
    const d: any = pgDb(); await seed(d); const { bot } = fakeBot();
    const live: any = await appOp(ub, "tasks", { active: true }, { db: d, bot, botRow }).catch(() => ({ items: [] }));
    expect(JSON.stringify(live)).not.toMatch(/أحمد|aaaa-run-1/);
  });
  it("the app tells a free user there is no terminal; a paid user and the owner get it (decided server-side from the verified id)", async () => {
    const d: any = pgDb(); const { bot } = fakeBot();
    const feat = async (u: any) => ((await appOp(u, "me", {}, { db: d, bot, botRow })) as any).features.terminal;
    expect(await feat(ua)).toBe(false);
    await setSubscription(B, "plus", 30, "test", d);
    expect(await feat(ub)).toBe(true);
    expect(await feat({ chatId: 1, tier: "owner" })).toBe(true);
    expect(await feat(ua)).toBe(false);                                               // the other free user is unchanged
  });
});
