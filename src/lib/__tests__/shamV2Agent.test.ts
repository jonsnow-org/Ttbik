import { brokenCallAttempt, normaliseShamArgs, parseShamToolCalls, validateShamCall } from "@/lib/shamTools";
import { shamAgentRun, shamToolDefs, type ShamAsk } from "@/lib/shamAgent";
import { shamVariant } from "@/lib/shamStudio";
import type { ShamCtx } from "@/lib/shamExec";
import { readFileSync } from "fs";
import { join } from "path";

const ctx = { chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: "t", chatKey: "sham:1", runId: "sham-1", owner: true } as unknown as ShamCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say>>, seen: string[] = []): ShamAsk => async (prompt) => { seen.push(prompt); return (answers.shift() ?? null) as any; };
const tools = shamToolDefs(true);

describe("a repo argument Sham almost gets right is fixed, not failed", () => {
  it.each([
    ["https://github.com/octocat/Hello-World", "octocat/Hello-World"],
    ["github.com/octocat/Hello-World.git", "octocat/Hello-World"],
    ["octocat/Hello-World/", "octocat/Hello-World"],
    ["octocat/Hello-World/tree/main", "octocat/Hello-World"],
  ])("%s -> %s", (given, want) => expect((normaliseShamArgs({ repo: given, path: "a.txt" }) as any).repo).toBe(want));
  it("owner in `repo`, name at the front of `path` are joined (seen on the real Qwen3-1.7B body)", () => {
    expect(normaliseShamArgs({ repo: "octocat", path: "Hello-World/README.md" })).toEqual({ repo: "octocat/Hello-World", path: "README.md" });
  });
  it("a plain file path is left alone", () => {
    expect(normaliseShamArgs({ repo: "octocat/Hello-World", path: "src/a.ts" })).toEqual({ repo: "octocat/Hello-World", path: "src/a.ts" });
    expect(normaliseShamArgs({ path: "src/a.ts" })).toEqual({ path: "src/a.ts" });
  });
  it("applied while the model's text is parsed, so the call validates", () => {
    const p = parseShamToolCalls('{"name": "github_read_file", "arguments": {"repo": "https://github.com/octocat/Hello-World.git", "path": "README"}}', tools);
    expect(p.calls).toHaveLength(1);
    expect(JSON.parse(p.calls[0].function.arguments).repo).toBe("octocat/Hello-World");
    expect(validateShamCall(p.calls[0], tools)).toBeFalsy();
  });
  it("a repo that is still not owner/name fails the check with a clear reason", () => {
    const p = parseShamToolCalls('<tool_call>{"name":"github_read_file","arguments":{"repo":"Hello-World","path":"README"}}</tool_call>', tools);
    expect(String(validateShamCall(p.calls[0], tools))).toMatch(/repo/);
  });
});

describe("a bare call after the model's own speaker label", () => {
  it.each(["شام: ", "Sham: ", "  شام：", ""])("%j{...} is a call", (label) => {
    const p = parseShamToolCalls(`${label}{"name": "sandbox_exec", "arguments": {"command": "python3 fib.py"}}`, tools);
    expect(p.calls.map((c) => c.function.name)).toEqual(["sandbox_exec"]);
    expect(p.text).toBe("");
  });
  it("words that merely start with the label stay words", () => {
    expect(parseShamToolCalls("شام: مرحباً بك", tools)).toEqual({ text: "شام: مرحباً بك", calls: [] });
  });
});

describe("results the model invents after its call are dropped", () => {
  it("only the call before the invented result is kept", () => {
    const t = 'شام: <tool_call>{"name": "sandbox_exec", "arguments": {"command": "python3 -m unittest stack.py"}}</tool_call>\nنتيجة الأداة sandbox_exec:\nOK\n\nشام: <tool_call>{"name": "ask_user", "arguments": {"question": "ناجح؟"}}</tool_call>';
    const p = parseShamToolCalls(t, tools);
    expect(p.calls.map((c) => c.function.name)).toEqual(["sandbox_exec"]);
    expect(p.text).not.toContain("OK");
  });
});

describe("python -m unittest file.py is turned into the module form that really runs tests", () => {
  it.each([
    ["python3 -m unittest stack.py", "python3 -m unittest stack"],
    ["python3 -m unittest -v tests/test_a.py", "python3 -m unittest -v tests.test_a"],
    ["python3 -m unittest discover", "python3 -m unittest discover"],
    ["python3 fib.py", "python3 fib.py"],
  ])("%s", (cmd, want) => expect((normaliseShamArgs({ command: cmd }) as any).command).toBe(want));
});

