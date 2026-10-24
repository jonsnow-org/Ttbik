// Segment continuation (context checkpoint → summary → fresh context → next segment) and the hard ceiling counting steps since progress.
import { fallbackSummary, msgChars, needsSegment, segmentMessages, summaryRequest, usableSummary } from "@/lib/coderSegments";
import { afterCall, newStallState, stepsSinceProgress } from "@/lib/coderStall";
import { fakeBot, fakeDb } from "./coderFakes";

const CHAT = 4242;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const SUMMARY = "GOAL:\nbuild the thing\nPLAN:\n1. a 2. b\nDONE:\nread files 1..N\nREMAINING:\nwrite tests\nKEY FILES:\na/b:src/x.ts\nDECISIONS:\nkeep API\nNEXT STEP:\nwrite tests";

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "1";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "k";
  process.env.CODER_SEGMENT_CHARS = "9000";
});

describe("segments: pure parts", () => {
  it("needs a segment only when the context is large AND a few steps ran since the last one", () => {
    const big = [{ role: "user" as const, content: "x".repeat(9500) }];
    expect(needsSegment(big, { step: 5, segStep: 0 })).toBe(true);
    expect(needsSegment(big, { step: 5, segStep: 4 })).toBe(false);               // just compacted
    expect(needsSegment([{ role: "user", content: "short" }], { step: 50 })).toBe(false);
    expect(msgChars([{ role: "assistant", content: "ab", tool_calls: [call("1", "t", {})] } as any])).toBeGreaterThan(2);
  });

  it("summary request names every section; usable summaries are recognised; the fallback covers goal, files and next step", () => {
    const q = summaryRequest("fix the CI", 2).content;
    for (const h of ["GOAL:", "PLAN:", "DONE:", "REMAINING:", "KEY FILES:", "DECISIONS:", "NEXT STEP:"]) expect(q).toContain(h);
    expect(q).toContain("fix the CI");
    expect(usableSummary(SUMMARY)).toBe(true);
    expect(usableSummary("ok")).toBe(false);
    const fb = fallbackSummary("fix the CI", [{ role: "assistant", content: "next I will run the tests", tool_calls: [call("1", "sandbox_exec", {})] } as any], ["a/b:src/x.ts"], "1. plan");
    expect(usableSummary(fb)).toBe(true);
    expect(fb).toMatch(/fix the CI[\s\S]*sandbox_exec[\s\S]*a\/b:src\/x\.ts[\s\S]*run the tests/);
    const m = segmentMessages("fix the CI", SUMMARY, 3);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "user" });
    expect(m[0].content).toMatch(/^fix the CI[\s\S]*segment 3[\s\S]*NEXT STEP:/);
  });
});

describe("hard ceiling counts steps since real progress", () => {
  it("new actions and changed CI results are progress; a loop recovery is not", () => {
    const ss = newStallState();
    afterCall(ss, call("1", "github_read_file", { repo: "a/b", path: "x" }) as any, "content", 1);
    expect(stepsSinceProgress(ss, 1)).toBe(0);
    for (let s = 2; s <= 6; s++) afterCall(ss, call(String(s), "github_read_file", { repo: "a/b", path: "x" }) as any, "content", s);   // a loop → recovery
    expect(ss.level).toBeGreaterThan(0);
    expect(ss.progressStep).toBeGreaterThan(1);                                    // the no_progress window was reset by the recovery …
    expect(stepsSinceProgress(ss, 6)).toBe(5);                                     // … but the ceiling still counts from the last real progress
    afterCall(ss, call("7", "github_ci_status", { repo: "a/b", ref: "x" }) as any, "in_progress", 7);
    afterCall(ss, call("8", "github_ci_status", { repo: "a/b", ref: "x" }) as any, "in_progress", 8);
    expect(stepsSinceProgress(ss, 8)).toBe(1);
    afterCall(ss, call("9", "github_ci_status", { repo: "a/b", ref: "x" }) as any, "success", 9);    // CI moved on
    expect(stepsSinceProgress(ss, 9)).toBe(0);
  });
});

