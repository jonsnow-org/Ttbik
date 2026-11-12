// LIVE task-level evaluation + latency suite (run only by .github/workflows/task-suite-live.yml). It MEASURES, it produces no training data.
// For each model SEPARATELY (coder = Nova, lfm25 = LFM2.5, sham = Sham v1, sham_v2 = Sham v2) it sends a fixed list of everyday tasks through the bot's own production entry
// points against the REAL Studios of that model (nothing is sent to Telegram) and prints one table row per task: pass/fail, seconds to the first visible message, total seconds, why.
// A task passes only when a real final answer exists: not empty, no error notice, no raw tool-call markup shown as the answer, and the expected fact when there is one.
import fs from "fs";
import path from "path";
import { drive, handleCoderSections, later, saveState } from "@/lib/coderSections";
import { continueShamRun, handleNovaBotUpdate } from "@/lib/novaBotLogic";
import { shamVariant } from "@/lib/shamStudio";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.mock("@/lib/prisma", () => {
  const actual = jest.requireActual("@/lib/prisma");
  const row = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" };
  const bot = new Proxy(actual.prisma.bot, { get: (t: any, k) => (k === "findUnique" ? async (a: any) => (a?.where?.id === "bot1" ? row : t.findUnique(a)) : t[k]) });
  return { ...actual, prisma: new Proxy(actual.prisma, { get: (t: any, k) => (k === "bot" ? bot : t[k]) }) };
});
jest.mock("@/lib/shamExec", () => {
  const runs = new Map<string, any>();
  return { ...jest.requireActual("@/lib/shamExec"),
    shamSaveRun: async (run: any) => { runs.set(run.runId, JSON.parse(JSON.stringify(run))); },
    shamTakeRun: async (_chat: number, runId: string) => { const r = runs.get(runId) ?? null; runs.delete(runId); return r; } };
});
jest.setTimeout(20_400_000);
(process.env as any).NODE_ENV = "production";

import { PROGRESS, TASKS, judge, type SuiteTask } from "./taskSuiteRules";

async function runTask(model: string, task: SuiteTask, db: any): Promise<{ first: number; total: number; reply: string; finished: boolean; tools: string[] }> {
  const chat = 4242;
  const sham = model === "sham" || model === "sham_v2";
  if (!task.keep) {
    await db.exec("DELETE FROM coder_tasks").catch(() => null);
    await saveState(chat, { mode: sham ? "sham" : "coder", think: false, messages: [], notes: "", inbox: [], run: null, model } as any, db);
  }
  const { bot, sent } = fakeBot();
  const realFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/api/coder/continue")) {
      const b = JSON.parse(String(init?.body || "{}"));
      const [who, ...rest] = String(b.chatId).split("#");
      later(() => drive(bot, botRow, Number(who), b.chain, db, 30000, rest.join("#")));
      return new Response("{}", { status: 202 });
    }
    if (url.endsWith("/api/sham/continue")) {
      const b = JSON.parse(String(init?.body || "{}"));
      const [who, ...rest] = String(b.chatId).split("#");
      later(() => continueShamRun(bot, Number(who), b.botId, rest.join("#")));
      return new Response("{}", { status: 202 });
    }
    return realFetch(input, init);
  }) as any;
  const startId = Number(((await db.query(`SELECT COALESCE(MAX(id),0) AS m FROM coder_task_events`).catch(() => [{ m: 0 }])) as any[])[0]?.m || 0);
  const t0 = Date.now();
  const update = { update_id: Date.now(), message: { chat: { id: chat }, from: { id: chat, first_name: "Owner" }, text: task.text } };
  try {
    // the handler may run the whole task in this process (it did for 3+ hours on a repository-reading task, 2026-11-12): the suite's own limit must apply to it too
    const work = sham ? shamVariant.run(model === "sham" ? "v1" : "v2", () => handleNovaBotUpdate(bot, botRow, update)) : handleCoderSections(bot, botRow, update, db);
    await Promise.race([Promise.resolve(work), new Promise((res) => setTimeout(res, task.limitS * 1000))]);
  } catch (e) {
    global.fetch = realFetch;
    return { first: -1, total: Math.round((Date.now() - t0) / 1000), reply: "", finished: true, tools: ["EXCEPTION " + String((e as Error)?.message || e).slice(0, 160)] };
  }
  const answers = () => sent.filter((s: any) => s.text && !PROGRESS.test(s.text));
  let first = -1;
  let finished = false;
  let stableSince = 0;
  let lastLen = -1;
  const tools: string[] = [];
  let lastEvent = startId;
  let sawTaskEvents = false;
  while (Date.now() - t0 < task.limitS * 1000 && !finished) {
    await new Promise((r) => setTimeout(r, 1500));
    if (first < 0 && sent.length) first = Math.round((Date.now() - t0) / 1000);
    const rows = (await db.query(`SELECT id, kind, text FROM coder_task_events WHERE id > $1 ORDER BY id`, lastEvent).catch(() => [])) as any[];
    for (const e of rows) {
      lastEvent = Number(e.id);
      sawTaskEvents = true;
      if (e.kind === "tool") tools.push(String(e.text || "").slice(0, 60));
      if (["done", "failed"].includes(String(e.kind))) finished = true;
    }
    // a plain reply (no task run) and Sham's replies have no "done" event: finished once an answer exists and nothing new arrived for a while
    const len = answers().map((s: any) => s.text).join("").length;
    if (len !== lastLen) { lastLen = len; stableSince = Date.now(); }
    if (!sawTaskEvents && len > 0 && Date.now() - stableSince > (sham ? 20000 : 8000)) finished = true;
  }
  global.fetch = realFetch;
  return { first, total: Math.round((Date.now() - t0) / 1000), reply: answers().map((s: any) => String(s.text)).join("\n"), finished, tools };
}

