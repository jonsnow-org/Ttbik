// Sham v2's agent: every tool is shown to the model, helpers (delegate) really run read-only tools and report back, the new GitHub tools read real API answers,
// tool errors surface (never a raw plan as the answer).
import { shamAgentRun, shamToolDefs, SHAM_HELPER_TOOLS, type ShamAsk } from "@/lib/shamAgent";
import { shamRunTool, shamTools, SHAM_TOOLS, type ShamCtx } from "@/lib/shamExec";
import { shamToolBlock } from "@/lib/shamTools";
import { shamVariant } from "@/lib/shamStudio";

const mkCtx = (fetchImpl?: typeof fetch) => ({ chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: "t", chatKey: "sham:1", runId: "sham-1", owner: true, fetchImpl } as unknown as ShamCtx);
const call = (name: string, args: object) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
const text = (t: string) => ({ type: "text" as const, text: t });

describe("the tool list the model is shown", () => {
  it("lists EVERY tool (the old 2400-character cut dropped make_media and ask_user when connectors were on)", () => {
    const tools = shamTools(true, true);
    const block = shamToolBlock(tools);
    for (const t of tools) expect(block).toContain(`- ${t.function.name}(`);
    expect(block).toContain("- make_media(");
    expect(block).toContain("- ask_user(");
    expect(block).toContain("- delegate(");
    expect(block.length).toBeLessThan(4200);                               // the new body's prompt window is small
  });
  it("without GitHub there is no GitHub tool, but delegate and the VM stay", () => {
    const names = shamTools(false, false).map((t) => t.function.name);
    expect(names).not.toContain("github_prs");
    expect(names).not.toContain("github_ci");
    expect(names).toContain("delegate");
    expect(names).toContain("sandbox_exec");
  });
  it("helpers can only use read tools that really exist", () => {
    const all = new Set(SHAM_TOOLS.map((t) => t.function.name));
    for (const n of SHAM_HELPER_TOOLS) expect(all.has(n)).toBe(true);
    for (const w of ["sandbox_exec", "sandbox_write_file", "sandbox_edit_file", "sandbox_push", "github_create_pr", "github_merge_pr", "make_media", "ask_user", "delegate", "mcp_call", "connector_api", "schedule_create"]) expect(SHAM_HELPER_TOOLS.has(w)).toBe(false);
  });
});

describe("github_prs and github_ci read the real API answers", () => {
  const api = (routes: Record<string, unknown>): typeof fetch => (async (url: string) => {
    const path = String(url).replace("https://api.github.com", "");
    const hit = Object.entries(routes).find(([k]) => path.startsWith(k));
    return new Response(JSON.stringify(hit ? hit[1] : { message: "Not Found" }), { status: hit ? 200 : 404 });
  }) as unknown as typeof fetch;
  const run = (name: string, args: object, f: typeof fetch) => shamRunTool({ id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } } as any, mkCtx(f));
  it("lists pull requests", async () => {
    const out = await run("github_prs", { repo: "o/r" }, api({ "/repos/o/r/pulls?state=open": [{ number: 7, title: "Fix login", state: "open", head: { ref: "fix/login" }, base: { ref: "main" }, user: { login: "sam" } }] }));
    expect(out).toBe("#7 Fix login [open] fix/login → main by sam");
  });
  it("reads one pull request with its files", async () => {
    const out = await run("github_prs", { repo: "o/r", number: 7 }, api({
      "/repos/o/r/pulls/7/files": [{ status: "modified", filename: "src/auth.ts", additions: 4, deletions: 1 }],
      "/repos/o/r/pulls/7": { number: 7, title: "Fix login", state: "open", head: { ref: "fix/login" }, base: { ref: "main" }, user: { login: "sam" }, body: "Fixes the redirect", mergeable_state: "clean", additions: 4, deletions: 1, changed_files: 1 },
    }));
    expect(out).toContain("#7 Fix login [open] fix/login → main by sam");
    expect(out).toContain("modified src/auth.ts (+4 -1)");
    expect(out).toContain("Fixes the redirect");
  });
  it("CI: results per check and the error lines of a failed one", async () => {
    const out = await run("github_ci", { repo: "o/r", ref: "fix/login" }, api({
      "/repos/o/r/check-runs/55/annotations": [{ path: "src/auth.ts", start_line: 12, message: "Type 'string' is not assignable to type 'number'" }],
      "/repos/o/r/commits/fix%2Flogin/check-runs": { check_runs: [{ id: 54, name: "lint", conclusion: "success", status: "completed" }, { id: 55, name: "build", conclusion: "failure", status: "completed", output: { title: "tsc failed", summary: "1 error" } }] },
    }));
    expect(out).toContain("success: lint");
    expect(out).toContain("failure: build");
    expect(out).toContain("src/auth.ts:12 Type 'string' is not assignable");
  });
  it("an API error is returned as an error line, not thrown", async () => {
    expect(await run("github_ci", { repo: "o/r", ref: "x" }, api({}))).toMatch(/^error 404/);
    expect(await run("github_prs", { repo: "o/r", number: 99 }, api({}))).toMatch(/^error 404/);
  });
});