describe("segments in the agent loop", () => {
  function studio(n: number, opts: { summary?: string; summaryFails?: boolean } = {}) {
    const asked: any[] = [];
    let step = 0;
    let lastBody: any = null;
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });   // the next-leg handoff must be accepted
      if (url.includes("/gradio_api/call/v2/")) {
        lastBody = init?.body ? JSON.parse(init.body) : null;
        return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      }
      if (url.includes("/gradio_api/call/")) {
        const msgs = JSON.parse(lastBody?.data?.[0] ?? lastBody?.messages ?? "[]");
        asked.push(msgs);
        const last = msgs[msgs.length - 1]?.content || "";
        if (/Context checkpoint/.test(last)) {
          if (opts.summaryFails) return new Response(sse({ type: "error", error: "boom" }), { status: 200 });
          return new Response(sse({ type: "done", job: `s${step}`, text: opts.summary ?? SUMMARY, tool_calls: [] }), { status: 200 });
        }
        step++;
        if (step > n) return new Response(sse({ type: "done", job: `j${step}`, text: "انتهت المهمة الطويلة.", tool_calls: [] }), { status: 200 });
        return new Response(sse({ type: "done", job: `j${step}`, text: "", tool_calls: [call(`c${step}`, "github_read_file", { repo: "a/b", path: `src/f${step}.ts` })] }), { status: 200 });
      }
      if (url.startsWith("https://api.github.com/repos/a/b/contents/")) return new Response(JSON.stringify({ content: Buffer.from("y".repeat(3000)).toString("base64"), encoding: "base64", sha: "s" }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    return asked;
  }

  async function runLong(db: any, bot: any, legs = 12) {
    const { drive, saveState } = await import("@/lib/coderSections");
    await saveState(CHAT, { mode: "coder", think: false, messages: [{ role: "user", content: "اقرأ كل ملفات المشروع ولخّصها" }], notes: "", inbox: [], run: { id: "long1", chain: "c", sent: 0, step: 0, lease: Date.now(), goal: "اقرأ كل ملفات المشروع ولخّصها", source: "interactive", slot: "" } }, db);
    for (let leg = 0; leg < legs; leg++) {
      const { loadState } = await import("@/lib/coderSections");
      const st = await loadState(CHAT, db);
      if (!st.run) break;
      await drive(bot, botRow, CHAT, st.run.chain, db, 8000);
    }
  }

  it("a long task closes segments with a summary, keeps it as task memory, resets the context and finishes; no ceiling", async () => {
    const asked = studio(14);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await runLong(db, bot);
    const { loadState } = await import("@/lib/coderSections");
    const st = await loadState(CHAT, db);
    expect(st.run).toBeNull();
    expect(sent.some((s) => /انتهت المهمة الطويلة/.test(s.text))).toBe(true);
    expect(sent.some((s) => /المرحلة 2/.test(s.text))).toBe(true);
    expect(sent.some((s) => s.text.includes("GOAL:"))).toBe(false);                // the summary is internal, never sent as a reply
    expect(db.t.memory.length).toBeGreaterThanOrEqual(1);
    expect(db.t.memory[0]).toMatchObject({ run_id: "long1", segment: 1, summary: SUMMARY });
    expect(db.t.events.some((e) => e.kind === "segment" && e.run_id === "long1")).toBe(true);
    // after the checkpoint the model saw the request + summary, not the old tool results
    const iAfter = asked.findIndex((m) => /Context checkpoint/.test(m[m.length - 1]?.content || "")) + 1;
    const next = asked[iAfter];
    expect(next.filter((m: any) => m.role === "tool")).toHaveLength(0);
    expect(next.some((m: any) => /segment 2[\s\S]*NEXT STEP:/.test(m.content || ""))).toBe(true);
    expect(db.t.stalls.some((x: any) => x.pattern === "hard_ceiling")).toBe(false);
  }, 60000);

  it("a task longer than CODER_HARD_MAX_STEPS that keeps making progress is never cut by the ceiling", async () => {
    const { HARD_MAX_STEPS } = await import("@/lib/coderStall");
    studio(HARD_MAX_STEPS + 20);
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await runLong(db, bot, 400);
    expect(db.t.stalls.some((x: any) => x.pattern === "hard_ceiling")).toBe(false);
    expect(sent.some((s) => /سقف الأمان/.test(s.text))).toBe(false);
    expect(sent.some((s) => /انتهت المهمة الطويلة/.test(s.text))).toBe(true);
    expect(db.t.memory.length).toBeGreaterThan(5);
  }, 120000);

  it("when the summary job fails, the harness writes the summary itself and the task goes on", async () => {
    studio(10, { summaryFails: true });
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    await runLong(db, bot);
    expect(sent.some((s) => /انتهت المهمة الطويلة/.test(s.text))).toBe(true);
    expect(db.t.memory[0].summary).toMatch(/GOAL:[\s\S]*KEY FILES:[\s\S]*a\/b:src\/f\d+\.ts/);
    expect(db.t.events.some((e) => e.kind === "segment" && /harness summary/.test(e.text))).toBe(true);
  }, 60000);
});
