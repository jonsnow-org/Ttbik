import { toolGroupsLazy } from "@/lib/coderAgents";
import { coderToolsFor } from "@/lib/coderAgent";
import { forgetStudioCtx, noteStudioCtx } from "@/lib/coderContext";

describe("a small Studio context gets the small tool list (live run 5ff363b8: 18,531 tokens into a 16,384 window)", () => {
  const saved = { ...process.env };
  beforeEach(() => { delete process.env.CODER_TOOL_GROUPS; delete process.env.NOVA2_STUDIO_URLS; forgetStudioCtx(); });
  afterEach(() => { process.env = { ...saved }; forgetStudioCtx(); });

  it("unknown context = the small list (Nova's Studio is 16,384); a large reported context keeps the fixed list; 16,384 switches to load_tools whatever the pool environment says", () => {
    expect(toolGroupsLazy()).toBe(true);
    noteStudioCtx("studio-16", 32768);
    expect(toolGroupsLazy()).toBe(false);
    noteStudioCtx("studio-16", 16384);
    expect(toolGroupsLazy()).toBe(true);
  });

  it("the small list is a fraction of the full one", () => {
    noteStudioCtx("studio-big", 32768);
    const full = JSON.stringify(coderToolsFor(true, false, [])).length;
    forgetStudioCtx();
    noteStudioCtx("studio-16", 16384);
    const small = coderToolsFor(true, false, []);
    expect(small.some((t) => t.function.name === "load_tools")).toBe(true);
    expect(JSON.stringify(small).length).toBeLessThan(full / 3);
  });

  it("a 16k context overrides CODER_TOOL_GROUPS=fixed and keeps the model's tools available lazily", () => {
    process.env.CODER_TOOL_GROUPS = "fixed";
    noteStudioCtx("studio-16", 16384);
    expect(toolGroupsLazy()).toBe(true);
    const names = coderToolsFor(true, false, []).map((t) => t.function.name);
    expect(names).toContain("load_tools");
    expect(names).not.toContain("github_repo_audit");
  });
});

import { compactTool, toolTokens } from "@/lib/coderAgent";
describe("tool schemas fit what is left of a 16k window (live 2026-11-24: 16,458 / 16,669 tokens into 16,384, six identical retries)", () => {
  beforeEach(() => { delete process.env.CODER_TOOL_GROUPS; forgetStudioCtx(); noteStudioCtx("studio-16", 16384); });
  afterEach(() => forgetStudioCtx());
  const loadAll = (groups: string[]) => [{ role: "user", content: "ابدأ" }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "load_tools", arguments: JSON.stringify({ groups }) } }] }, { role: "tool", tool_call_id: "1", content: "loaded" }] as any;

  it("without a budget every loaded group comes back (old behaviour), with one the list fits the budget", () => {
    const msgs = loadAll(["computer", "worker", "web", "media", "memory", "schedule", "github"]);
    const whole = coderToolsFor(true, false, msgs);
    expect(toolTokens(whole)).toBeGreaterThan(8000);
    const fitted = coderToolsFor(true, false, msgs, [], 6000);
    expect(toolTokens(fitted)).toBeLessThanOrEqual(6000);
    expect(fitted.map((t) => t.function.name)).toContain("load_tools");      // what did not fit can be loaded again
  });

  it("the most recently loaded group is the one kept", () => {
    const msgs = [...loadAll(["computer"]), { role: "assistant", content: "", tool_calls: [{ id: "2", type: "function", function: { name: "load_tools", arguments: JSON.stringify({ groups: ["github"] }) } }] }, { role: "tool", tool_call_id: "2", content: "loaded" }] as any;
    const names = coderToolsFor(true, false, msgs, [], 6000).map((t) => t.function.name);
    expect(names).toContain("github_read_file");
    expect(names).not.toContain("sandbox_exec");
  });

  it("a group that does not fit whole comes with short descriptions, same tool names", () => {
    const msgs = loadAll(["github"]);
    const whole = coderToolsFor(true, false, msgs, [], 100000);
    const small = whole.map((t) => (t.function.name.startsWith("github_") ? compactTool(t) : t));
    expect(toolTokens(small)).toBeLessThan(toolTokens(whole));
    const budget = toolTokens(small) + 120;                  // room for the compact group, not for the whole one
    expect(budget).toBeLessThan(toolTokens(whole));
    const tight = coderToolsFor(true, false, msgs, [], budget);
    expect(tight.map((t) => t.function.name)).toEqual(whole.map((t) => t.function.name));
    expect(toolTokens(tight)).toBeLessThanOrEqual(budget);
  });
});
