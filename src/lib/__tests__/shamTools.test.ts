import { parseShamToolCalls, shamToolBlock, shamToolConversation, shamToolsEnabled } from "@/lib/shamTools";
import { shamAsModel } from "@/lib/coderProvider";
import { GITHUB_TOOLS, toolGroups } from "@/lib/coderAgent";

const tools = [...GITHUB_TOOLS.filter((t) => ["github_read_file", "github_list_files", "github_repo_scan"].includes(t.function.name)), ...toolGroups(true, false).computer];

describe("Sham gets Nova's tools as text", () => {
  it("is off by default, on with SHAM_TOOLS=on or SHAM_LIMITS=open, and SHAM_TOOLS=off always wins", () => {
    const saved = [process.env.SHAM_TOOLS, process.env.SHAM_LIMITS]; delete process.env.SHAM_TOOLS; delete process.env.SHAM_LIMITS;
    expect(shamToolsEnabled()).toBe(false);
    process.env.SHAM_LIMITS = "open"; expect(shamToolsEnabled()).toBe(true);
    process.env.SHAM_TOOLS = "off"; expect(shamToolsEnabled()).toBe(false);
    delete process.env.SHAM_LIMITS; process.env.SHAM_TOOLS = "on"; expect(shamToolsEnabled()).toBe(true);
    saved[0] === undefined ? delete process.env.SHAM_TOOLS : (process.env.SHAM_TOOLS = saved[0]); saved[1] === undefined ? delete process.env.SHAM_LIMITS : (process.env.SHAM_LIMITS = saved[1]);
  });
  it("lists the loaded tools compactly, the VM / terminal tools included", () => {
    const b = shamToolBlock(tools);
    expect(b).toMatch(/- github_read_file\(repo, path/);
    expect(b).toMatch(/sandbox_exec\(/);
    expect(b).toMatch(/<tool_call>/);
    expect(b.length).toBeLessThan(2800);
  });
  it("reads a call in the tag form, a json fence and a bare object, only for loaded tools", () => {
    const a = parseShamToolCalls('سأقرأ الملف. <tool_call>{"name":"github_read_file","arguments":{"repo":"o/r","path":"a.ts"}}</tool_call>', tools);
    expect(a.calls).toHaveLength(1); expect(a.calls[0].function.name).toBe("github_read_file"); expect(JSON.parse(a.calls[0].function.arguments)).toEqual({ repo: "o/r", path: "a.ts" }); expect(a.text).toBe("سأقرأ الملف.");
    expect(parseShamToolCalls('```json\n{"name":"sandbox_exec","arguments":{"command":"ls"}}\n```', tools).calls[0].function.name).toBe("sandbox_exec");
    expect(parseShamToolCalls('{"name":"github_read_file","arguments":{"repo":"o/r","path":"x"}}', tools).calls).toHaveLength(1);
    const bad = parseShamToolCalls('<tool_call>{"name":"rm_everything","arguments":{}}</tool_call>', tools);
    expect(bad.calls).toHaveLength(0); expect(bad.text).toMatch(/rm_everything/);                 // not a loaded tool: just words
    expect(parseShamToolCalls("أهلاً، هذا جواب عادي.", tools)).toEqual({ text: "أهلاً، هذا جواب عادي.", calls: [] });
    expect(parseShamToolCalls("<tool_call>not json</tool_call>", tools).calls).toHaveLength(0);
  });
  it("shows earlier calls and results to Sham, keeping the end when it is too long", () => {
    const msgs: any[] = [{ role: "user", content: "اقرأ الملف" }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "github_read_file", arguments: '{"repo":"o/r","path":"a"}' } }] }, { role: "tool", name: "github_read_file", content: "x".repeat(5000), tool_call_id: "1" }];
    const p = shamToolConversation(msgs, tools, { turns: 6, turnChars: 300, maxChars: 3200 });
    expect(p.startsWith("الأدوات المتاحة لك")).toBe(true); expect(p).toMatch(/نتيجة الأداة github_read_file/); expect(p).toMatch(/<tool_call>\{"name": "github_read_file"/); expect(p.endsWith("شام:")).toBe(true);
    expect(p.length).toBeLessThanOrEqual(3400);
  });
  it("shamAsModel returns the parsed calls as the engine's tool_calls (and plain words stay words)", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_TOOLS = "on";
    const real = global.fetch; const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    let text = '<tool_call>{"name":"github_read_file","arguments":{"repo":"o/r","path":"a.ts"}}</tool_call>';
    global.fetch = (async (url: string) => (/call\/v2\//.test(url) ? ({ ok: true, json: async () => ({ event_id: "e" }) } as any) : ({ ok: true, text: async () => body({ type: "text", text }) } as any))) as any;
    const o = await shamAsModel([{ role: "user", content: "اقرأ a.ts" }], { conversation: true, tools });
    expect(o.reply?.tool_calls?.[0].function.name).toBe("github_read_file");
    text = "جواب عادي"; const o2 = await shamAsModel([{ role: "user", content: "مرحبا" }], { conversation: true, tools });
    expect(o2.reply?.tool_calls).toEqual([]); expect(o2.reply?.text).toBe("جواب عادي");
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN; delete process.env.SHAM_TOOLS;
  });
});