describe("a call cut off by the token limit is recognised as a broken call", () => {
  it("truncated JSON of a known tool", () => {
    expect(brokenCallAttempt('{"name": "sandbox_write_file", "arguments": {"path": "fib.py", "content": "def f():\\n    pri')).toBe(true);
    expect(brokenCallAttempt('{"name":"sandbox_exec"')).toBe(true);
    expect(brokenCallAttempt("مرحبا، كيف أساعدك؟")).toBe(false);
  });
});

describe("Sham v2 agent loop recovers from a tool error", () => {
  const call = '<tool_call>{"name":"github_read_file","arguments":{"repo":"o/r","path":"README.md"}}</tool_call>';
  it("tool says error + model answers with prose: the error goes back once and the retry runs", async () => {
    const seen: string[] = [], ran: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "اقرأ README", ctx, tools, budgetMs: 60000, maxSteps: 6,
      ask: script([say(call), say("عذراً، لم أجد الملف."), say('<tool_call>{"name":"github_list_files","arguments":{"repo":"o/r"}}</tool_call>'), say("الملفات: README")], seen),
      exec: async (c) => { ran.push(c.function.name); return c.function.name === "github_read_file" ? "error 404: Not Found" : "1 files\nREADME"; },
    }));
    expect(ran).toEqual(["github_read_file", "github_list_files"]);
    expect(seen.some((p) => p.includes("[تصحيح من المحرك]") && p.includes("أعادت خطأً"))).toBe(true);
    expect((r as any).text).toMatch(/README/);
  });
  it("at most twice: then the prose is the answer", async () => {
    const seen: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "اقرأ", ctx, tools, budgetMs: 60000, maxSteps: 6,
      ask: script([say(call), say("لا أستطيع."), say("ما زلت لا أستطيع."), say("لا أستطيع أبداً.")], seen),
      exec: async () => "error 500: boom",
    }));
    expect(seen.filter((p) => p.includes("أعادت خطأً")).length).toBeLessThanOrEqual(2);
    expect(r.kind).toBe("text");
  });
  it("v1 (the 384-token body) keeps its short conversation window: long tool results are clipped harder", async () => {
    const seen: string[] = [];
    const big = "x".repeat(5000);
    for (const v of ["v1", "v2"] as const) {
      await shamVariant.run(v, () => shamAgentRun({
        text: "ابحث", ctx, tools, budgetMs: 60000, maxSteps: 3,
        ask: script([say('<tool_call>{"name":"web_search","arguments":{"query":"a"}}</tool_call>'), say("تم.")], seen), exec: async () => big,
      }));
    }
    const lenV1 = seen[1].length, lenV2 = seen[3].length;
    expect(lenV2).toBeGreaterThan(lenV1);
  });
});

describe("the Sham v2 Studio exposes its own structured agent protocol", () => {
  const src = readFileSync(join(__dirname, "../../../scripts/transplant/stage_sham_v2_studio.py"), "utf8");
  const app = readFileSync(join(__dirname, "../../../ai-system/modelscope-sham/app.py"), "utf8");
  it("opens the larger v2 prompt/token limits and enables the structured endpoint only in the v2 wrapper", () => {
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_LIMITS", "open"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_GENERATE_ANY_MAX_TOKENS", "768"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_NATIVE_TOOL_CALLS", "1"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_TOOLCALL_GUARD", "1"\)/);
    expect(src).toContain("أنت شام v2، وهويتك ثابتة");
    expect(src).toContain("لا تسمِّ نفسك نوفا في أي حال");
  });
  it("publishes the typed agent_step API only when the dedicated v2 Studio flag is enabled", () => {
    expect(app).toMatch(/def agent_step\(/);
    expect(app).toMatch(/api_name="agent_step"/);
    expect(app).toMatch(/_V2 and os\.environ\.get\("SHAM_NATIVE_TOOL_CALLS", ""\)\.strip\(\) == "1"/);
    expect(app).toMatch(/"type": "tool_calls"/);
  });
});

describe("tool block hints", () => {
  const { shamToolBlock } = require("@/lib/shamTools");
  it("v2 gets the owner/name and unittest hints; v1's block is unchanged", () => {
    const a = shamVariant.run("v2", () => shamToolBlock(tools)), b = shamVariant.run("v1", () => shamToolBlock(tools));
    expect(a).toContain('owner/name'); expect(a).toContain("unittest");
    expect(b).not.toContain("unittest");
  });
});
