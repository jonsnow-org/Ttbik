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

describe("streaming is v2-only: v1 chat still answers when onDelta is given", () => {
  it("v1 never asks the v2-only stream endpoint; v2 does", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    process.env.SHAM_V2_OVERFLOW_URL = "off";
    const real = global.fetch;
    const encoder = new TextEncoder();
    const calls: string[] = [];
    // The real endpoint yields decoded text pieces (the Gradio wrapper sends each as `data: ["piece"]`).
    const stream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: generating\ndata: ["مرحبا"]\n'));
        controller.enqueue(encoder.encode('data: [" بك"]\n'));
        controller.enqueue(encoder.encode("event: complete\ndata: null\n"));
        controller.close();
      },
    });
    global.fetch = (async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/call/v2/")) return { ok: true, status: 200, json: async () => ({ event_id: "e1" }) } as any;
      return { ok: true, status: 200, body: stream(), text: async () => "" } as any;
    }) as any;
    try {
      const seen: Record<string, string[]> = { v1: [], v2: [] };
      for (const v of ["v1", "v2"] as const) {
        calls.length = 0;
        await shamVariant.run(v, () => shamAgentRun({
          text: "مرحبا", ctx, tools, budgetMs: 30000, maxSteps: 1, onDelta: (t) => seen[v].push(t),
        }));
        expect(calls.some((u) => u.includes("generate_chat_stream"))).toBe(v === "v2");
      }
      // Only the streamed path hands pieces over as the model writes them.
      expect(seen.v2.length).toBeGreaterThan(0);
      expect(seen.v1).toEqual([]);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
      delete process.env.SHAM_V2_OVERFLOW_URL;
    }
  });
});

describe("the Sham v2 Studio exposes native chat and structured agent APIs", () => {
  const src = readFileSync(join(__dirname, "../../../scripts/transplant/stage_sham_v2_studio.py"), "utf8");
  const app = readFileSync(join(__dirname, "../../../ai-system/modelscope-sham/app.py"), "utf8");
  const chat = readFileSync(join(__dirname, "../../../ai-system/colab/sham_small/sham_studio_chat.py"), "utf8");
  const model = readFileSync(join(__dirname, "../../../ai-system/colab/sham_small/model.py"), "utf8");
  const train = readFileSync(join(__dirname, "../../../ai-system/colab/sham_small/sham_v2_train.py"), "utf8");
  const agentSource = readFileSync(join(__dirname, "../shamAgent.ts"), "utf8");
  const botLogic = readFileSync(join(__dirname, "../novaBotLogic.ts"), "utf8");
  it("raises context and generation limits without installing an identity system prompt", () => {
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_LIMITS", "open"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_MAX_SEQ_LEN", "4096"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_MAX_PROMPT_TOKENS", "3072"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_GENERATE_ANY_MAX_TOKENS", "768"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_GENERATE_CHAT_MAX_TOKENS", "1024"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_NATIVE_TOOL_CALLS", "1"\)/);
    expect(src).toMatch(/os\.environ\.setdefault\("SHAM_TOOLCALL_GUARD", "1"\)/);
    expect(src).not.toContain("SHAM_QWEN3_SYSTEM");
    expect(app).toMatch(/SHAM_MAX_SEQ_LEN/);
    expect(chat).toMatch(/def qwen3_chat_messages\(/);
    expect(chat).not.toContain("QWEN3_SYSTEM");
    expect(model).toMatch(/class AdapterLinear\(/);
    expect(model).toMatch(/def enable_adapters\(/);
    expect(model).toMatch(/def resize_max_seq_len\(/);
    expect(train).toMatch(/SHAM_V2_ADAPTER_RANK/);
    expect(train).toMatch(/name\.endswith\("\.adapter_up"\)/);
    expect(train).toContain("media_batch = batch_examples");
    expect(train).toMatch(/def identity_grounding_pairs\(/);
    expect(agentSource).toContain("shamGenerateChat(chatMessages");
    expect(agentSource).not.toContain("لا تكرر السؤال");
    expect(agentSource).not.toContain("isQuestionEcho");
    expect(agentSource).not.toContain("SHAM_QWEN3_SYSTEM");
    expect(botLogic).toMatch(/const SHAM_V2_LEGS = 12/);
    expect(botLogic).toMatch(/run\.variant === "v2" \? SHAM_V2_LEGS : SHAM_LEGS/);
    expect(botLogic).toContain("budgetMs: v2 ? (detailedReply ? 170000 : 125000)");
  });
  it("publishes native generate_chat independently of the structured tools flag", () => {
    expect(app).toMatch(/def generate_chat\(/);
    expect(app).toMatch(/api_name="generate_chat"/);
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
