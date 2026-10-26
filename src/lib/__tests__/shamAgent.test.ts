import { SHAM_TOOL_NAMES, shamAgentRun, shamToolDefs, type ShamAsk } from "@/lib/shamAgent";
import { shamConfirmText, shamRunTool, shamSavePending, shamTakePending, type ShamCtx } from "@/lib/shamExec";

const ctx = { chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: null, chatKey: "sham:1", runId: "sham-1", owner: true } as unknown as ShamCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say> | { type: "image"; b64: string } | null>, seen: string[] = []): ShamAsk => async (prompt) => { seen.push(prompt); return (answers.shift() ?? null) as any; };

describe("Sham's own agent loop", () => {
  it("its own tool list: web, GitHub reading (only when the chat can read it), memory, schedules, ask_user; the VM tools", () => {
    const withGh = shamToolDefs(true).map((t) => t.function.name), without = shamToolDefs(false).map((t) => t.function.name);
    expect(withGh).toEqual(expect.arrayContaining(["web_search", "github_read_file", "memory_save", "schedule_create", "ask_user"]));
    expect(without).not.toContain("github_read_file");
    expect(withGh.every((n) => (SHAM_TOOL_NAMES as readonly string[]).includes(n))).toBe(true);
    expect(without).not.toContain("sandbox_push");                                       // pushing needs a linked GitHub
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
  it("Sham has its own virtual computer tools, and its VM is never Nova's (own chat key)", async () => {
    const names = shamToolDefs(false).map((t) => t.function.name);
    for (const n of ["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_edit_file", "sandbox_search", "sandbox_read_file"]) expect(names).toContain(n);
    expect(names).not.toContain("sandbox_push");
    const { shamToolCtx } = await import("@/lib/shamAgent");
    const c = await shamToolCtx(42, "b", { exec: async () => undefined, query: async () => [] } as any);
    expect(c.chatKey).toMatch(/^sham:/);
    expect(c.runId).toBe("sham-42");
  });
  it("a push / PR / merge never runs on Sham's word: the round ends with 'confirm', and the tool refuses without the tap", async () => {
    const tools = shamToolDefs(true);
    const ran: string[] = [];
    const r = await shamAgentRun({ text: "ارفع التعديلات", ctx, tools, budgetMs: 60000, exec: async (c) => { ran.push(c.function.name); return "ok"; },
      ask: script([say('<tool_call>{"name":"sandbox_push","arguments":{"repo":"o/r","branch":"fix/x","message":"fix"}}</tool_call>')]) });
    expect(r).toMatchObject({ kind: "confirm" });
    expect(ran).toEqual([]);
    expect((r as any).call.function.name).toBe("sandbox_push");
    expect(shamConfirmText((r as any).call)).toMatch(/fix\/x[\s\S]*هل أسمح/);
    const call = { id: "1", type: "function", function: { name: "github_merge_pr", arguments: '{"repo":"o/r","number":3}' } } as any;
    expect(await shamRunTool(call, ctx)).toMatch(/only after the user taps/);
  });
  it("the pending write is kept for the asking chat only, taken once", async () => {
    const rows: any[] = [];
    const db: any = { exec: async (sql: string, ...a: any[]) => { if (/INSERT/.test(sql)) rows.push({ id: a[0], chat: a[1], call: a[2] }); }, query: async (sql: string, ...a: any[]) => { const i = rows.findIndex((x) => x.id === a[0] && x.chat === a[1]); return i < 0 ? [] : rows.splice(i, 1); } };
    const call = { id: "1", type: "function", function: { name: "github_create_pr", arguments: "{}" } } as any;
    const id = await shamSavePending(7, call, db);
    expect(await shamTakePending(8, id, db)).toBeNull();                                 // another chat cannot approve it
    expect((await shamTakePending(7, id, db))?.function.name).toBe("github_create_pr");
    expect(await shamTakePending(7, id, db)).toBeNull();                                 // once only
  });
  it("make_media is Sham's own: the picture comes back as a reply, no Nova media Studio", async () => {
    const tools = shamToolDefs(false);
    const r = await shamAgentRun({ text: "ارسم قطة", ctx, tools, budgetMs: 60000, media: async (k, p) => ({ type: "image", b64: "AAAA", text: `${k}:${p}` }) as any,
      ask: script([say('<tool_call>{"name":"make_media","arguments":{"kind":"image","prompt":"قطة"}}</tool_call>')]) });
    expect(r).toMatchObject({ kind: "reply", reply: { type: "image" } });
  });
});
