import { keepAwakeOnce, keepNova2AwakeOnce, parseAiStudioUrl, parseStudioUrl, studiosToKeepAwake } from "../studioKeepAwake";

describe("studioKeepAwake", () => {
  it("parses only ModelScope Studio inference hosts", () => {
    expect(parseStudioUrl("https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net/")).toEqual({ owner: "novaai2026", name: "sham-v2-server", url: "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net" });
    expect(parseStudioUrl("https://ttbik-gate.jonsnowx1r.workers.dev")).toBeNull();
  });

  it("covers every model's own Studios once (defaults + env lists)", () => {
    const names = studiosToKeepAwake({ OPEN_CODER_STUDIO_URLS: "https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net,https://studio-novaai2026-coder-inference-server-2.api-inference.modelscope.net" }).map((s) => s.name);
    for (const n of ["coder-inference-server", "coder-inference-server-2", "lfm25-inference-server", "lfm25-media-server", "sham-v2-server", "nova-media-server", "epicrealism-image-test"]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("wakes a sleeping Studio with POST /deploy and only GETs a running one; nothing without a token", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/openapi/v1/studios/") && !url.endsWith("/deploy")) {
        const sleeping = url.endsWith("/sham-v2-server");
        return new Response(JSON.stringify({ data: { runtime: { status: sleeping ? "Sleeping" : "Running" } } }), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const out = await keepAwakeOnce(fetchFn, { MODELSCOPE_API_TOKEN: "t" });
    expect(out["sham-v2-server"]).toMatch(/woken/);
    expect(calls).toContain("POST https://www.modelscope.cn/openapi/v1/studios/novaai2026/sham-v2-server/deploy");
    expect(calls.some((c) => c === "POST https://www.modelscope.cn/openapi/v1/studios/novaai2026/lfm25-inference-server/deploy")).toBe(false);
    expect(calls).toContain("GET https://studio-novaai2026-lfm25-inference-server.api-inference.modelscope.net/");
    expect(await keepAwakeOnce(fetchFn, {})).toEqual({});
  });

  it("keeps Nova 2's international Studio awake with its own token: deploy only when sleeping, never a cn address", async () => {
    expect(parseAiStudioUrl("https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai")?.name).toBe("coder-inference-server-16");
    expect(parseAiStudioUrl("https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net")).toBeNull();
    const calls: string[] = [];
    let state = "Sleeping";
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${url} ${(init?.headers as Record<string, string>)?.Authorization || ""}`);
      if (url.includes("/openapi/v1/studios/") && !url.endsWith("/deploy")) return new Response(JSON.stringify({ data: { runtime: { status: state } } }), { status: 200 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const urls = ["https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai"];
    expect((await keepNova2AwakeOnce(urls, "ai-token", fetchFn))["coder-inference-server-16"]).toMatch(/woken/);
    expect(calls).toContain("POST https://www.modelscope.ai/openapi/v1/studios/jonjithup/coder-inference-server-16/deploy Bearer ai-token");
    calls.length = 0; state = "Running";
    await keepNova2AwakeOnce(urls, "ai-token", fetchFn);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
    expect(await keepNova2AwakeOnce(urls, "", fetchFn)).toEqual({});
  });
});
