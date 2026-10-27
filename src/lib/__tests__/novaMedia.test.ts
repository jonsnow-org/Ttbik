import { novaMakeMedia, novaMediaEnabled, parseMediaSse } from "@/lib/novaMedia";
import { b64, mp4Shell, png } from "./mediaFixtures";

describe("Nova media Studio client", () => {
  const saved = process.env.NOVA_MEDIA_STUDIO_URL;
  afterEach(() => (saved === undefined ? delete process.env.NOVA_MEDIA_STUDIO_URL : (process.env.NOVA_MEDIA_STUDIO_URL = saved)));

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
    expect(calls[0].url).toBe("https://studio.example/gradio_api/call/v2/video");
    expect(JSON.parse(JSON.parse(calls[0].body!).body)).toEqual({ prompt: "title", seconds: 2, seed: 0 });      // scenes / narration never become stills
    expect(calls[1].url).toBe("https://studio.example/gradio_api/call/video/e1");
    await novaMakeMedia("audio", "نص", { fetchImpl: fakeFetch });
    expect(calls[2].url).toBe("https://studio.example/gradio_api/call/v2/speech");
    expect(JSON.parse(JSON.parse(calls[2].body!).body)).toEqual({ text: "نص" });
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
    expect(await novaMakeMedia("image", "x", { fetchImpl: down })).toEqual({ type: "error", text: "the media Studio could not be reached" });
  });
});
