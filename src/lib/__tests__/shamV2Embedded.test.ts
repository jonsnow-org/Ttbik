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
  it("the sandbox_* names the model learned run as the matching tool of the embedded computer", async () => {
    await shamRunTool(call("sandbox_exec", { command: "ls", cwd: "app" }), ctx("sham_v2"));
    await shamRunTool(call("sandbox_write_file", { path: "a.txt", content: "x", cwd: "app" }), ctx("sham_v2"));
    await shamRunTool(call("sandbox_clone", { repo: "o/r", branch: "dev" }), ctx("sham_v2"));
    await shamRunTool(call("sandbox_wait", { id: "j1" }), ctx("sham_v2"));
    expect(ran.map((r) => r.tool)).toEqual(["computer_run", "computer_write", "computer_repo", "computer_job"]);
    expect(ran[1].args).toMatchObject({ path: "app/a.txt", content: "x" });
    expect(ran[2].args).toMatchObject({ url: "https://github.com/o/r", ref: "dev" });
    expect(ran[3].args).toMatchObject({ action: "log", id: "j1" });
  });
  it("Sham v1 is the same: its sandbox_* run on its own embedded computer", async () => {
    await shamRunTool(call("sandbox_exec", { command: "ls" }), ctx("sham"));
    expect(ran.map((r) => r.tool)).toEqual(["computer_run"]);
  });
});

import { browserOwnStudioFor } from "@/lib/browserComputer";
describe("each Sham's browser lives in its own Studio", () => {
  it("routes the browser of Sham and Sham v2 to their own Studios, other models to the shared hub", () => {
    delete process.env.SHAM_V2_URL; delete process.env.SHAM_MODELSCOPE_URL;
    expect(browserOwnStudioFor("sham_v2")).toContain("sham-v2-server");
    expect(browserOwnStudioFor("sham")).not.toContain("sham-v2");
    expect(browserOwnStudioFor("sham")).toContain("sham");
    expect(browserOwnStudioFor("lfm25") || "").not.toContain("sham");
  });
});
