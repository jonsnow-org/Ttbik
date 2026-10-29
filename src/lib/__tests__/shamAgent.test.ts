import { SHAM_TOOL_NAMES, shamAgentRun, shamToolDefs, type ShamAsk } from "@/lib/shamAgent";
import { shamConfirmText, shamRunTool, shamSavePending, shamTakePending, type ShamCtx } from "@/lib/shamExec";
import { DEFAULT_URL, DEFAULT_V2_URL, shamBases, shamVariant } from "@/lib/shamStudio";

const ctx = { chatId: 1, db: { exec: async () => undefined, query: async () => [] }, githubToken: null, chatKey: "sham:1", runId: "sham-1", owner: true } as unknown as ShamCtx;
const say = (text: string) => ({ type: "text" as const, text });
const script = (answers: Array<ReturnType<typeof say> | { type: "image"; b64: string } | null>, seen: string[] = []): ShamAsk => async (prompt) => { seen.push(prompt); return (answers.shift() ?? null) as any; };

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

  it("Sham v2 sends ordinary conversation as a direct chat prompt without the serialized tool transcript", async () => {
    const seen: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "ما الذي تتقنه وتستطيع القيام به؟", ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say("أستطيع مساعدتك في الشرح والبرمجة والبحث وتنظيم الأفكار.")], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: "أستطيع مساعدتك في الشرح والبرمجة والبحث وتنظيم الأفكار." });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("رسالة المستخدم الحالية:");
    expect(seen[0]).toContain("لا تكرر السؤال");
    expect(seen[0]).not.toContain("الأدوات المتاحة لك");
    expect(seen[0]).not.toContain("شام:");
  });
  it("Sham v2 retries a timed-out ordinary chat on the direct route during background continuation", async () => {
    const seen: string[] = [];
    const text = "ماذا تفعل؟";
    const first = await shamVariant.run("v2", () => shamAgentRun({
      text, ctx, tools: shamToolDefs(false), budgetMs: 50000, askMs: 44000, continuable: true,
      ask: script([null], seen),
    }));
    expect(first.kind).toBe("more");
    const savedMessages = (first as any).messages;
    expect(savedMessages[savedMessages.length - 1]).toMatchObject({ role: "user", content: text });

    const resumed = await shamVariant.run("v2", () => shamAgentRun({
      text, ctx, tools: shamToolDefs(false), budgetMs: 230000, askMs: 150000, continuable: true,
      resume: savedMessages,
      ask: script([say("أساعدك في الإجابة عن الأسئلة وشرح المواضيع وإنجاز المهام.")], seen),
    }));
    expect(resumed).toMatchObject({ kind: "text", text: "أساعدك في الإجابة عن الأسئلة وشرح المواضيع وإنجاز المهام." });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("رسالة المستخدم الحالية:");
    expect(seen[1]).toContain("رسالة المستخدم الحالية:");
    expect(seen[1]).not.toContain("الأدوات المتاحة لك");
    expect(seen[1]).not.toContain("شام:");
  });

  it("Sham v2 keeps technical capability questions in direct chat instead of the code-agent path", async () => {
    const seen: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "هل لديك خبرة في الكود", ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say("نعم، أستطيع شرح الكود ومساعدتك في كتابته وتصحيح أخطائه.")], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: "نعم، أستطيع شرح الكود ومساعدتك في كتابته وتصحيح أخطائه." });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("رسالة المستخدم الحالية:");
    expect(seen[0]).not.toContain("الأدوات المتاحة لك");
  });
  it("Sham v2 includes this user's active tool inventory and retries a generic answer", async () => {
    const seen: string[] = [];
    const activeTools = [
      { type: "function", function: { name: "web_search", description: "Search the public web", parameters: { type: "object", properties: {}, required: [] } } },
      { type: "function", function: { name: "github_read_file", description: "Read a file from an authorized repository", parameters: { type: "object", properties: {}, required: [] } } },
    ] as any;
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "ما هي الأدوات المتاحة لديك والتي تستطيع استدعاءها؟",
      ctx, tools: activeTools, budgetMs: 30000,
      ask: script([
        say("أنا شام، مساعد ذكي صنعه فريقنا."),
        say("الأدوات المتاحة هنا: web_search للبحث في الويب و github_read_file لقراءة ملف مستودع مصرح به."),
      ], seen),
    }));
    expect(r).toMatchObject({ kind: "text" });
    expect(r.kind === "text" ? r.text : "").toContain("web_search");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("قائمة الأدوات الفعلية المفعّلة");
    expect(seen[0]).toContain("github_read_file");
    expect(seen[0]).not.toContain("delete_repository");
    expect(seen[1]).toContain("قائمة الأدوات الفعلية المفعّلة");
  });

  it("Sham v2 passes a self-identification answer through unchanged (no app-level identity correction)", async () => {
    const seen: string[] = [];
    const generated = "أنا نوفا، مساعد مستقل ضمن تطبيق شام.";
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "من أنت؟",
      ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say(generated)], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: generated });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("رسالة المستخدم الحالية:");
    expect(seen[0]).not.toContain("لا تخلط بين شام ونوفا");
  });
  it("Sham v2 rejects near-echo answers with a small word change", async () => {
    const seen: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "هل لديك خبرة في الكود",
      ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say("هل لديك خبرة في المود"), say("نعم، أستطيع مساعدتك في كتابة الكود وفهمه.")], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: "نعم، أستطيع مساعدتك في كتابة الكود وفهمه." });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("لا تكرر نص السؤال");
  });
  it("Sham v2 retries a reply that echoes the current or a previous question", async () => {
    const seen: string[] = [];
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "أنت ماذا تستطيع أن تفعل؟",
      history: [{ q: "ما الذي تتقنه وتستطيع القيام به؟", a: "ما الذي تتقنه وتستطيع القيام به؟" }],
      ctx, tools: shamToolDefs(false), budgetMs: 30000,
      ask: script([say("ما الذي تتقنه وتستطيع القيام به؟"), say("أستطيع شرح المواضيع والإجابة عن الأسئلة ومساعدتك في البرمجة.")], seen),
    }));
    expect(r).toMatchObject({ kind: "text", text: "أستطيع شرح المواضيع والإجابة عن الأسئلة ومساعدتك في البرمجة." });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContain("ما الذي تتقنه وتستطيع القيام به؟");
    expect(seen[1]).toContain("لا تكرر نص السؤال");
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
    const r = await shamAgentRun({ text: "ابحث عن الطقس", ctx, tools, budgetMs: 60000,
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
  it("passes requested video scenes and narration through make_media", async () => {
    const tools = shamToolDefs(false);
    const calls: unknown[] = [];
    const r = await shamAgentRun({
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
    const a = await shamAgentRun({ text: "ابحث بعمق", ctx, tools, budgetMs: 60000, maxSteps: 2, continuable: true, ask: script([call, call]), exec: async () => "نتيجة" });
    expect(a.kind).toBe("more");
    const msgs = (a as any).messages;
    expect(msgs.filter((m: any) => m.role === "tool")).toHaveLength(2);
    const seen: string[] = [];
    const b = await shamAgentRun({ text: "ابحث بعمق", ctx, tools, budgetMs: 60000, resume: msgs, ask: script([say("الجواب النهائي.")], seen), exec: async () => "نتيجة" });
    expect(b).toMatchObject({ kind: "text", text: "الجواب النهائي." });
    expect(seen[0]).toMatch(/نتيجة الأداة web_search/);                                    // the earlier legs' results are in front of Sham
    const last = await shamAgentRun({ text: "ابحث", ctx, tools, budgetMs: 60000, maxSteps: 2, continuable: false, ask: script([call, call, say("خلاصة.")]), exec: async () => "نتيجة" });
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
    const a = await shamAgentRun({ text: "ارسم أرنباً", ctx, tools, budgetMs: 50000, continuable: true, ask: script([call]), media: async () => { throw new Error("must not run in the short leg"); } });
    expect(a.kind).toBe("more");
    const got: string[] = [];
    const asks: string[] = [];
    const b = await shamAgentRun({ text: "ارسم أرنباً", ctx, tools, budgetMs: 230000, resume: (a as any).messages, ask: script([], asks), media: async (k, p) => { got.push(`${k}:${p}`); return { type: "image", b64: "AAAA" } as any; } });
    expect(b).toMatchObject({ kind: "reply", reply: { type: "image" } });
    expect(got).toEqual(["image:أرنب يلعب"]);
    expect(asks).toEqual([]);                                                   // the model is not asked again
  });
});
