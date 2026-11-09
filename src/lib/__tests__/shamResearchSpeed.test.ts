// Sham reads on a CPU: a research result is built to fit (not built at 24000 chars and cut), and asks for fewer sources, so the model starts answering sooner.
import { setShamHost, shamRunTool, type ShamCtx, type ShamHost } from "@/lib/shamExec";

const call = (name: string, args: object) => ({ id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } }) as any;
const seen: Record<string, unknown>[] = [];
const searches: number[] = [];
const host = {
  web: {
    research: async (_q: string, o: Record<string, unknown>) => { seen.push(o); return "x".repeat(9000); },
    search: async (_q: string, o: { limit: number }) => { searches.push(o.limit); return "r"; },
    page: async () => ({ ok: true, text: "", url: "" }),
    request: async () => "",
  },
  limits: { ok: async () => true, add: async () => undefined },
  bank: { add: async () => undefined, recall: async () => "" },
} as unknown as ShamHost;
const ctx = (): ShamCtx => ({ chatId: 7, db: {} as any, githubToken: null, chatKey: "sham:7", runId: "sham-7", owner: false });
beforeEach(() => { seen.length = 0; searches.length = 0; setShamHost(host); });
afterAll(() => setShamHost(null));

describe("Sham research speed", () => {
  it("deep_research: 6 sources by default (8 at most), a result sized to the window, a 15 s deadline", async () => {
    const out = await shamRunTool(call("deep_research", { question: "why is the sky blue" }), ctx());
    expect(seen[0]).toMatchObject({ maxSources: 6, deadlineMs: 15000 });
    expect(Number(seen[0].maxChars)).toBeLessThanOrEqual(4300);
    expect(out.length).toBeLessThan(4800);                       // whatever the host returns is cut to what a CPU model can read quickly
    await shamRunTool(call("deep_research", { question: "q", max_sources: 15 }), ctx());
    expect(seen[1]).toMatchObject({ maxSources: 8 });
  });
  it("web_search asks for 6 results by default", async () => {
    await shamRunTool(call("web_search", { query: "q" }), ctx());
    await shamRunTool(call("web_search", { query: "q", limit: 3 }), ctx());
    expect(searches).toEqual([6, 3]);
  });
});
