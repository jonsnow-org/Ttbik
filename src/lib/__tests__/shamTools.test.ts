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
