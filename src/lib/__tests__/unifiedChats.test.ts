// ONE chat list for the person: every conversation of every model (Nova from Telegram/app, Sham, Sham v2), tagged with its model; any chat continues by
// selecting its model; delete works across models; the other user never sees them. Real SQL engine.
import { appOp } from "@/lib/coderApp";
import { loadState, saveState } from "@/lib/coderSections";
import { coderChatKey } from "@/lib/coderAuth";
import { shamVariant } from "@/lib/shamStudio";
import * as S from "@/lib/shamThreads";
import * as N from "@/lib/coderThreads";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242, OTHER = 9300;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const asV = <T,>(v: "v1" | "v2", f: () => Promise<T>) => shamVariant.run(v, f);
const owner = { chatId: OWNER, tier: "owner" as const };
beforeEach(async () => {
  await resetPg();
  process.env.SHAM_MEMORY = "1"; process.env.CODER_TOKEN_KEY = "test-key"; process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.MODELSCOPE_API_TOKEN = "ms";
});

async function seed(d: any) {
  const st = await loadState(OWNER, d);
  st.messages.push({ role: "user", content: "سؤال نوفا من تيليجرام" }, { role: "assistant", content: "جواب نوفا" });
  const id = await N.createThread(OWNER, st, d, "سؤال نوفا من تيليجرام");
  st.threadId = id;
  await saveState(OWNER, st, d);
  await N.syncThread(coderChatKey(OWNER), id, st, d, false);
  await asV("v1", () => S.saveChatTurn(OWNER, "سؤال شام", "جواب شام", d));
  await asV("v2", () => S.saveChatTurn(OWNER, "سؤال شام الثاني", "جواب", d));
  await asV("v2", () => S.saveChatTurn(OTHER, "محادثة غيري", "جواب", d));
  return id;
}

describe("the unified chat list", () => {
  it("shows every model's chats together with their model tag; never another user's", async () => {
    const d: any = pgDb();
    const { bot } = fakeBot();
    const novaId = await seed(d);
    const out: any = await appOp(owner, "chats", { model: "all" }, { db: d, bot, botRow });
    const by = Object.fromEntries(out.items.map((x: any) => [x.model, x.title]));
    expect(by).toEqual({ coder: "سؤال نوفا من تيليجرام", sham: "سؤال شام", sham_v2: "سؤال شام الثاني" });
    expect(out.items.find((x: any) => x.model === "coder").id).toBe(novaId);
    expect(out.items.some((x: any) => /غيري/.test(x.title))).toBe(false);
    const one: any = await appOp(owner, "chats", { model: "sham_v2" }, { db: d, bot, botRow });
    expect(one.items.map((x: any) => x.model)).toEqual(["sham_v2"]);
  });

  it("any chat can be continued by its own model: opening Sham's chat from the unified list switches to Sham and keeps connectors/history", async () => {
    const d: any = pgDb();
    const { bot } = fakeBot();
    await seed(d);
    const all: any = await appOp(owner, "chats", { model: "all" }, { db: d, bot, botRow });
    const sham = all.items.find((x: any) => x.model === "sham_v2");
    await appOp(owner, "chat_open", { model: sham.model, id: sham.id }, { db: d, bot, botRow });
    const st = await loadState(OWNER, d);
    expect(st.model).toBe("sham_v2");
    expect(st.mode).toBe("sham");
    const msgs: any = await appOp(owner, "chat_messages", { model: "sham_v2", id: sham.id }, { db: d, bot, botRow });
    expect(msgs.messages.map((m: any) => m.text)).toEqual(["سؤال شام الثاني", "جواب"]);
    // and back to Nova: its conversation is intact
    const nova = all.items.find((x: any) => x.model === "coder");
    await appOp(owner, "chat_open", { model: "coder", id: nova.id }, { db: d, bot, botRow });
    expect((await loadState(OWNER, d)).model).toBe("coder");
    const again: any = await appOp(owner, "chats", { model: "all" }, { db: d, bot, botRow });
    expect(again.items.length).toBe(3);                                                       // a switch loses nothing
  });

  it("delete works for each model's chat from the same list", async () => {
    const d: any = pgDb();
    const { bot } = fakeBot();
    await seed(d);
    const all: any = await appOp(owner, "chats", { model: "all" }, { db: d, bot, botRow });
    for (const x of all.items.filter((i: any) => i.model !== "coder")) await appOp(owner, "chat_delete", { model: x.model, ids: [x.id] }, { db: d, bot, botRow });
    const after: any = await appOp(owner, "chats", { model: "all" }, { db: d, bot, botRow });
    expect(after.items.map((x: any) => x.model)).toEqual(["coder"]);
  });
});

describe("the shared terminal survives dropped connections", () => {
  it("polling resumes from the cursor after a gap with nothing lost or repeated, for a Nova run and a Sham run alike; both are in the one task list", async () => {
    const d: any = pgDb();
    const { bot } = fakeBot();
    const { taskStart, taskEvent, taskStatus } = await import("@/lib/coderTasks");
    for (const id of ["nova-run-1", "sham-1-abc"]) {
      await taskStart(OWNER, { runId: id, slot: id.startsWith("sham") ? "sham" : "", source: "interactive", title: id }, d);
      await taskEvent(id, "info", "one", d); await taskEvent(id, "info", "two", d);
      const first: any = await appOp(owner, "events", { runId: id, after: 0 }, { db: d, bot, botRow });
      const cursor = Math.max(...first.events.map((e: any) => e.id));
      expect(first.events.map((e: any) => e.text)).toEqual(expect.arrayContaining(["one", "two"]));
      // the connection drops: the run keeps going on the server (events and status are in the database, not in the connection)
      await taskEvent(id, "info", "three", d); await taskEvent(id, "text", "result", d); await taskStatus(id, "done", 3, d);
      const second: any = await appOp(owner, "events", { runId: id, after: cursor }, { db: d, bot, botRow });
      expect(second.events.map((e: any) => e.text)).toEqual(["three", "result"]);
    }
    const tasks: any = await appOp(owner, "tasks", {}, { db: d, bot, botRow });
    expect(tasks.tasks.map((t: any) => t.run_id).sort()).toEqual(["nova-run-1", "sham-1-abc"]);
  });
});
