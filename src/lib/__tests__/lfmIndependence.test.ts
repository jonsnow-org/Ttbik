// LFM2.5-8B-A1B is its own model (owner 2026-11-04): its completions go only to its own Studios, Nova's only to Nova's, a job is always
// polled on the Studio that took it, and its media comes only from its own media Studio. Nothing falls back to another model.
import { allEngineBases, coderChat, coderJobResult, coderStudioUrls, currentEngineModel, lfmStudioUrls, withEngineModel } from "@/lib/openCoderStudio";
import { lfmMediaUrl, makeModelMedia, modelMediaConfigured, ownMediaBase } from "@/lib/modelMedia";
import { DEFAULT_MODELS, modelReady, modelUsableBy } from "@/lib/coderModels";

const NOVA = ["https://studio-x-coder-inference-server.api-inference.modelscope.net", "https://studio-x-coder-inference-server-2.api-inference.modelscope.net"];
const LFM = "https://studio-x-lfm25-inference-server.api-inference.modelscope.net";
const LFM_MEDIA = "https://studio-x-lfm25-media-server.api-inference.modelscope.net";
const saved = { ...process.env };
const realFetch = global.fetch;
let hits: string[] = [];

function sse(obj: unknown): string { return `event: complete\ndata: ${JSON.stringify([JSON.stringify(obj)])}\n\n`; }
beforeEach(() => {
  hits = [];
  process.env.OPEN_CODER_STUDIO_URL = NOVA[0];
  process.env.OPEN_CODER_STUDIO_URLS = [...NOVA, LFM].join(",");      // a polluted list must not pull LFM's Studio into Nova's pool
  process.env.LFM_STUDIO_URLS = LFM;
  process.env.LFM_MEDIA_STUDIO_URL = LFM_MEDIA;
  process.env.OPEN_CODER_STUDIO_TOKEN = "t";
  process.env.CODER_STUDIO_BALANCE = "off";
  global.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    hits.push(u);
    if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
    if (/lfm25-media/.test(u) || /\/image\/|\/speech\/|\/video\//.test(u)) return new Response(sse({ type: "error", reason: "test", text: "stub" }), { status: 200 });
    return new Response(sse({ type: "pending", job: "j1", text: "" }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { global.fetch = realFetch; });
afterAll(() => { process.env = saved; });

describe("LFM2.5 has its own Studio pool", () => {
  it("Nova's pool never holds LFM's Studio, LFM's pool never holds Nova's", () => {
    expect(coderStudioUrls("coder").sort()).toEqual([...NOVA].sort());
    expect(coderStudioUrls("lfm25")).toEqual([LFM]);
    expect(withEngineModel("lfm25", () => coderStudioUrls())).toEqual([LFM]);
    expect(withEngineModel("coder", () => coderStudioUrls()).includes(LFM)).toBe(false);
    expect(withEngineModel("qwen35-9b", () => currentEngineModel())).toBe("coder");
  });
  it("a new LFM completion goes only to LFM's Studio and its job id points back to it", async () => {
    const o = await withEngineModel("lfm25", () => coderChat([{ role: "user", content: "hi" }], { waitS: 1, timeoutMs: 5000 }));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.startsWith(LFM)).toBe(true);
    const job = String(o.reply?.job || "");
    expect(job).toMatch(/^s2~/);                                          // global index: Nova's two Studios first, then LFM's
    hits = [];
    await withEngineModel("coder", () => coderJobResult(job));            // polled from any context, it still reaches LFM's Studio
    for (const h of hits) expect(h.startsWith(LFM)).toBe(true);
    expect(allEngineBases()).toEqual([...NOVA, LFM]);
  });
  it("a Nova completion never touches LFM's Studio", async () => {
    await withEngineModel("coder", () => coderChat([{ role: "user", content: "hi" }], { waitS: 1, timeoutMs: 5000 }));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.startsWith(LFM)).toBe(false);
  });
  it("LFM switched off = an honest 'off', never Nova's Studios", async () => {
    process.env.LFM_STUDIO_URLS = "off";
    expect(lfmStudioUrls()).toEqual([]);
    const o = await withEngineModel("lfm25", () => coderChat([{ role: "user", content: "hi" }], { waitS: 1, timeoutMs: 5000 }));
    expect(o.failure).toBe("off");
    expect(hits).toEqual([]);
  });
});

describe("LFM2.5 media is its own", () => {
  it("every kind goes to LFM's own media Studio", async () => {
    expect(ownMediaBase("lfm25")).toBe(LFM_MEDIA);
    for (const kind of ["image", "audio", "video"] as const) {
      expect(modelMediaConfigured("lfm25", kind)).toBe(true);
      hits = [];
      await makeModelMedia("lfm25", kind, "a red apple on a table", { timeoutMs: 5000 });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) expect(h.startsWith(LFM_MEDIA)).toBe(true);
    }
  });
  it("LFM media off = a typed error, no other Studio is asked", async () => {
    process.env.LFM_MEDIA_STUDIO_URL = "off";
    expect(lfmMediaUrl()).toBe("");
    expect(modelMediaConfigured("lfm25", "video")).toBe(false);
    const r = await makeModelMedia("lfm25", "video", "waves", { timeoutMs: 5000 });
    expect(r?.type).toBe("error");
    expect(hits).toEqual([]);
  });
  it("retired candidates have no generator and cannot trigger an external request", async () => {
    for (const id of ["qwen35-9b", "gemma4-e4b", "minicpmo45"]) {
      expect(ownMediaBase(id)).toBe("");
      expect(modelMediaConfigured(id, "image")).toBe(false);
      hits = [];
      expect(await makeModelMedia(id, "video", "waves", { timeoutMs: 5000 })).toMatchObject({ type: "error", reason: "no_own_generator" });
      expect(hits).toEqual([]);
    }
  });
});

describe("LFM2.5 in the registry", () => {
  it("is listed, owner-only by default, with a visibility toggle (not locked)", () => {
    const m = DEFAULT_MODELS.find((x) => x.id === "lfm25")!;
    expect(m).toBeTruthy();
    expect(m.ownerOnly).toBe(true);
    expect(m.visible).toBe(false);
    expect(m.lockedOwnerOnly).toBeFalsy();
    expect(modelUsableBy(m, true)).toBe(true);
    expect(modelUsableBy(m, false)).toBe(false);
    process.env.MODELSCOPE_API_TOKEN = "t";
    expect(modelReady(m)).toBe(true);
    process.env.LFM_STUDIO_URLS = "off";
    expect(modelReady(m)).toBe(false);
  });
});

describe("computer hub is never a media host", () => {
  it("drops an env that points a model's media at nova-inference-server", () => {
    const old = process.env.LFM_MEDIA_STUDIO_URL;
    process.env.LFM_MEDIA_STUDIO_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ownMediaBase } = require("../modelMedia");
      expect(ownMediaBase("lfm25")).toBe("");
    } finally {
      if (old === undefined) delete process.env.LFM_MEDIA_STUDIO_URL; else process.env.LFM_MEDIA_STUDIO_URL = old;
    }
  });
});
