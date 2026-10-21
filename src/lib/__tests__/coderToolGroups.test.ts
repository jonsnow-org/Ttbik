import { coderTools, coderToolsFor, loadedGroups, runTool, toolGroups } from "@/lib/coderAgent";

const names = (ts: { function: { name: string } }[]) => ts.map((t) => t.function.name);

describe("tool groups the model loads itself", () => {
  it("a fresh conversation carries only load_tools, with the groups available here", () => {
    const t = coderToolsFor(true, false, [{ role: "user", content: "من انت" }]);
    expect(names(t)).toEqual(["load_tools"]);
    const en = (t[0].function.parameters as any).properties.groups.items.enum;
    expect(en).toEqual(expect.arrayContaining(["github", "computer", "web", "memory"]));
    expect(en).not.toContain("connectors");
    expect(JSON.stringify(t).length).toBeLessThan(JSON.stringify(coderTools(true)).length / 10);
  });
  it("no github group without GitHub", () => {
    const en = (coderToolsFor(false, false, [])[0].function.parameters as any).properties.groups.items.enum;
    expect(en).not.toContain("github");
  });
  it("loaded and already-used groups stay for the conversation", () => {
    const msgs: any[] = [
      { role: "user", content: "x" },
      { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "load_tools", arguments: '{"groups":["github"]}' } }] },
      { role: "tool", content: "loaded: github", tool_call_id: "1" },
      { role: "assistant", content: "", tool_calls: [{ id: "2", type: "function", function: { name: "web_search", arguments: '{"query":"q"}' } }] },
    ];
    expect([...loadedGroups(msgs, toolGroups(true))].sort()).toEqual(["github", "web"]);
    const n = names(coderToolsFor(true, false, msgs));
    expect(n).toContain("github_write_files");
    expect(n).toContain("fetch_page");
    expect(n).not.toContain("sandbox_exec");
    expect(n).toContain("load_tools");
  });
  it("every group loaded: load_tools itself is gone, all tools present", () => {
    const msgs: any[] = [{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "load_tools", arguments: '{"groups":["github","computer","web","memory"]}' } }] }];
    expect(names(coderToolsFor(true, false, msgs)).sort()).toEqual(names(coderTools(true)).sort());
  });
  it("CODER_TOOL_GROUPS=off sends every tool", () => {
    process.env.CODER_TOOL_GROUPS = "off";
    try { expect(names(coderToolsFor(true, false, []))).toEqual(names(coderTools(true))); } finally { delete process.env.CODER_TOOL_GROUPS; }
  });
  it("load_tools answers what was loaded", async () => {
    const ctx: any = { gh: null, addNote: () => {} };
    expect(await runTool({ function: { name: "load_tools", arguments: '{"groups":["web","github"]}' } }, ctx)).toMatch(/^loaded: web\..*Not available here: github/);
    expect(await runTool({ function: { name: "load_tools", arguments: '{"groups":["nope"]}' } }, ctx)).toMatch(/^error/);
  });
});
