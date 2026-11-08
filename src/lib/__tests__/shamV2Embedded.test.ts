// Owner's order 2026-11-08: Sham v2 depends on nothing outside itself. Its computer is the one embedded in its own Studio; the tools of the separate
// workspace run as the same computer; the browser / desktop (they need the shared hub) are not offered to it.
import { setShamHost, shamRunTool, shamTools, type ShamCtx, type ShamHost } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";

const call = (name: string, args: object) => ({ id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } }) as any;
const ran: { tool: string; args: any }[] = [];
const host = {
  computer: { run: async (_c: unknown, tool: string, args: any) => { ran.push({ tool, args }); return "ok " + tool; } },
  browser: { run: async () => "page" },
  desktop: { run: async () => { throw new Error("hub must not be used"); } },
  bank: { add: async () => undefined, recall: async () => "" },
  sandbox: { has: () => true, run: async () => { throw new Error("separate sandbox must not be used by v2"); }, readFile: async () => null },
} as unknown as ShamHost;
const ctx = (modelId: string): ShamCtx => ({ chatId: 7, db: {} as any, githubToken: null, chatKey: "k", runId: "r", owner: false, modelId } as any);
beforeEach(() => { ran.length = 0; setShamHost(host); });
afterAll(() => setShamHost(null));

describe("Sham v2 embedded environment", () => {
  it("keeps the same tool list for both Shams (nothing is hidden): computer, browser and the sandbox names the model learned", () => {
    const v2 = shamVariant.run("v2", () => shamTools(true).map((t) => t.function.name));
    const v1 = shamVariant.run("v1", () => shamTools(true).map((t) => t.function.name));
    expect(v2).toEqual(expect.arrayContaining(["computer_run", "computer_write", "computer_read", "computer_edit", "computer_search", "computer_job", "computer_repo"]));
    expect(v2).toContain("browser");
    expect(v2).toEqual(expect.arrayContaining(["sandbox_exec", "desktop"]));
    expect(v1).toEqual(expect.arrayContaining(["sandbox_exec", "desktop", "browser"]));
  });
  it("Sham's computer and browser run inside the model: a call that still reaches the app is not run on any Studio", async () => {
    for (const m of ["sham_v2", "sham"]) {
      expect(await shamRunTool(call("computer_run", { command: "ls" }), ctx(m))).toMatch(/runs inside the model itself/);
      expect(await shamRunTool(call("browser", { action: "open", url: "https://x.test" }), ctx(m))).toMatch(/runs inside the model itself/);
    }
    expect(ran).toHaveLength(0);                                          // the hub's computer was never called for a Sham
  });
  it("sandbox_* that reaches the app is refused too: those names run inside the model's loop as the embedded computer", async () => {
    await shamRunTool(call("sandbox_exec", { command: "ls" }), ctx("sham_v2"));
    expect(ran).toHaveLength(0);
  });
  it("Nova's hub is untouched: another model's computer call still goes to the host", async () => {
    await shamRunTool(call("computer_run", { command: "ls" }), ctx("lfm25"));
    expect(ran.map((r) => r.tool)).toEqual(["computer_run"]);
  });
});
