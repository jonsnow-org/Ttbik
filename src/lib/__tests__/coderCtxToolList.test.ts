import { toolGroupsLazy } from "@/lib/coderAgents";
import { coderToolsFor } from "@/lib/coderAgent";
import { forgetStudioCtx, noteStudioCtx } from "@/lib/coderContext";

describe("a small Studio context gets the small tool list (live run 5ff363b8: 18,531 tokens into a 16,384 window)", () => {
  const saved = { ...process.env };
  beforeEach(() => { delete process.env.CODER_TOOL_GROUPS; delete process.env.NOVA2_STUDIO_URLS; forgetStudioCtx(); });
  afterEach(() => { process.env = { ...saved }; forgetStudioCtx(); });

  it("unknown or large context keeps the fixed list; 16,384 switches to load_tools whatever the pool environment says", () => {
    expect(toolGroupsLazy()).toBe(false);
    noteStudioCtx("studio-16", 32768);
    expect(toolGroupsLazy()).toBe(false);
    noteStudioCtx("studio-16", 16384);
    expect(toolGroupsLazy()).toBe(true);
  });

  it("the small list is a fraction of the full one", () => {
    const full = JSON.stringify(coderToolsFor(true, false, [])).length;
    noteStudioCtx("studio-16", 16384);
    const small = coderToolsFor(true, false, []);
    expect(small.some((t) => t.function.name === "load_tools")).toBe(true);
    expect(JSON.stringify(small).length).toBeLessThan(full / 3);
  });

  it("CODER_TOOL_GROUPS=fixed still wins", () => {
    process.env.CODER_TOOL_GROUPS = "fixed";
    noteStudioCtx("studio-16", 16384);
    expect(toolGroupsLazy()).toBe(false);
  });
});