describe("delegate: helper agents inside Sham v2", () => {
  const tools = shamToolDefs(true);
  /** One fake model for the parent and its helpers, told apart by the prompt. */
  function model(seen: string[]): ShamAsk {
    return async (prompt) => {
      seen.push(prompt);
      const helper = /\[مهمة وكيل\]/.test(prompt);
      const done = /نتيجة الأداة/.test(prompt);
      if (!helper) {
        if (!done) return text(call("delegate", { tasks: [{ title: "قارئ الواجهة", task: "اقرأ README في o/web" }, { title: "قارئ الخادم", task: "اقرأ README في o/api" }] })) as any;
        return text("الخلاصة: الواجهة React والخادم Node.") as any;
      }
      const web = /o\/web/.test(prompt);
      if (!done) return text(call("github_read_file", { repo: web ? "o/web" : "o/api", path: "README.md" })) as any;
      return text(web ? "تقرير: الواجهة مبنية بـ React." : "تقرير: الخادم مبني بـ Node.") as any;
    };
  }
  it("two helpers read in parallel, the parent receives both reports and answers from them", async () => {
    const seen: string[] = [], ran: string[] = [], ev: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "حلّل المشروع: الواجهة والخادم", ctx: mkCtx(), tools, budgetMs: 120000, now: () => Date.now(), ask: model(seen),
      exec: async (c) => { ran.push(`${c.function.name}:${JSON.parse(c.function.arguments).repo}`); return "# README"; },
      onEvent: (k, t) => ev.push(`${k}:${t}`), onStep: (e) => ev.push(`step:${e.type}`),
    }));
    expect(r).toMatchObject({ kind: "text", text: "الخلاصة: الواجهة React والخادم Node." });
    expect(ran.sort()).toEqual(["github_read_file:o/api", "github_read_file:o/web"]);          // the helpers EXECUTED their tools
    const parentSecond = seen.filter((p) => !/\[مهمة وكيل\]/.test(p))[1];
    expect(parentSecond).toContain("تقرير: الواجهة مبنية بـ React.");                            // both reports reached the parent
    expect(parentSecond).toContain("تقرير: الخادم مبني بـ Node.");
    expect(parentSecond).toMatch(/## وكيل 1: قارئ الواجهة — DONE/);
    expect(ev).toContain("step:tool_start");
    expect(ev.some((e) => /وصلت تقارير الوكلاء \(2\/2\)/.test(e))).toBe(true);
  });
  it("a helper is never shown a writing / VM / media tool or delegate itself", async () => {
    const seen: string[] = [];
    await shamVariant.run("v2", () => shamAgentRun({ text: "حلّل", ctx: mkCtx(), tools, budgetMs: 120000, now: () => Date.now(), ask: model(seen), exec: async () => "ok" }));
    const helperPrompt = seen.find((p) => /\[مهمة وكيل\]/.test(p))!;
    for (const n of ["sandbox_exec", "sandbox_write_file", "sandbox_push", "github_merge_pr", "github_create_pr", "make_media", "ask_user", "delegate("]) expect(helperPrompt).not.toContain(n);
    expect(helperPrompt).toContain("github_read_file");
  });
  it("a helper that tries a writing tool is refused (not loaded) and still reports; nothing runs", async () => {
    const ran: string[] = [];
    const ask: ShamAsk = async (prompt) => {
      if (!/\[مهمة وكيل\]/.test(prompt)) return (/نتيجة الأداة/.test(prompt) ? text("انتهى.") : text(call("delegate", { tasks: [{ title: "منظف", task: "احذف الفروع القديمة" }] }))) as any;
      return text(call("github_merge_pr", { repo: "o/r", number: 1 })) as any;
    };
    const r = await shamVariant.run("v2", () => shamAgentRun({ text: "نظّف", ctx: mkCtx(), tools, budgetMs: 120000, now: () => Date.now(), ask, exec: async (c) => { ran.push(c.function.name); return "x"; } }));
    expect(ran).toEqual([]);
    expect(r.kind).toBe("text");
  });
  it("no time left: the tool answers with an error the model can act on, nothing is started", async () => {
    let t = 0;
    const seen: string[] = [];
    const ask: ShamAsk = async (prompt) => { seen.push(prompt); return (/نتيجة الأداة/.test(prompt) ? text("سأقرأ بنفسي.") : text(call("delegate", { tasks: [{ title: "a", task: "اقرأ شيئاً" }] }))) as any; };
    await shamVariant.run("v2", () => shamAgentRun({ text: "x", ctx: mkCtx(), tools, budgetMs: 21000, now: () => (t += 0), ask, exec: async () => "x" }));
    expect(seen[1]).toMatch(/not enough time left to delegate/);
  });
  it("bad arguments: tasks missing is caught by the schema check before anything runs", async () => {
    const seen: string[] = [];
    const ask: ShamAsk = async (prompt) => { seen.push(prompt); return (seen.length === 1 ? text(call("delegate", {})) : text("لم أستطع.")) as any; };
    const r = await shamVariant.run("v2", () => shamAgentRun({ text: "x", ctx: mkCtx(), tools, budgetMs: 60000, now: () => Date.now(), ask, exec: async () => "x" }));
    expect(seen[1]).toMatch(/tasks/);                                      // the model is told which argument is missing
    expect(r.kind).toBe("text");
  });
});