import { SHAM_CODE_NOTE, brokenCallAttempt, codeNotTried, shamCorrectionNote, validateShamCall } from "@/lib/shamTools";

describe("Sham's calls are checked before they run, and wrong ones go back to Sham", () => {
  const call = (name: string, args: unknown) => ({ id: "1", type: "function" as const, function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
  it("accepts a sound call and names every problem of a bad one", () => {
    expect(validateShamCall(call("github_read_file", { repo: "o/r", path: "a.ts" }), tools)).toBeNull();
    expect(validateShamCall(call("github_read_file", { repo: "o/r" }), tools)).toMatch(/«path» ناقص/);
    expect(validateShamCall(call("github_read_file", { repo: "", path: "a" }), tools)).toMatch(/«repo» ناقص/);
    expect(validateShamCall(call("github_read_file", { repo: 5, path: "a" }), tools)).toMatch(/«repo» يجب أن يكون من نوع string/);
    expect(validateShamCall(call("github_read_file", { repo: "o/r", path: "a", bogus: 1 }), tools)).toMatch(/«bogus» غير موجود/);
    expect(validateShamCall(call("github_read_file", "{oops"), tools)).toMatch(/ليست JSON/);
    expect(validateShamCall(call("nope", {}), tools)).toMatch(/غير محمّلة/);
  });
  it("tells a broken call attempt from plain words, and the correction note carries the reason and the ask_user rule", () => {
    expect(brokenCallAttempt('<tool_call>{"name": "x"</tool_call>')).toBe(true);
    expect(brokenCallAttempt("جواب عادي")).toBe(false);
    expect(shamCorrectionNote(["github_read_file: «path» ناقص."])).toMatch(/«path» ناقص[\s\S]*ask_user/);
  });
  it("notices code that was written but not tried in the computer", () => {
    const code = "هذا الحل:\n```python\ndef add(a, b):\n    return a + b\n```";
    const user: any[] = [{ role: "user", content: "اكتب دالة جمع" }];
    expect(codeNotTried(code, user, tools)).toBe(true);
    expect(codeNotTried("جواب بلا كود", user, tools)).toBe(false);
    expect(codeNotTried(code, [...user, { role: "tool", name: "sandbox_exec", content: "ok" }], tools)).toBe(false);
    expect(codeNotTried(code, user, tools.filter((t) => !t.function.name.startsWith("sandbox_")))).toBe(false);
    expect(SHAM_CODE_NOTE).toMatch(/sandbox_exec/);
  });
  it("shamAsModel sends a wrong call back once and uses the corrected one", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_TOOLS = "on";
    const real = global.fetch; const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    const prompts: string[] = []; const answers = ['<tool_call>{"name":"github_read_file","arguments":{"repo":"o/r"}}</tool_call>', '<tool_call>{"name":"github_read_file","arguments":{"repo":"o/r","path":"a.ts"}}</tool_call>'];
    global.fetch = (async (url: string, init: any) => { if (/call\/v2\//.test(url)) { prompts.push(String(init?.body)); return { ok: true, json: async () => ({ event_id: "e" }) } as any; } return { ok: true, text: async () => body({ type: "text", text: answers[Math.min(prompts.length - 1, 1)] }) } as any; }) as any;
    const o = await shamAsModel([{ role: "user", content: "اقرأ a.ts في o/r" }], { conversation: true, tools });
    expect(prompts).toHaveLength(2); expect(prompts[1]).toMatch(/تصحيح من المحرك/);
    expect(JSON.parse(o.reply!.tool_calls![0].function.arguments)).toEqual({ repo: "o/r", path: "a.ts" });
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN; delete process.env.SHAM_TOOLS;
  });
});

import { shamKnobs } from "@/lib/shamModes";
import { shamVariant } from "@/lib/shamStudio";

describe("thinking / accuracy / speed are real for Sham", () => {
  it("accuracy changes the answer budget, the correction rounds and the sampling; the header goes only to the new Studio (or when SHAM_MODES=on)", () => {
    delete process.env.SHAM_MODES;
    const f = shamKnobs({ accuracy: "fast" }), b = shamKnobs({ accuracy: "balanced" }), p = shamKnobs({ accuracy: "precise" });
    expect([f.maxNewFactor, b.maxNewFactor, p.maxNewFactor]).toEqual([0.6, 1, 1.5]);
    expect([f.corrections, b.corrections, p.corrections]).toEqual([1, 2, 3]);
    expect([f.temperature, b.temperature, p.temperature]).toEqual([0.7, 0.6, 0.2]);
    expect(b.header).toBe("");                                                      // the old Studio is not shown a line it may not understand
    expect(shamKnobs({ accuracy: "precise" }, "v2").header).toBe("[[sham temp=0.20]]\n");
    expect(shamKnobs({ accuracy: "precise", think: true, thinkCap: 3000 }, "v2").header).toBe("[[sham temp=0.20 think=1000]]\n");   // thinking: a thought of at most cap/3 tokens
    expect(shamKnobs({ accuracy: "fast", think: true, thinkCap: 500 }, "v2").thinkTokens).toBe(167);
    expect(shamKnobs({ accuracy: "precise" }, "v2").note).toMatch(/أقصى دقة/);
    expect(shamKnobs({ think: true }, "v1").thinkTokens).toBe(0);                    // the old body cannot think: nothing is sent
    process.env.SHAM_MODES = "on";
    expect(shamKnobs({ accuracy: "fast" }, "v1").header).toBe("[[sham temp=0.70]]\n");
    delete process.env.SHAM_MODES;
  });
  it("shamAsModel sends the header, scales the budget by accuracy, and uses the right number of correction rounds", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const real = global.fetch; const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    const sent: any[] = [];
    global.fetch = (async (url: string, init: any) => { if (/call\/v2\//.test(url)) { sent.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ event_id: "e" }) } as any; } return { ok: true, text: async () => body({ type: "text", text: "جواب بلا أداة" }) } as any; }) as any;
    await shamVariant.run("v2", () => shamAsModel([{ role: "user", content: "سؤال" }], { conversation: true, maxTokens: 100, mode: { accuracy: "precise", think: true, thinkCap: 600 } }));
    await shamVariant.run("v2", () => shamAsModel([{ role: "user", content: "سؤال" }], { conversation: true, maxTokens: 100, mode: { accuracy: "fast" } }));
    expect(sent[0].prompt.startsWith("[[sham temp=0.20 think=200]]\n")).toBe(true);
    expect(sent[0].max_new_tokens).toBeGreaterThan(sent[1].max_new_tokens);          // precise gets a longer budget than fast
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN;
  });
});


import { shamModeCtx, shamThink } from "@/lib/shamStudio";

describe("Sham's own path applies the chat's settings to every call", () => {
  it("the new Studio gets the header and a scaled answer budget; the old one gets only the scaled budget (until SHAM_MODES=on)", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t"; delete process.env.SHAM_MODES;
    const real = global.fetch; const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    const sent: any[] = [];
    global.fetch = (async (url: string, init: any) => { if (/call\/v2\//.test(url)) { sent.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ event_id: "e" }) } as any; } return { ok: true, text: async () => body({ type: "text", text: "ok" }) } as any; }) as any;
    await shamVariant.run("v2", () => shamModeCtx.run({ accuracy: "precise", think: true, thinkCap: 600 }, () => shamThink("سؤال", "u", null, 80, 20000)));
    await shamVariant.run("v1", () => shamModeCtx.run({ accuracy: "fast" }, () => shamThink("سؤال", "u", null, 80, 20000)));
    expect(sent[0].prompt.startsWith("[[sham temp=0.20 think=200]]\n")).toBe(true);
    expect(sent[0].max_new_tokens).toBe(120);                                         // 80 x 1.5
    expect(sent[1].prompt).toBe("سؤال");                                              // the old Studio is not shown a line it may not read
    expect(sent[1].max_new_tokens).toBe(48);                                          // 80 x 0.6
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN;
  });
});
