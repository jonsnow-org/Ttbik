// Real CPU end-to-end run of Sham v2's agent loop against a local Sham v2 (Qwen3-1.7B body, Sham's own class + chat path).
// Start the model first:  python e2e/local-cpu/sham_v2_local.py   (port 7872).  Then: cd athar && npx jest --config ../jest.e2e.config.js --rootDir .. shamV2Agent
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { shamAgentRun } from "@/lib/shamAgent";
import { shamTools, shamRunTool, type ShamCtx } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";
import type { CoderToolCall } from "@/lib/openCoderStudio";

process.env.MODELSCOPE_API_TOKEN = "local";
process.env.SHAM_V2_URL = process.env.SHAM_V2_URL || "http://127.0.0.1:7872";

// public GitHub reads without any token: the Authorization header is stripped so no credential is used
const publicFetch = ((url: string, init: any = {}) => { const h = { ...(init.headers || {}) }; delete h.Authorization; return fetch(url, { ...init, headers: h }); }) as typeof fetch;
const ctx = (): ShamCtx => ({ chatId: 1, db: {} as any, githubToken: "public-read", chatKey: "sham:e2e", runId: "sham-e2e", owner: true, fetchImpl: publicFetch });

// a throw-away local directory standing in for the sandbox VM (the real VM needs Vercel credentials)
const work = mkdtempSync(join(tmpdir(), "sham-e2e-"));
async function exec(call: CoderToolCall, c: ShamCtx): Promise<string> {
  const a = JSON.parse(call.function.arguments || "{}");
  const n = call.function.name;
  if (n === "sandbox_write_file") { const p = join(work, String(a.path)); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, String(a.content)); return `wrote ${a.path} (${String(a.content).length} chars)`; }
  if (n === "sandbox_exec") { try { return execFileSync("bash", ["-lc", String(a.command)], { cwd: work, timeout: 60000, encoding: "utf8" }).slice(0, 3000) || "(no output)"; } catch (e: any) { return `exit ${e.status}: ${String(e.stdout || "")}${String(e.stderr || "")}`.slice(0, 3000); } }
  if (n === "sandbox_read_file") return execFileSync("bash", ["-lc", `cat ${JSON.stringify(String(a.path))}`], { cwd: work, encoding: "utf8" }).slice(0, 3000);
  return shamRunTool(call, c);
}

const log: string[] = [];
const run = (text: string, extra: any = {}) => shamVariant.run("v2", () => shamAgentRun({ text, ctx: ctx(), tools: shamTools(true), budgetMs: 600000, askMs: 300000, maxSteps: 8, maxNew: 200, exec, onEvent: (k, t) => log.push(`${k}: ${t.slice(0, 200)}`), ...extra }));

describe("Sham v2 agent loop on a real CPU model", () => {
  it("GitHub read path: reads a file of a public repo through github_read_file", async () => {
    log.length = 0;
    const r = await run("اقرأ الملف README من المستودع octocat/Hello-World على GitHub وقل لي ماذا فيه.");
    console.log("S1", JSON.stringify({ kind: r.kind, used: r.used, steps: r.steps, text: (r as any).text }), log.join("\n"));
    expect(r.used).toContain("github_read_file");
  });
  it("coding path: writes code to a file, runs it, reports the real output", async () => {
    log.length = 0;
    const r = await run("اكتب برنامج بايثون في الملف fib.py يطبع أول 10 أعداد من متتالية فيبوناتشي ثم شغّله وأخبرني بالناتج.");
    console.log("S2", JSON.stringify({ kind: r.kind, used: r.used, steps: r.steps, text: (r as any).text }), log.join("\n"));
    expect(r.used).toEqual(expect.arrayContaining(["sandbox_write_file", "sandbox_exec"]));
  });
  it("harder coding path: a class + unit tests in one file, run, reports the real result", async () => {
    log.length = 0;
    const r = await run("اكتب في الملف stack.py كلاس Stack في بايثون فيه push وpop وpeek وis_empty، وأضف في نفس الملف اختبارات unittest لها، ثم شغّل الاختبارات وأخبرني هل نجحت.");
    console.log("S3", JSON.stringify({ kind: r.kind, used: r.used, steps: r.steps, text: (r as any).text }), log.join("\n"));
    expect(r.used).toEqual(expect.arrayContaining(["sandbox_write_file", "sandbox_exec"]));
    expect(log.join("\n")).toMatch(/Ran \d+ tests?/);
  });
});
