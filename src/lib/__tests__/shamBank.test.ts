// The central knowledge bank client: one bank (held by the v1 Studio) for Sham, Sham v2 and Nova; best effort, never breaks a tool.
import { bankBase, bankEnabled, bankSearch, formatBank, bankSection } from "@/lib/shamBank";
import { setShamHost, shamRunTool, type ShamCtx, type ShamHost } from "@/lib/shamExec";

const sse = (obj: unknown) => `event: complete\ndata: ${JSON.stringify([JSON.stringify(obj)])}\n\n`;
function studio(results: unknown, ok = true) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    if (String(url).includes("/gradio_api/call/v2/bank_search")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
    return new Response(sse(ok ? { ok: true, results } : { ok: false, error: "the knowledge bank is not loaded yet" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const OLD = { ...process.env };
beforeEach(() => { process.env.MODELSCOPE_API_TOKEN = "t"; delete process.env.SHAM_BANK_OFF; });
afterAll(() => { process.env = OLD; setShamHost(null); });

describe("shamBank client", () => {
  it("goes to the v1 Studio whichever Sham asks, never to v2 / Nova URLs", () => {
    process.env.SHAM_MODELSCOPE_URL = "https://studio-x-sham-v2-server.example,https://studio-x-sham-v1-server.example/";
    expect(bankBase()).toBe("https://studio-x-sham-v1-server.example");
    delete process.env.SHAM_MODELSCOPE_URL;
    expect(bankBase()).toMatch(/sham-v1-server/);
  });
  it("needs the account token and can be switched off", () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(bankEnabled()).toBe(false);
    process.env.MODELSCOPE_API_TOKEN = "t";
    expect(bankEnabled()).toBe(true);
    process.env.SHAM_BANK_OFF = "1";
    expect(bankEnabled()).toBe(false);
  });
  it("reads the passages with their source, and marks near-word matches", async () => {
    const { f, calls } = studio([{ text: "باريس عاصمة فرنسا", source: "sham-crawl-gh-collect-corpus", score: 1 }, { text: "Tokyo is the capital", source: "x", score: 0.7, approx: true }]);
    const hits = await bankSearch("عاصمة فرنسا", 4, { fetchImpl: f });
    expect(hits).toHaveLength(2);
    expect(calls[0]).toContain("/gradio_api/call/v2/bank_search");
    const text = formatBank(hits);
    expect(text).toContain("[B1] (sham-crawl-gh-collect-corpus)");
    expect(text).toContain("approximate match");
  });
  it("a bank that is not loaded, an unreachable Studio or an empty question give null / empty, never an error", async () => {
    expect(await bankSearch("q", 4, { fetchImpl: studio([], false).f })).toBeNull();
    expect(await bankSearch("q", 4, { fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).toBeNull();
    expect(await bankSearch("   ", 4, { fetchImpl: studio([]).f })).toBeNull();
    expect(await bankSection("q", 4, { fetchImpl: studio([], false).f })).toBe("");
  });
});

describe("Sham knowledge_search = the user's library + the shared bank", () => {
  const host = {
    web: { search: async () => "", page: async () => ({ ok: true, text: "", url: "" }), research: async () => "", request: async () => "" },
    bank: { add: async () => undefined, recall: async () => "" },
    limits: { ok: async () => true, add: async () => undefined },
  } as unknown as ShamHost;
  const ctx = (f: typeof fetch): ShamCtx => ({ chatId: 7, db: { exec: async () => undefined, query: async () => [] } as any, githubToken: null, chatKey: "sham:7:v1", runId: "r", owner: false, fetchImpl: f });
  const call = (args: object) => ({ id: "1", type: "function", function: { name: "knowledge_search", arguments: JSON.stringify(args) } }) as any;
  beforeEach(() => setShamHost(host));
  it("answers from the bank when the user's library is empty", async () => {
    const out = await shamRunTool(call({ query: "عاصمة فرنسا" }), ctx(studio([{ text: "باريس عاصمة فرنسا", source: "bank-src", score: 1 }]).f));
    expect(out).toContain("shared knowledge bank");
    expect(out).toContain("باريس عاصمة فرنسا");
    expect(out).toContain("bank-src");
  });
  it("with an empty library and no bank the old honest message stays", async () => {
    const out = await shamRunTool(call({ query: "anything" }), ctx(studio([], false).f));
    expect(out).toMatch(/nothing saved yet|no saved text matches/);
  });
});
