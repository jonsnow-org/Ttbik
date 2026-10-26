import { SHAM_TOOL_NAMES, shamAgentRun, shamToolDefs, type ShamAsk } from "@/lib/shamAgent";
import type { ToolCtx } from "@/lib/coderAgent";

const ctx = { gh: null, addNote: () => undefined } as unknown as ToolCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say> | { type: "image"; b64: string } | null>, seen: string[] = []): ShamAsk => async (prompt) => { seen.push(prompt); return (answers.shift() ?? null) as any; };

describe("Sham's own agent loop", () => {
  it("its own tool list: web, GitHub reading (only when the chat can read it), memory, schedules, ask_user; no sandbox yet", () => {
    const withGh = shamToolDefs(true).map((t) => t.function.name), without = shamToolDefs(false).map((t) => t.function.name);
    expect(withGh).toEqual(expect.arrayContaining(["web_search", "github_read_file", "memory_save", "schedule_create", "ask_user"]));
    expect(without).not.toContain("github_read_file");
    expect(withGh.every((n) => (SHAM_TOOL_NAMES as readonly string[]).includes(n))).toBe(true);
    expect(withGh.some((n) => n.startsWith("sandbox_"))).toBe(false);
  });
  it("calls a tool, reads its result, and answers from it", async () => {
    const tools = shamToolDefs(false), seen: string[] = [], ran: string[] = [];
    const r = await shamAgentRun({ text: "ابحث عن الطقس", ctx, tools, budgetMs: 60000,
      ask: script([say('<tool_call>{"name":"web_search","arguments":{"query":"الطقس"}}</tool_call>'), say("الطقس مشمس حسب البحث.")], seen),
      exec: async (c) => { ran.push(c.function.name); return "نتائج: مشمس 30 درجة"; } });
    expect(r).toMatchObject({ kind: "text", text: "الطقس مشمس حسب البحث.", used: ["web_search"] });
    expect(ran).toEqual(["web_search"]);
    expect(seen[1]).toMatch(/نتيجة الأداة web_search:\nنتائج: مشمس/);                    // the second step shows Sham the result
  });
  it("a wrong call goes back with the reason and the corrected one runs", async () => {
    const tools = shamToolDefs(false), seen: string[] = [], ran: any[] = [];
    const r = await shamAgentRun({ text: "ابحث", ctx, tools, budgetMs: 60000,
      ask: script([say('<tool_call>{"name":"web_search","arguments":{}}</tool_call>'), say('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>'), say("تم.")], seen),
      exec: async (c) => { ran.push(JSON.parse(c.function.arguments)); return "ok"; } });
    expect(seen[1]).toMatch(/تصحيح من المحرك[\s\S]*«query» ناقص/);
    expect(ran).toEqual([{ query: "x" }]);
    expect(r.kind).toBe("text");
  });
  it("ask_user ends the round with the question; a picture reply is handed back; no answer in time is 'none'", async () => {
    const tools = shamToolDefs(false);
    const a = await shamAgentRun({ text: "صلّح الأخطاء", ctx, tools, budgetMs: 60000, ask: script([say('<tool_call>{"name":"ask_user","arguments":{"question":"أي مستودع؟"}}</tool_call>')]) });
    expect(a).toMatchObject({ kind: "ask", question: "أي مستودع؟" });
    const b = await shamAgentRun({ text: "ارسم قطة", ctx, tools, budgetMs: 60000, ask: script([{ type: "image", b64: "AAAA" }]) });
    expect(b.kind).toBe("reply");
    const c = await shamAgentRun({ text: "مرحبا", ctx, tools, budgetMs: 60000, ask: script([null]) });
    expect(c.kind).toBe("none");
  });
  it("stops at the step limit and asks for the final answer without tools", async () => {
    const tools = shamToolDefs(false), seen: string[] = [];
    const call = say('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>');
    const r = await shamAgentRun({ text: "ابحث", ctx, tools, budgetMs: 60000, maxSteps: 2, ask: script([call, call, say("الجواب النهائي من النتائج.")], seen), exec: async () => "نتيجة" });
    expect(r).toMatchObject({ kind: "text", text: "الجواب النهائي من النتائج." });
    expect(seen[2]).toMatch(/اكتب الجواب النهائي الآن/);
    expect(seen[2]).not.toMatch(/الأدوات المتاحة لك/);                                    // no tools shown for the last answer
  });
});