test("task suite: every model separately", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const models = (process.env.SUITE_MODELS || "coder,lfm25,sham,sham_v2").split(",").map((x) => x.trim()).filter(Boolean);
  const only = (process.env.SUITE_TASKS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const tasks = TASKS.filter((t) => !only.length || only.includes(t.id));
  const rows: Record<string, unknown>[] = [];
  for (const model of models) {
    const db: any = pgDb();
    for (const task of tasks) {
      const r = await runTask(model, task, db);
      const v = judge(task, model, r.reply, r.finished);
      const row = { model, task: task.id, pass: v.pass, first_s: r.first, total_s: r.total, why: v.why, tools: r.tools.length, reply: r.reply.replace(/\s+/g, " ").slice(0, 220) };
      rows.push(row);
      process.stderr.write(`SUITE | ${model} | ${task.id} | ${v.pass ? "PASS" : "FAIL"} | first ${r.first}s | total ${r.total}s | ${v.why || "ok"} | tools ${r.tools.length} | ${row.reply}\n`);
    }
  }
  const out = process.env.PROBE_OUT || "/tmp";
  fs.writeFileSync(path.join(out, "task-suite.json"), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  const table = ["| model | task | result | first s | total s | why |", "|---|---|---|---|---|---|", ...rows.map((r: any) => `| ${r.model} | ${r.task} | ${r.pass ? "PASS" : "FAIL"} | ${r.first_s} | ${r.total_s} | ${r.why} |`)];
  for (const m of models) {
    const mine = rows.filter((r: any) => r.model === m) as any[];
    table.push(`| **${m}** | passed ${mine.filter((r) => r.pass).length}/${mine.length} | | | ${mine.reduce((a, r) => a + r.total_s, 0)} | |`);
  }
  fs.writeFileSync(path.join(out, "task-suite.md"), table.join("\n") + "\n");
  console.log("SUITE_TABLE\n" + table.join("\n"));
  expect(rows.length).toBe(models.length * tasks.length);     // the suite measures; a failing task is a row, not a crashed job
});
