import { makePhotoMedia, photoWeightEndpoint, photoWeightProfile, PHOTO_WEIGHT_PROFILES } from "@/lib/photoWeightMedia";

describe("per-model photo weight routing", () => {
  const savedToken = process.env.MODELSCOPE_API_TOKEN;
  const savedShamV2Url = process.env.SHAM_V2_IMAGE_STUDIO_URL;
  afterEach(() => {
    if (savedToken === undefined) delete process.env.MODELSCOPE_API_TOKEN;
    else process.env.MODELSCOPE_API_TOKEN = savedToken;
    if (savedShamV2Url === undefined) delete process.env.SHAM_V2_IMAGE_STUDIO_URL;
    else process.env.SHAM_V2_IMAGE_STUDIO_URL = savedShamV2Url;
    jest.restoreAllMocks();
  });

  it("maps only Nova and Sham v2 to their dedicated image Studios", () => {
    const entries = Object.values(PHOTO_WEIGHT_PROFILES);
    expect(entries.map((x) => x.modelId)).toEqual(["coder", "sham_v2"]);
    expect(new Set(entries.map((x) => x.modelRepo)).size).toBe(entries.length);
    expect(new Set(entries.map((x) => x.defaultEndpoint)).size).toBe(entries.length);
    expect(photoWeightProfile("qwen35-9b")).toBeNull();
    expect(photoWeightProfile("gemma4-e4b")).toBeNull();
    expect(photoWeightProfile("minicpmo45")).toBeNull();
    expect(photoWeightProfile("coder")?.validationStatus).toBe("previously_passed");
    expect(photoWeightProfile("coder")?.modelRepo).toBe("novaai2026/epicrealism-image-test-models");
    expect(photoWeightProfile("sham_v2")?.modelRepo).toBe("novaai2026/realistic-vision-v6-test-models");
  });

  it("rejects unknown and retired models without making any HTTP request or trying a fallback", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    for (const id of ["not-a-model", "qwen35-9b"]) {
      const result = await makePhotoMedia(id, "A quiet street photograph", { fetchImpl });
      expect(result).toMatchObject({ type: "error", reason: "model_not_mapped" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a selected model when its own Studio is not ready and never contacts another Studio", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      urls.push(url);
      if (init?.method === "POST") return { ok: true, json: async () => ({ event_id: "status-1" }) };
      return {
        ok: true,
        text: async () => 'event: complete\ndata: [{"phase":"error","model_repo":"novaai2026/gemma4-realistic-vision-v6-test-models","error":"weights missing"}]\n\n',
      };
    }) as unknown as typeof fetch;
    const result = await makePhotoMedia("sham_v2", "A realistic portrait of an adult woman", { fetchImpl });
    expect(result).toMatchObject({ type: "error", reason: "studio_not_ready" });
    expect(urls.length).toBe(2);
    expect(urls.every((url) => url.includes("realistic-vision-v6-test"))).toBe(true);
    expect(urls.some((url) => url.includes("epicrealism"))).toBe(false);
  });

  it("uses only the selected model Studio and verifies the repo and checkpoint before returning an image", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    const profile = photoWeightProfile("sham_v2")!;
    const checksum = profile.expectedCheckpointSha256 || "a".repeat(64);
    const urls: string[] = [];
    const calls: Array<{ url: string; body?: string }> = [];
    const bytes = Buffer.alloc(4096, 127);
    const fakeFetch = (async (url: string, init?: { method?: string; body?: string }) => {
      urls.push(url);
      calls.push({ url, body: init?.body });
      if (init?.method === "POST" && url.endsWith("/status")) {
        return { ok: true, json: async () => ({ event_id: "status-1" }) };
      }
      if (url.endsWith("/status/status-1")) {
        const sse = 'event: complete\ndata: [{"phase":"ready","model_repo":"' + profile.modelRepo + '","checkpoint_sha256":"' + checksum + '"}]\n\n';
        return { ok: true, text: async () => sse };
      }
      if (init?.method === "POST" && url.endsWith("/image")) {
        return { ok: true, json: async () => ({ event_id: "image-1" }) };
      }
      if (url.endsWith("/image/image-1")) {
        const sse = 'event: complete\ndata: [{"path":"tmp/rv6-test.png"},{"result":"image_generated","model_repo":"' + profile.modelRepo + '","checkpoint_sha256":"' + checksum + '","seconds":3.5}]\n\n';
        return { ok: true, text: async () => sse };
      }
      if (url.includes("/gradio_api/file=")) {
        return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes };
      }
      throw new Error("Unexpected URL " + url);
    }) as unknown as typeof fetch;

    const result = await makePhotoMedia("sham_v2", "A realistic portrait of an adult woman", { seed: 42, fetchImpl: fakeFetch, bypassNegativePrompt: true });
    expect(result.type).toBe("image");
    if (result.type !== "image") throw new Error("Expected image result");
    expect(result.metadata).toMatchObject({ model_repo: profile.modelRepo, checkpoint_sha256: checksum });
    expect(Buffer.from(result.b64, "base64")).toEqual(bytes);
    expect(urls.every((url) => url.includes("realistic-vision-v6-test"))).toBe(true);
    expect(urls.some((url) => url.includes("/gradio_api/file=/tmp/rv6-test.png"))).toBe(true);
    expect(JSON.parse(calls[2].body!).data).toEqual([
      "A realistic portrait of an adult woman", "", profile.resolution, profile.steps, profile.cfg, 42,
    ]);
  });

  it("rejects a wrong private model repo and hash without calling the image endpoint", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    const urls: string[] = [];
    const fakeFetch = (async (url: string, init?: { method?: string }) => {
      urls.push(url);
      if (init?.method === "POST") return { ok: true, json: async () => ({ event_id: "status-1" }) };
      const sse = 'event: complete\ndata: [{"phase":"ready","model_repo":"novaai2026/cyberrealistic-final-test-models","checkpoint_sha256":"' + "b".repeat(64) + '"}]\n\n';
      return { ok: true, text: async () => sse };
    }) as unknown as typeof fetch;
    const result = await makePhotoMedia("sham_v2", "A realistic portrait of an adult woman", { fetchImpl: fakeFetch });
    expect(result).toMatchObject({ type: "error", reason: "model_identity_mismatch" });
    expect(urls.length).toBe(2);
    expect(urls.every((url) => url.includes("realistic-vision-v6-test"))).toBe(true);
  });

  it("allows per-model endpoint overrides without changing another model's destination", () => {
    process.env.SHAM_V2_IMAGE_STUDIO_URL = "off";
    expect(photoWeightEndpoint(photoWeightProfile("sham_v2")!)).toBe("");
    expect(photoWeightEndpoint(photoWeightProfile("coder")!)).toContain("epicrealism-image-test");
  });
});
