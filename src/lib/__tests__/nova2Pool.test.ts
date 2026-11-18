import { coderToolsFor } from "@/lib/coderAgent";
import { agentsAllowedFor, coderChat, coderJobResult, coderStudioUrls, allEngineBases, nova2Urls, nova2TokenSet, nova2WarmStartReady, tokenFor, withEngineModel, isEngineModel, currentEngineModel } from "@/lib/openCoderStudio";
import { DEFAULT_MODELS, modelReady } from "@/lib/coderModels";
import { computerModelOf, COMPUTER_MODEL_IDS } from "@/lib/computerModels";
import { browserStudioFor } from "@/lib/browserComputer";

jest.mock("@/lib/hostedSecrets", () => ({
  secretCached: jest.fn(() => ""),
  getSecret: jest.fn(async (name: string) => name === "AI_NOVA2_TOKEN" ? "db-stored-ai-token" : ""),
}));

const OLD = ["https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net", "https://studio-novaai2026-coder-inference-server-2.api-inference.modelscope.net"];
const N2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";

describe("Nova 2: its own model (35B on the international Studio) beside Nova", () => {
  const keep = { ...process.env };
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = OLD[0];
    process.env.OPEN_CODER_STUDIO_URLS = OLD[1];
    process.env.OPEN_CODER_STUDIO_TOKEN = "cn-token";
    process.env.LFM_STUDIO_URLS = "off";
    process.env.NOVA2_STUDIO_URLS = N2;
    delete process.env.NOVA2_STUDIO_TOKEN;
  });
  afterAll(() => { process.env = keep; });

  test("Nova 2 reads ~8 tokens/s: it gets the small tool list (load_tools), Nova keeps the full fixed list", () => {
    const msgs = [{ role: "user", content: "من انت" }] as never;
    const size = (m: "coder" | "nova2") => withEngineModel(m, () => JSON.stringify(coderToolsFor(true, true, msgs)).length);
    expect(size("nova2")).toBeLessThan(6000);                       // ~2,000 tokens at most (measured 1,860 characters)
    expect(size("coder")).toBeGreaterThan(30000);                   // unchanged for Nova: the whole list, same text every request
    const names = withEngineModel("nova2", () => (coderToolsFor(true, true, msgs) as { function: { name: string } }[]).map((t) => t.function.name));
    expect(names).toContain("load_tools");
    expect(names).toContain("ask_user");
    expect(names).not.toContain("delegate");
  });

  test("Nova 2 works alone: no agents, and never the cn token on its international Studio", () => {
    expect(withEngineModel("nova2", () => agentsAllowedFor())).toBe(false);
    expect(withEngineModel("coder", () => agentsAllowedFor())).toBe(true);
    delete process.env.NOVA2_STUDIO_TOKEN;
    expect(tokenFor(N2)).not.toContain("cn-token");
  });

  test("Nova keeps its Studios and Nova 2 has its own", () => {
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual(OLD);
    expect(withEngineModel("nova2", () => coderStudioUrls())).toEqual([N2]);
    expect(withEngineModel("nova2", () => currentEngineModel())).toBe("nova2");
    expect(isEngineModel("nova2")).toBe(true);
  });

  test("the job-index space only grows at the end: no job of Nova or LFM2.5 changes its number", () => {
    const all = allEngineBases();
    expect(all.slice(0, 2)).toEqual(OLD);
    expect(all[all.length - 1]).toBe(N2);
    process.env.NOVA2_STUDIO_URLS = "off";
    expect(allEngineBases()).toEqual(OLD);
  });

  test("only https addresses of non-Sham, non-hub, non-LFM Studios are accepted", () => {
    process.env.NOVA2_STUDIO_URLS = `${N2},http://x.example,https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net,https://studio-x-sham-v2-server.api-inference.modelscope.ai`;
    expect(nova2Urls()).toEqual([N2]);
  });

  test("each Studio gets its own account's token", () => {
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    expect(tokenFor(N2)).toBe("ai-token");
    expect(tokenFor(OLD[0])).toBe("cn-token");
    expect(nova2TokenSet()).toBe(true);
  });

  test("the model is in the list, owner-only, ready only with its token", () => {
    const m = DEFAULT_MODELS.find((x) => x.id === "nova2")!;
    expect(m).toBeTruthy();
    expect(m.ownerOnly).toBe(true);
    expect(modelReady(m)).toBe(false);
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    expect(modelReady(m)).toBe(true);
    expect(DEFAULT_MODELS.find((x) => x.id === "coder")).toBeTruthy();   // Nova is still there
  });

  test("an explicit model option routes Nova 2 to its international Studio even outside Nova 2's async context", async () => {
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    process.env.CODER_STUDIO_BALANCE = "off";
    const calls: string[] = [];
    const realFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (init?.method === "POST") return Response.json({ event_id: "nova2-event" });
      const payload = JSON.stringify([JSON.stringify({ type: "pending", job: "nova2-job" })]);
      return new Response("event: complete\ndata: " + payload + "\n\n", {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      const result = await withEngineModel("coder", () => coderChat(
        [{ role: "user", content: "hello" }],
        { model: "nova2", waitS: 1, timeoutMs: 5000 },
      ));
      expect(result.reply?.job).toBe("s2~nova2-job");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((url) => url.startsWith(N2))).toBe(true);

      const beforePoll = calls.length;
      await withEngineModel("coder", () => coderJobResult("s2~nova2-job", 0, 5000));
      expect(calls.length).toBeGreaterThan(beforePoll);
      expect(calls.slice(beforePoll).every((url) => url.startsWith(N2))).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("an explicit Nova 1 option overrides an ambient Nova 2 context", async () => {
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    process.env.CODER_STUDIO_BALANCE = "off";
    const calls: string[] = [];
    const realFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (init?.method === "POST") return Response.json({ event_id: "nova1-event" });
      const payload = JSON.stringify([JSON.stringify({ type: "pending", job: "nova1-job" })]);
      return new Response("event: complete\ndata: " + payload + "\n\n", {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      const result = await withEngineModel("nova2", () => coderChat(
        [{ role: "user", content: "hello" }],
        { model: "coder", waitS: 1, timeoutMs: 5000 },
      ));
      expect(result.reply?.job).toBe("nova1-job");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((url) => url.startsWith(OLD[0]))).toBe(true);
      expect(calls.some((url) => url.startsWith(N2))).toBe(false);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("Nova 2's first warm-up waits for its encrypted account token on a cold server", async () => {
    delete process.env.NOVA2_STUDIO_TOKEN;
    expect(await nova2WarmStartReady()).toBe(true);
  });

  test("Nova 2 is independent: its own session on the same Mini App computer as Nova (owner 2026-11-18)", () => {
    expect(computerModelOf("nova2")).toBe("nova2");
    expect(computerModelOf("coder")).toBe("coder");
    expect(computerModelOf("lfm25")).toBe("lfm25");
    expect(computerModelOf(undefined)).toBe("coder");
    expect(COMPUTER_MODEL_IDS).toContain("nova2");
    expect(browserStudioFor("nova2")).toBe(browserStudioFor("coder"));   // same Mini App computer host
  });
});
