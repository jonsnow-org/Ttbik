import { makePhotoMedia, photoWeightEndpoint, photoWeightProfile, PHOTO_WEIGHT_PROFILES } from "@/lib/photoWeightMedia";

describe("per-model photo weight routing", () => {
  const savedToken = process.env.MODELSCOPE_API_TOKEN;
  const savedGemmaUrl = process.env.GEMMA4_IMAGE_STUDIO_URL;
  afterEach(() => {
    if (savedToken === undefined) delete process.env.MODELSCOPE_API_TOKEN;
    else process.env.MODELSCOPE_API_TOKEN = savedToken;
    if (savedGemmaUrl === undefined) delete process.env.GEMMA4_IMAGE_STUDIO_URL;
    else process.env.GEMMA4_IMAGE_STUDIO_URL = savedGemmaUrl;
    jest.restoreAllMocks();
  });

  it("maps each selectable model to a different private image Studio and model repo", () => {
    const entries = Object.values(PHOTO_WEIGHT_PROFILES);
    expect(entries.map((x) => x.modelId)).toEqual(["coder", "qwen35-9b", "gemma4-e4b", "minicpmo45", "sham_v2"]);
    expect(new Set(entries.map((x) => x.modelRepo)).size).toBe(entries.length);
    expect(new Set(entries.map((x) => x.defaultEndpoint)).size).toBe(entries.length);
    expect(photoWeightProfile("gemma4-e4b")?.modelRepo).toBe("novaai2026/gemma4-realistic-vision-v6-test-models");
    expect(photoWeightProfile("qwen35-9b")?.modelRepo).toBe("novaai2026/cyberrealistic-final-test-models");
    expect(photoWeightProfile("minicpmo45")?.modelRepo).toBe("novaai2026/umranz-sd15-test-models");
    expect(photoWeightProfile("qwen35-9b")?.validationStatus).toBe("previously_passed");
    expect(photoWeightProfile("gemma4-e4b")?.validationStatus).toBe("previously_passed");
    expect(photoWeightProfile("minicpmo45")?.validationStatus).toBe("needs_retest");
    expect(photoWeightProfile("coder")?.modelRepo).toBe("novaai2026/epicrealism-image-test-models");
    expect(photoWeightProfile("sham_v2")?.modelRepo).toBe("novaai2026/realistic-vision-v6-test-models");
    expect(new Set(["qwen35-9b", "gemma4-e4b", "minicpmo45"].map((id) => photoWeightProfile(id)?.modelRepo)).size).toBe(3);
  });

  it("rejects an unknown model without making any HTTP request or trying a fallback", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const result = await makePhotoMedia("not-a-model", "A quiet street photograph", { fetchImpl });
    expect(result).toMatchObject({ type: "error", reason: "model_not_mapped" });
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
    const result = await makePhotoMedia("gemma4-e4b", "A realistic portrait of an adult woman", { fetchImpl });
    expect(result).toMatchObject({ type: "error", reason: "studio_not_ready" });
    expect(urls.length).toBe(2);
    expect(urls.every((url) => url.includes("gemma4-realistic-vision-v6-test"))).toBe(true);
    expect(urls.some((url) => url.includes("cyberrealistic") || url.includes("epicrealism") || url.includes("juggernaut"))).toBe(false);
  });

  it("uses only the selected model Studio and verifies the repo and checkpoint before returning an image", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    const profile = photoWeightProfile("gemma4-e4b")!;
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

    const result = await makePhotoMedia("gemma4-e4b", "A realistic portrait of an adult woman", { seed: 42, fetchImpl: fakeFetch });
    expect(result.type).toBe("image");
    if (result.type !== "image") throw new Error("Expected image result");
    expect(result.metadata).toMatchObject({ model_repo: profile.modelRepo, checkpoint_sha256: checksum });
    expect(Buffer.from(result.b64, "base64")).toEqual(bytes);
    expect(urls.every((url) => url.includes("gemma4-realistic-vision-v6-test"))).toBe(true);
    expect(JSON.parse(calls[2].body!).data).toEqual([
      "A realistic portrait of an adult woman", profile.negative, profile.resolution, profile.steps, profile.cfg, 42,
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
    const result = await makePhotoMedia("gemma4-e4b", "A realistic portrait of an adult woman", { fetchImpl: fakeFetch });
    expect(result).toMatchObject({ type: "error", reason: "model_identity_mismatch" });
    expect(urls.length).toBe(2);
    expect(urls.every((url) => url.includes("gemma4-realistic-vision-v6-test"))).toBe(true);
  });

  it("allows per-model endpoint overrides without changing another model's destination", () => {
    process.env.GEMMA4_IMAGE_STUDIO_URL = "off";
    expect(photoWeightEndpoint(photoWeightProfile("gemma4-e4b")!)).toBe("");
    expect(photoWeightEndpoint(photoWeightProfile("qwen35-9b")!)).toContain("cyberrealistic-final-test");
    expect(photoWeightEndpoint(photoWeightProfile("minicpmo45")!)).toContain("umranz-sd15-image-test");
  });
});
