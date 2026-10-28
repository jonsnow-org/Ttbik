// Sham v2's own http_request / recall / send_file, and Nova's explicit plan tool. Sham reaches the platform only through ShamHost (shamHost.ts): here a fake host, no network, no Nova engine.
import { SHAM_TOOLS, setShamHost, shamNeedsOk, shamRunTool, shamTools, type ShamCtx, type ShamHost } from "@/lib/shamExec";
import { renderPlan, runTool, toolGroups } from "@/lib/coderAgent";

const call = (name: string, args: object) => ({ id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } }) as any;
const bank: { runId: string; chatKey: string; label: string; body: string }[] = [];
const requests: string[] = [];
const fakeHost = {
  web: { request: async (m: string, u: string) => { requests.push(`${m} ${u}`); return `HTTP 200 application/json\n{"ok":true}`; }, search: async () => "", page: async () => ({ ok: true, text: "", url: "" }), research: async () => "" },
  bank: { add: async (runId: string, chatKey: string, _s: number, _t: string, label: string, body: string) => { bank.push({ runId, chatKey, label, body }); }, recall: async (runId: string, chatKey: string, q: string) => bank.filter((b) => b.runId === runId && b.chatKey === chatKey && b.body.includes(q)).map((b) => b.label).join("|") || "nothing" },
  sandbox: { has: () => false, run: async () => null, readFile: async (_c: unknown, p: string) => (p === "report.md" ? { path: "/home/sham/report.md", bytes: Buffer.from("# done") } : null) },
} as unknown as ShamHost;
const sent: string[] = [];
const ctx = (over: Partial<ShamCtx> = {}): ShamCtx => ({ chatId: 7, db: {} as any, githubToken: null, chatKey: "sham:7", runId: "sham-7", owner: false, sendFile: async (n, b) => { sent.push(`${n}:${b.length}`); }, ...over });
beforeEach(() => { bank.length = 0; requests.length = 0; sent.length = 0; setShamHost(fakeHost); });
afterAll(() => setShamHost(null));

describe("Sham v2 tools", () => {
  it("has http_request, recall and send_file (view_image needs a vision model Sham v2 does not have: not offered)", () => {
    const names = shamTools(false).map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(["http_request", "recall", "send_file"]));
    expect(names).not.toContain("view_image");
    expect(SHAM_TOOLS.every((t) => t.function.name !== "load_tools")).toBe(true);
  });
  it("http_request: GET runs; a write waits for the user's tap", async () => {
    expect(shamNeedsOk(call("http_request", { url: "https://x.test/a" }))).toBe(false);
    expect(shamNeedsOk(call("http_request", { method: "POST", url: "https://x.test/a" }))).toBe(true);
    expect(await shamRunTool(call("http_request", { url: "https://x.test/a" }), ctx())).toContain("HTTP 200");
    expect(await shamRunTool(call("http_request", { method: "POST", url: "https://x.test/a" }), ctx())).toMatch(/^error: .*tap/);
    expect(await shamRunTool(call("http_request", { method: "POST", url: "https://x.test/a" }), ctx(), true)).toContain("HTTP 200");
    expect(requests).toEqual(["GET https://x.test/a", "POST https://x.test/a"]);
  });
  it("recall finds what an earlier read returned, in Sham's own run only", async () => {
    await shamRunTool(call("http_request", { url: "https://x.test/readme" }), ctx());
    await new Promise((r) => setTimeout(r, 5));
    expect(bank[0]).toMatchObject({ runId: "sham-7", chatKey: "sham:7" });
    expect(await shamRunTool(call("recall", { query: "ok" }), ctx())).toContain("http_request");
    expect(await shamRunTool(call("recall", { query: "ok" }), ctx({ runId: "sham-8", chatKey: "sham:8" }))).toBe("nothing");     // another chat never sees it
  });
  it("send_file sends a file from the VM through the chat's own sender; missing file / no sender are errors", async () => {
    expect(await shamRunTool(call("send_file", { path: "report.md" }), ctx())).toContain("sent /home/sham/report.md");
    expect(sent).toEqual(["report.md:6"]);
    expect(await shamRunTool(call("send_file", { path: "nope.md" }), ctx())).toMatch(/^error: the file was not found/);
    expect(await shamRunTool(call("send_file", { path: "report.md" }), ctx({ sendFile: undefined }))).toMatch(/^error/);
  });
});

describe("Nova's plan tool", () => {
  it("is a real tool in Nova's memory group and writes the plan into the task notes", async () => {
    expect(toolGroups(false).memory.map((t) => t.function.name)).toContain("plan");
    const notes: string[] = [];
    const out = await runTool(call("plan", { items: [{ step: "read", status: "doing" }, { step: "fix" }] }), { addNote: (t: string) => notes.push(t) } as any);
    expect(out).toBe("◐ 1. read\n☐ 2. fix");
    expect(notes[0]).toMatch(/^PLAN\n◐ 1\. read/);
    expect(await runTool(call("plan", { items: [] }), { addNote: () => undefined } as any)).toMatch(/^error/);
  });
  it("renders a TODO list with status marks, caps at 12, rejects nothing usable", () => {
    expect(renderPlan([{ step: "read the file", status: "done" }, { step: "fix it", status: "doing" }, { step: "test" }])).toBe("☑ 1. read the file\n◐ 2. fix it\n☐ 3. test");
    expect(renderPlan(Array.from({ length: 20 }, (_, i) => ({ step: `s${i}` }))).split("\n")).toHaveLength(12);
    expect(renderPlan([])).toBe("");
    expect(renderPlan("x")).toBe("");
    expect(renderPlan([{ status: "done" }, null])).toBe("");
  });
});
