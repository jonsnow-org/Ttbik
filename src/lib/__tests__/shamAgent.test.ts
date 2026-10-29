import { SHAM_TOOL_NAMES, shamAgentRun, shamToolDefs, type ShamAsk } from "@/lib/shamAgent";
import { shamConfirmText, shamRunTool, shamSavePending, shamTakePending, type ShamCtx } from "@/lib/shamExec";
import { DEFAULT_URL, DEFAULT_V2_URL, shamBases, shamVariant } from "@/lib/shamStudio";

const ctx = { chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: null, chatKey: "sham:1", runId: "sham-1", owner: true } as unknown as ShamCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say> | { type: "image"; b64: string } | null>, seen: string[] = []): ShamAsk => async (prompt) => { seen.push(prompt); return (answers.shift() ?? null) as any; };
const runV1 = (opts: Parameters<typeof shamAgentRun>[0]) => shamVariant.run("v1", () => shamAgentRun(opts));

describe("Sham's own agent loop", () => {
  it("keeps v1 and v2 on their separate ModelScope Studio routes", () => {
    const v1 = shamVariant.run("v1", () => shamBases());
    const v2 = shamVariant.run("v2", () => shamBases());
    expect(DEFAULT_URL).toContain("sham-v1");
    expect(DEFAULT_V2_URL).toContain("sham-v2");
    expect(v1.every((url) => /sham-v1/i.test(url) && !/sham-v2|nova-inference-server|coder-inference/i.test(url))).toBe(true);
    expect(v2.every((url) => !/sham-v1|coder-inference|nova-inference-server/i.test(url))).toBe(true);
  });

  it.each([
    "من أنت؟",
    "أنت شام أم نوفا؟",
    "هل أنت Nova؟",
    "Who are you?",
    "Are you Sham or Nova?",
  ])("lets the Sham v2 model generate its own identity answer for %j", async (question) => {
    const seen: string[] = [];
    const generated = "أنا شام v2، مساعد مستقل. نوفا نظام منفصل.";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question,
      ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(generated)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: generated });
    expect(seen).toHaveLength(1); // the model generated the answer; no pre-model shortcut
    expect(seen[0]).toContain(question);
    expect(seen[0]).not.toContain("لا تخلط بين شام ونوفا"); // route isolation, not a prompt-side identity correction
    expect(seen[0]).not.toContain("أنا شام v2، المساعد الذي تتحدث معه هنا"); // no canned reply is embedded in the application
  });

  it("does not change the old Sham v1 identity path", async () => {
    const seen: string[] = [];
    const oldAnswer = "جواب اختبار شام القديم";
    const r = await shamVariant.run("v1", () => shamAgentRun({
      text: "من أنت؟", ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(oldAnswer)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: oldAnswer });
    expect(seen).toHaveLength(1);
  });

  it("Sham v2 passes ordinary user text unchanged to its direct chat path", async () => {
    const seen: string[] = [];
    const question = "ما الذي تتقنه وتستطيع القيام به؟";
    const answer = "أستطيع مساعدتك في الشرح والبرمجة والبحث وتنظيم الأفكار.";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(answer)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: answer });
    expect(seen).toEqual([question]);
  });

  it("Sham v2 resumes a timed-out direct chat without adding prompt instructions", async () => {
    const seen: string[] = [];
    const question = "ماذا تفعل؟";
    const first = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 50000, askMs: 44000, continuable: true,
      ask: script([null], seen),
    }));
    expect(first.kind).toBe("more");
    const savedMessages = (first as any).messages;
    expect(savedMessages[savedMessages.length - 1]).toMatchObject({ role: "user", content: question });

    const resumed = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 230000, askMs: 150000, continuable: true,
      resume: savedMessages,
      ask: script([say("أجيب عن الأسئلة وأساعد في الشرح والبرمجة.")], seen),
    }));
    expect(resumed).toMatchObject({ kind: "text", text: "أجيب عن الأسئلة وأساعد في الشرح والبرمجة." });
    expect(seen).toEqual([question, question]);
  });

  it("Sham v2 keeps technical capability questions on ordinary chat", async () => {
    const seen: string[] = [];
    const question = "هل لديك خبرة في الكود";
    const answer = "نعم، أستطيع شرح الكود ومساعدتك في كتابته وتصحيح أخطائه.";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(answer)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: answer });
    expect(seen).toEqual([question]);
  });

  it("routes a capability question about a named GitHub repository through Sham's own tools", async () => {
    const agentPrompts: string[] = [], directSeen: string[] = [], ran: string[] = [];
    const answers: any[] = [
      {
        type: "tool_calls",
        text: "",
        tool_calls: [{
          id: "call_repo_scan",
          type: "function",
          function: { name: "github_repo_scan", arguments: JSON.stringify({ repo: "jonsnow-org/Ttbik" }) },
        }],
      },
      say("قرأت معلومات المستودع من نتيجة الأداة."),
    ];
    const question = "هل لديك معرفة وقدرة على تحليل مستودع GitHub jonsnow-org/Ttbik؟";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question,
      ctx,
      tools: shamToolDefs(true),
      budgetMs: 60000,
      maxSteps: 4,
      ask: script([say("جواب عام عن القدرات")], directSeen),
      agentAsk: async (prompt) => { agentPrompts.push(prompt); return answers.shift() ?? null; },
      exec: async (call) => { ran.push(call.function.name); return "default branch main; README.md; src/"; },
    }));
    expect(r).toMatchObject({ kind: "text", text: "قرأت معلومات المستودع من نتيجة الأداة.", used: ["github_repo_scan"] });
    expect(agentPrompts).toHaveLength(2);
    expect(ran).toEqual(["github_repo_scan"]);
    expect(directSeen).toHaveLength(0);
  });

  it("Sham v2 passes model-authored identity text through unchanged", async () => {
    const seen: string[] = [];
    const question = "من أنت؟";
    const generated = "أنا نوفا، مساعد مستقل ضمن تطبيق شام.";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(generated)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: generated });
    expect(seen).toEqual([question]);
  });

  it("Sham v2 does not automatically reject or retry an echoed answer", async () => {
    const seen: string[] = [];
    const question = "هل لديك خبرة في الكود";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: question, ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(question)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: question });
    expect(seen).toEqual([question]);
  });

  it("its own tool list: web, GitHub reading (only when the chat can read it), memory, schedules, ask_user; the VM tools", () => {
    const withGh = shamToolDefs(true).map((t) => t.function.name), without = shamToolDefs(false).map((t) => t.function.name);
    expect(withGh).toEqual(expect.arrayContaining(["web_search", "github_read_file", "memory_save", "schedule_create", "ask_user"]));
    expect(without).not.toContain("github_read_file");
    expect(withGh.every((n) => (SHAM_TOOL_NAMES as readonly string[]).includes(n))).toBe(true);
    expect(without).not.toContain("sandbox_push");                                       // pushing needs a linked GitHub
  });
  it("calls a tool, reads its result, and answers from it", async () => {
    const tools = shamToolDefs(false), seen: string[] = [], ran: string[] = [];
    const r = await runV1({ text: "ابحث عن الطقس", ctx, tools, budgetMs: 60000,
      ask: script([say('<tool_call>{"name":"web_search","arguments":{"query":"الطقس"}}</tool_call>'), say("الطقس مشمس حسب البحث.")], seen),
      exec: async (c) => { ran.push(c.function.name); return "نتائج: مشمس 30 درجة"; } });
    expect(r).toMatchObject({ kind: "text", text: "الطقس مشمس حسب البحث.", used: ["web_search"] });
    expect(ran).toEqual(["web_search"]);
    expect(seen[1]).toMatch(/نتيجة الأداة web_search:\nنتائج: مشمس/);                    // the second step shows Sham the result
  });
  it("Sham v2 consumes structured function calls without parsing a tool-call tag in the web app", async () => {
    const seen: string[] = [], ran: string[] = [];
    const answers: any[] = [
      {
        type: "tool_calls",
        text: "",
        tool_calls: [{
          id: "call_test_1",
          type: "function",
          function: { name: "web_search", arguments: JSON.stringify({ query: "weather" }) },
        }],
      },
      say("وجدت نتائج الطقس في مخرجات البحث."),
    ];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "ابحث عن الطقس الآن", ctx, tools: shamToolDefs(false), budgetMs: 60000, maxSteps: 4,
      agentAsk: async (prompt) => { seen.push(prompt); return answers.shift() ?? null; },
      exec: async (call) => { ran.push(call.function.name); return "نتيجة بحث حقيقية: الجو مشمس."; },
    }));
    expect(r).toMatchObject({ kind: "text", text: "وجدت نتائج الطقس في مخرجات البحث.", used: ["web_search"] });
    expect(ran).toEqual(["web_search"]);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/نتيجة الأداة web_search:\nنتيجة بحث حقيقية/);
  });

  it("verifies the final answer against executed tool results before returning it", async () => {
    const seen: string[] = [], verifyPrompts: string[] = [], ran: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "ابحث ثم لخّص النتيجة",
      ctx,
      tools: shamToolDefs(false),
      budgetMs: 60000,
      maxSteps: 4,
      ask: script([
        say('<tool_call>{"name":"web_search","arguments":{"query":"test topic"}}</tool_call>'),
        say("النتيجة تقول إن المعلومة مؤكدة."),
      ], seen),
      verifyAsk: async (prompt) => {
        verifyPrompts.push(prompt);
        return say("بعد التحقق: نتيجة الأداة تؤكد المعلومة المطلوبة.");
      },
      exec: async (call) => { ran.push(call.function.name); return "نتيجة الأداة: المعلومة مؤكدة."; },
    }));
    expect(r).toMatchObject({ kind: "text", text: "بعد التحقق: نتيجة الأداة تؤكد المعلومة المطلوبة.", used: ["web_search"] });
    expect(ran).toEqual(["web_search"]);
    expect(verifyPrompts).toHaveLength(1);
    expect(verifyPrompts[0]).toContain("مرحلة التحقق");
    expect(verifyPrompts[0]).toContain("نتيجة الأداة: المعلومة مؤكدة.");
  });

  it("a wrong call goes back with the reason and the corrected one runs", async () => {
    const tools = shamToolDefs(false), seen: string[] = [], ran: any[] = [];
    const r = await runV1({ text: "ابحث", ctx, tools, budgetMs: 60000,
      ask: script([say('<tool_call>{"name":"web_search","arguments":{}}</tool_call>'), say('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>'), say("تم.")], seen),
      exec: async (c) => { ran.push(JSON.parse(c.function.arguments)); return "ok"; } });
    expect(seen[1]).toMatch(/تصحيح من المحرك[\s\S]*«query» ناقص/);
    expect(ran).toEqual([{ query: "x" }]);
    expect(r.kind).toBe("text");
  });
  it("ask_user ends the round with the question; a picture reply is handed back; no answer in time is 'none'", async () => {
    const tools = shamToolDefs(false);
    const a = await runV1({ text: "صلّح الأخطاء", ctx, tools, budgetMs: 60000, ask: script([say('<tool_call>{"name":"ask_user","arguments":{"question":"أي مستودع؟"}}</tool_call>')]) });
    expect(a).toMatchObject({ kind: "ask", question: "أي مستودع؟" });
    const b = await runV1({ text: "ارسم قطة", ctx, tools, budgetMs: 60000, ask: script([{ type: "image", b64: "AAAA" }]) });
    expect(b.kind).toBe("reply");
    const c = await runV1({ text: "مرحبا", ctx, tools, budgetMs: 60000, ask: script([null]) });
    expect(c.kind).toBe("none");
  });
  it("stops at the step limit and asks for the final answer without tools", async () => {
    const tools = shamToolDefs(false), seen: string[] = [];
    const call = say('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>');
    const r = await runV1({ text: "ابحث", ctx, tools, budgetMs: 60000, maxSteps: 2, ask: script([call, call, say("الجواب النهائي من النتائج.")], seen), exec: async () => "نتيجة" });
    expect(r).toMatchObject({ kind: "text", text: "الجواب النهائي من النتائج." });
    expect(seen[2]).toMatch(/اكتب الجواب النهائي الآن/);
    expect(seen[2]).not.toMatch(/الأدوات المتاحة لك/);                                    // no tools shown for the last answer
  });
  it("Sham has its own virtual computer tools, and its VM is never Nova's (own chat key)", async () => {
    const names = shamToolDefs(false).map((t) => t.function.name);
    for (const n of ["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_edit_file", "sandbox_search", "sandbox_read_file"]) expect(names).toContain(n);
    expect(names).not.toContain("sandbox_push");
    const { shamToolCtx } = await import("@/lib/shamAgent");
    const c = await shamVariant.run("v1", () => shamToolCtx(42, "b", { exec: async () => undefined, query: async () => [] } as any));
    expect(c.chatKey).toMatch(/^sham:/);
    expect(c.chatKey).toContain(":v1");
    expect(c.runId).toBe("sham-42-v1");
  });
  it("a push / PR / merge never runs on Sham's word: the round ends with 'confirm', and the tool refuses without the tap", async () => {
    const tools = shamToolDefs(true);
    const ran: string[] = [];
    const r = await runV1({ text: "ارفع التعديلات", ctx, tools, budgetMs: 60000, exec: async (c) => { ran.push(c.function.name); return "ok"; },
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
    const r = await runV1({ text: "ارسم قطة", ctx, tools, budgetMs: 60000, media: async (k, p) => ({ type: "image", b64: "AAAA", text: `${k}:${p}` }) as any,
      ask: script([say('<tool_call>{"name":"make_media","arguments":{"kind":"image","prompt":"قطة"}}</tool_call>')]) });
    expect(r).toMatchObject({ kind: "reply", reply: { type: "image" } });
  });
  it("passes requested video scenes and narration through make_media", async () => {
    const tools = shamToolDefs(false);
    const calls: unknown[] = [];
    const r = await runV1({
      text: "اصنع فيديو لأرنب",
      ctx,
      tools,
      budgetMs: 60000,
      media: async (kind, prompt, opts) => {
        calls.push({ kind, prompt, opts });
        return { type: "video", b64: "AAAA", route: "sham_v2" } as any;
      },
      ask: script([say('<tool_call>{"name":"make_media","arguments":{"kind":"video","prompt":"أرنب في حديقة","scenes":["لقطة واسعة","لقطة قريبة"],"narration":"الأرنب يقفز"}}</tool_call>')]),
    });
    expect(r).toMatchObject({ kind: "reply", reply: { type: "video", route: "sham_v2" } });
    expect(calls).toEqual([{
      kind: "video",
      prompt: "أرنب في حديقة",
      opts: { scenes: ["لقطة واسعة", "لقطة قريبة"], narration: "الأرنب يقفز" },
    }]);
  });
  it("a long task hands over to the next leg with its conversation, and the next leg goes on from there", async () => {
    const tools = shamToolDefs(false);
    const call = say('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>');
    const a = await runV1({ text: "ابحث بعمق", ctx, tools, budgetMs: 60000, maxSteps: 2, continuable: true, ask: script([call, call]), exec: async () => "نتيجة" });
    expect(a.kind).toBe("more");
    const msgs = (a as any).messages;
    expect(msgs.filter((m: any) => m.role === "tool")).toHaveLength(2);
    const seen: string[] = [];
    const b = await runV1({ text: "ابحث بعمق", ctx, tools, budgetMs: 60000, resume: msgs, ask: script([say("الجواب النهائي.")], seen), exec: async () => "نتيجة" });
    expect(b).toMatchObject({ kind: "text", text: "الجواب النهائي." });
    expect(seen[0]).toMatch(/نتيجة الأداة web_search/);                                    // the earlier legs' results are in front of Sham
    const last = await runV1({ text: "ابحث", ctx, tools, budgetMs: 60000, maxSteps: 2, continuable: false, ask: script([call, call, say("خلاصة.")]), exec: async () => "نتيجة" });
    expect(last).toMatchObject({ kind: "text", text: "خلاصة." });                         // the last leg answers instead of handing over
  });
  it("ignores only a Telegram retry of the same update, not a new message", async () => {
    const { shamClaimUpdate } = await import("@/lib/shamExec");
    const seen = new Set<string>();
    const db: any = {
      exec: async () => {},
      query: async (sql: string, chatId: number, updateId: number) => {
        if (!/INSERT INTO sham_seen/.test(sql)) return [];
        const key = chatId + ":" + updateId;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ update_id: String(updateId) }];
      },
    };
    expect(await shamClaimUpdate(5, 120, db)).toBe(true);
    expect(await shamClaimUpdate(5, 120, db)).toBe(false);
    expect(await shamClaimUpdate(5, 121, db)).toBe(true);
    expect(await shamClaimUpdate(6, 120, db)).toBe(true);
  });
  it("a saved task is kept per task (not per chat) and taken once", async () => {
    const { shamSaveRun, shamTakeRun } = await import("@/lib/shamExec");
    const rows = new Map<string, string>();
    const db: any = { exec: async (sql: string, ...a: any[]) => { if (/INSERT INTO sham_runs2/.test(sql)) rows.set(a[0], a[2]); }, query: async (_s: string, runId: string) => { const v = rows.get(runId); rows.delete(runId); return v ? [{ data: v }] : []; } };
    await shamSaveRun({ chatId: 5, botId: "b", runId: "r1", request: "طلب", messages: [{ role: "user", content: "طلب" }], leg: 1, variant: "v2", mode: {} }, db);
    await shamSaveRun({ chatId: 5, botId: "b", runId: "r2", request: "آخر", messages: [], leg: 1, variant: "v2", mode: {} }, db);       // a second task of the same chat lives beside the first
    expect((await shamTakeRun(5, "r1", db))?.request).toBe("طلب");
    expect(await shamTakeRun(5, "r1", db)).toBeNull();
    expect((await shamTakeRun(5, "r2", db))?.request).toBe("آخر");
  });
});

describe("a picture goes to the background leg, which waits long", () => {
  it("inside the webhook budget make_media hands over; the next leg runs it without asking the model again", async () => {
    const tools = shamToolDefs(false);
    const call = say('<tool_call>{"name":"make_media","arguments":{"kind":"image","prompt":"أرنب يلعب"}}</tool_call>');
    const a = await runV1({ text: "ارسم أرنباً", ctx, tools, budgetMs: 50000, continuable: true, ask: script([call]), media: async () => { throw new Error("must not run in the short leg"); } });
    expect(a.kind).toBe("more");
    const got: string[] = [];
    const asks: string[] = [];
    const b = await runV1({ text: "ارسم أرنباً", ctx, tools, budgetMs: 230000, resume: (a as any).messages, ask: script([], asks), media: async (k, p) => { got.push(`${k}:${p}`); return { type: "image", b64: "AAAA" } as any; } });
    expect(b).toMatchObject({ kind: "reply", reply: { type: "image" } });
    expect(got).toEqual(["image:أرنب يلعب"]);
    expect(asks).toEqual([]);                                                   // the model is not asked again
  });
});
