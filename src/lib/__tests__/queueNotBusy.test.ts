// Congestion: a request never ends as "busy": it waits in line with a visible position / estimate, then runs; Sham v2 goes to its overflow Studio when the primary is taken
// (never to Nova's), two different users do not see each other's jobs. Real SQL engine.
import { shamAgentRun } from "@/lib/shamAgent";
import { queueInfo, queueLine } from "@/lib/queueInfo";
import { taskStart, taskStatus } from "@/lib/coderTasks";
import { pgDb, resetPg } from "./pgDb";

beforeEach(async () => { await resetPg(); });
const ctx = {} as any;
const base = { ctx, tools: [], budgetMs: 60000, maxSteps: 2, now: () => Date.now() };

describe("busy becomes a queue", () => {
  it("answers 'busy' twice, then the Studio frees up: the user gets the answer and saw queue lines, never 'busy'", async () => {
    let n = 0;
    const events: string[] = [];
    const r = await shamAgentRun({ ...base, text: "سؤال", ask: async () => (++n <= 2 ? { type: "busy", text: "شام مشغول" } : { type: "text", text: "الجواب الجاهز" }), onEvent: (_k, t) => events.push(t), queueNote: async (a) => `⏳ طلبك في الدور — الترتيب 1 (محاولة ${a})`, continuable: true } as any);
    expect(r.kind).toBe("text");
    expect((r as any).text).toBe("الجواب الجاهز");
    expect(events.filter((e) => /في الدور/.test(e)).length).toBe(2);
    expect(events.join(" ")).not.toMatch(/مشغول/);
  });
  it("still busy at the end of the leg: handed to the next background leg (queued), not a 'busy' reply", async () => {
    const r = await shamAgentRun({ ...base, budgetMs: 20000, text: "سؤال", ask: async () => ({ type: "busy", text: "x" }), continuable: true } as any);
    expect(["more"]).toContain(r.kind);
  });
  it("queue position counts the running tasks of other users ahead; the same family only", async () => {
    const d: any = pgDb();
    await taskStart(111, { runId: "sham-111-a", slot: "sham", source: "interactive", title: "x", botId: "b" }, d);
    await taskStart(222, { runId: "sham-222-b", slot: "sham", source: "interactive", title: "x", botId: "b" }, d);
    await taskStart(333, { runId: "novarun0001", slot: "", source: "interactive", title: "x", botId: "b" }, d);
    await taskStart(444, { runId: "sham-444-c", slot: "sham", source: "interactive", title: "x", botId: "b" }, d);
    const q = await queueInfo("sham-444-c", "sham", 2, d);
    expect(q.ahead).toBe(2);                                   // Nova's task is not in Sham's line
    expect(q.position).toBe(1);                                // two Studios (primary + overflow), both taken: one must finish first
    expect(queueLine(q)).toMatch(/الترتيب 1/);
    await taskStatus("sham-111-a", "done", 1, d);
    expect((await queueInfo("sham-444-c", "sham", 2, d)).position).toBe(0);
    expect(queueLine({ ahead: 0, position: 0, etaSec: 0 })).not.toMatch(/مشغول/);
  });
});
