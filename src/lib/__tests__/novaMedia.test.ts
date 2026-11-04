import { novaMakeMedia, novaMediaEnabled, parseMediaSse } from "@/lib/novaMedia";
import { b64, mp4Shell, png } from "./mediaFixtures";

describe("Nova media Studio client", () => {
  const saved = process.env.NOVA_MEDIA_STUDIO_URL;
  afterEach(() => (saved === undefined ? delete process.env.NOVA_MEDIA_STUDIO_URL : (process.env.NOVA_MEDIA_STUDIO_URL = saved)));

  it("asks again after a gateway 429 on submit (no job was created) and then succeeds", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
    process.env.NOVA_MEDIA_SUBMIT_WAITS_MS = "1,1";
    let submits = 0;
    const f = (async (_url: string, init?: { body?: string }) => {
      if (init?.body) return ++submits === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ event_id: "e1" }) };
      return { ok: true, text: async () => `data: ["{\\"type\\":\\"audio\\",\\"b64\\":\\"QUJD\\"}"]\n` };
    }) as unknown as typeof fetch;
    try {
      const r = await novaMakeMedia("audio", "hello", { fetchImpl: f });
      expect(submits).toBe(2);
      expect(JSON.stringify(r)).not.toContain("HTTP 429");      // the retry reached the result stage (the fake clip itself may fail vetting)
    } finally {
      delete process.env.NOVA_MEDIA_SUBMIT_WAITS_MS;
    }
  });
  it("is off without its URL and returns nothing", async () => {
    delete process.env.NOVA_MEDIA_STUDIO_URL;
    expect(novaMediaEnabled()).toBe(false);
    expect(await novaMakeMedia("image", "a robot")).toBeNull();
  });
  it("reads the one SSE data line (a JSON string inside a list)", () => {
    expect(parseMediaSse(`event: complete\ndata: ["{\\"type\\":\\"image\\",\\"b64\\":\\"QUJD\\"}"]\n\n`)).toEqual({ type: "image", b64: "QUJD" });
    expect(parseMediaSse("event: error\ndata: null\n")).toBeNull();
  });
  it("sends the right call for each kind and returns the Studio's answer (video = ONE prompt, the contract of modelscope-media api_video)", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example/";
    const calls: { url: string; body?: string }[] = [];
    const fakeFetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body });
      if (init?.body) return { ok: true, json: async () => ({ event_id: "e1" }) };
      return { ok: true, text: async () => `data: ["{\\"type\\":\\"video\\",\\"b64\\":\\"${b64(mp4Shell())}\\"}"]\n` };
    }) as unknown as typeof fetch;
    const r = await novaMakeMedia("video", "title", { scenes: ["a cat", "a dog", ""], narration: "مرحبا", fetchImpl: fakeFetch });
    expect(r).toEqual({ type: "video", b64: b64(mp4Shell()) });
    expect(calls[0].url).toBe("https://studio.example/gradio_api/call/v2/video_start");     // a clip is a background job on the Studio
    expect(JSON.parse(JSON.parse(calls[0].body!).body)).toEqual({ prompt: "title", seconds: 10, seed: 0 });      // scenes / narration never become stills
    expect(calls[1].url).toBe("https://studio.example/gradio_api/call/video_start/e1");
    await novaMakeMedia("audio", "نص", { fetchImpl: fakeFetch });
    expect(calls[2].url).toBe("https://studio.example/gradio_api/call/v2/speech");
    expect(JSON.parse(JSON.parse(calls[2].body!).body)).toEqual({ text: "نص" });
  });
  it("preserves the requested 60-second video duration in the Studio payload", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
    const bodies: any[] = [];
    const f = (async (_url: string, init?: { body?: string }) => {
      if (init?.body) {
        bodies.push(JSON.parse(JSON.parse(init.body).body));
        return { ok: true, json: async () => ({ event_id: "e1" }) };
      }
      const value = { type: "video", b64: b64(mp4Shell()) };
      return { ok: true, text: async () => "data: " + JSON.stringify([JSON.stringify(value)]) + "\n" };
    }) as unknown as typeof fetch;
    await novaMakeMedia("video", "a horse galloping", { seconds: 60, fetchImpl: f });
    expect(bodies[0]).toMatchObject({ prompt: "a horse galloping", seconds: 60 });
  });
  it("raw owner test mode passes a decodable blank picture through the same Nova Studio", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
    const blank = b64(await png("black", 512));
    const f = (async (_u: string, init?: { body?: string }) => {
      if (init?.body) return { ok: true, json: async () => ({ event_id: "e" }) };
      const value = { type: "image", b64: blank };
      return { ok: true, text: async () => "event: complete\ndata: " + JSON.stringify([JSON.stringify(value)]) + "\n\n" };
    }) as unknown as typeof fetch;
    const r = await novaMakeMedia("image", "a robot", { fetchImpl: f, attempts: 1, bypassContentHeuristics: true });
    expect(r).toMatchObject({ type: "image", b64: blank });
  });
  it("a blank picture from the Studio is returned as a typed error, never as an image", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
    const blank = b64(await png("black", 512));
    const f = (async (_u: string, init?: { body?: string }) => (init?.body ? { ok: true, json: async () => ({ event_id: "e" }) } : { ok: true, text: async () => `data: ["{\\"type\\":\\"image\\",\\"b64\\":\\"${blank}\\"}"]\n` })) as unknown as typeof fetch;
    const r = await novaMakeMedia("image", "a robot", { fetchImpl: f });
    expect(r).toMatchObject({ type: "error", reason: "blank_image" });
    expect(r?.b64).toBeUndefined();
  });
  it("says what went wrong instead of throwing", async () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
    const down = (async () => { throw Object.assign(new Error("x"), { name: "TypeError" }); }) as unknown as typeof fetch;
    expect(await novaMakeMedia("image", "x", { fetchImpl: down })).toEqual({ type: "error", reason: "studio_unreachable", text: "تعذّر الوصول إلى استوديو الوسائط" });
  });

  describe("video as a background job (2026-11-04: one long read was cut and the Studio stalled)", () => {
    const sse = (v: unknown) => ({ ok: true, status: 200, text: async () => "data: " + JSON.stringify([JSON.stringify(v)]) + "\n" });
    it("starts the job, asks `job` until it is done, and vets the clip", async () => {
      process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
      const seen: string[] = [];
      let polls = 0;
      const f = (async (url: string, init?: { body?: string }) => {
        if (init?.body) { seen.push(url.split("/").pop()!); return { ok: true, status: 200, json: async () => ({ event_id: "e" + seen.length }) }; }
        if (url.includes("/video_start/")) return sse({ type: "job", job: "j1" });
        polls++;
        if (polls === 2) return { ok: false, status: 502, text: async () => "" };          // a cut poll: the job goes on
        return sse(polls < 4 ? { type: "running", phase: "making video" } : { type: "video", b64: b64(mp4Shell()) });
      }) as unknown as typeof fetch;
      const r = await novaMakeMedia("video", "a girl dancing", { seconds: 6, fetchImpl: f });
      expect(r).toEqual({ type: "video", b64: b64(mp4Shell()) });
      expect(seen[0]).toBe("video_start");
      expect(seen.slice(1).every((x) => x === "job")).toBe(true);
      expect(polls).toBe(4);
    });
    it("a restarted Studio (job_lost) is an Arabic error, never a picture", async () => {
      process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
      const f = (async (url: string, init?: { body?: string }) => {
        if (init?.body) return { ok: true, status: 200, json: async () => ({ event_id: "e" }) };
        return url.includes("/video_start/") ? sse({ type: "job", job: "j1" }) : sse({ type: "error", reason: "job_lost", text: "x" });
      }) as unknown as typeof fetch;
      const r = await novaMakeMedia("video", "a cat", { seconds: 6, fetchImpl: f });
      expect(r).toMatchObject({ type: "error", reason: "studio_job_lost" });
      expect(r?.text).toMatch(/[\u0600-\u06FF]/);
    });
    it("returns a video_start HTTP 500 instead of silently falling back to the memory-heavy synchronous API", async () => {
      process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
      const urls: string[] = [];
      const f = (async (url: string, init?: { body?: string }) => {
        urls.push(url);
        if (init?.body) return { ok: false, status: 500, text: async () => "internal video worker failure" };
        return sse({ type: "video", b64: b64(mp4Shell()) });
      }) as unknown as typeof fetch;
      const r = await novaMakeMedia("video", "a girl playing in a garden", { seconds: 6, fetchImpl: f });
      expect(r).toMatchObject({ type: "error", reason: "studio_http_500", text: "استوديو الوسائط رد بخطأ (500)" });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe("https://studio.example/gradio_api/call/v2/video_start");
      expect(urls.some((url) => url.endsWith("/v2/video"))).toBe(false);
    });
    it("an older Studio without the job API (404) still gets the single call", async () => {
      process.env.NOVA_MEDIA_STUDIO_URL = "https://studio.example";
      const urls: string[] = [];
      const f = (async (url: string, init?: { body?: string }) => {
        urls.push(url);
        if (url.endsWith("/v2/video_start")) return { ok: false, status: 404, json: async () => ({}) };
        if (init?.body) return { ok: true, status: 200, json: async () => ({ event_id: "e" }) };
        return sse({ type: "video", b64: b64(mp4Shell()) });
      }) as unknown as typeof fetch;
      const r = await novaMakeMedia("video", "a cat", { seconds: 6, fetchImpl: f });
      expect(r).toMatchObject({ type: "video" });
      expect(urls).toContain("https://studio.example/gradio_api/call/v2/video");
    });
  });
});
