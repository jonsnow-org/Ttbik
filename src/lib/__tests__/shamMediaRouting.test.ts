import { shamGenerateMedia, shamVariant, SHAM_BACKEND_LABELS } from "@/lib/shamStudio";
import { generateShamMediaThroughRoute } from "@/lib/shamMediaRoutes";
import { b64, png, photoStudioFake } from "./mediaFixtures";

jest.mock("@/lib/shamExec", () => ({ shamMediaRoute: jest.fn(), shamMediaRouteEnabled: jest.fn(async () => true) }));
import { shamMediaRoute } from "@/lib/shamExec";

const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
function studio(reply: object) {
  const calls: { url: string; body?: any }[] = [];
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return init?.method === "POST" ? new Response(JSON.stringify({ event_id: "e1" }), { status: 200 }) : new Response(sse(reply), { status: 200 });
  });
  return calls;
}
beforeEach(() => { process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_V2_URL = "https://v2.test"; process.env.SHAM_V2_OVERFLOW_URL = "off"; process.env.SHAM_MODELSCOPE_URL = "https://v1.test"; });

describe("Sham media routing (the removed generate_media endpoint is never called)", () => {
  it("refuses a request without a selected model instead of using a shared media route", async () => {
    const calls = studio({ type: "image", b64: "never-used" });
    const r = await generateShamMediaThroughRoute("image", "a red apple");
    expect(r).toMatchObject({ type: "error", route: "unselected", reason: "model_not_selected" });
    expect(calls).toHaveLength(0);
  });
  it("internal and ready both go to generate_media_from_panel with the Studio's exact label", async () => {
    const good = b64(await png("gradient"));
    for (const backend of ["internal", "ready"] as const) {
      const calls = studio({ type: "image", b64: good });
      const r = await shamVariant.run("v1", () => shamGenerateMedia("image", "a red apple", 5000, backend));
      expect(r?.type).toBe("image");
      expect(calls[0].url).toBe("https://v1.test/gradio_api/call/v2/generate_media_from_panel");
      expect(calls[0].body).toMatchObject({ kind: "image", prompt: "a red apple", backend_label: SHAM_BACKEND_LABELS[backend] });
      expect(calls.some((c) => c.url.includes("/generate_media/") || c.url.endsWith("/generate_media"))).toBe(false);
    }
  });
  it("the Hugging Face route and any unknown backend are refused client-side with a clear error (no request is sent)", async () => {
    const calls = studio({ type: "image", b64: "x" });
    const r = await shamGenerateMedia("image", "x", 5000, "hf" as any);
    expect(r).toMatchObject({ type: "error", reason: "unknown_route" });
    expect(calls).toHaveLength(0);
  });
  it("Sham v2 images go ONLY to its own dedicated image Studio (Realistic Vision), never to the chat Studio; the route says so", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    const photo = photoStudioFake("sham_v2", [Buffer.from(b64(await png("gradient", 512)), "base64")]);
    const calls = studio({ type: "error", text: "must not be called" });
    const f = (global as any).fetch;
    (global as any).fetch = jest.fn(async (url: string, init?: any) => photo(url, init) || f(url, init));
    const r = await shamVariant.run("v2", () => generateShamMediaThroughRoute("image", "a red apple"));
    expect(r).toMatchObject({ type: "image", route: "sham_v2_photo_weight" });
    expect(photo.calls.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);                       // nothing reached the chat Studio or any other route
  });
  it("Sham v2's image Studio unreachable: an honest typed error, no silent switch to another route", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    const calls = studio({ type: "error", text: "x" });
    const r = await shamVariant.run("v2", () => generateShamMediaThroughRoute("image", "a red apple"));
    expect(r.type).toBe("error");
    expect(r.route).toBe("sham_v2_photo_weight");
    expect(r.text).toMatch(/No other model or Studio was used|No fallback/);
    expect(calls.every((c) => c.url.includes("realistic-vision"))).toBe(true);
  });
  it("on Sham v1's internal route a blank result says honestly that the internal path is still training", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v1");
    studio({ type: "image", b64: b64(await png("black", 512)) });
    const r = await shamVariant.run("v1", () => generateShamMediaThroughRoute("image", "a red apple"));
    expect(r.type).toBe("error");
    expect(r.text).toMatch(/قيد التدريب/);
  });
  it("Sham v2 video goes to Sham v2's own video Studio (generate_video), never to the chat Studio or Nova's media Studio", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.test";
    delete process.env.SHAM_V2_VIDEO_URL;
    const calls = studio({ type: "error", text: "no clip in this test" });
    await shamVariant.run("v2", () => generateShamMediaThroughRoute("video", "a red apple rotating", { seconds: 30 }));
    expect(calls[0].url).toBe("https://studio-novaai2026-sham-v2-video-server.api-inference.modelscope.net/gradio_api/call/v2/generate_video_start");
    expect(JSON.parse(calls[0].body.body)).toMatchObject({ prompt: "a red apple rotating", seconds: 30 });
    expect(calls.some((c) => c.url.includes("v2.test") || c.url.includes("nova-media") || c.url.includes("generate_media_from_panel"))).toBe(false);
  });
  it("rejects unsupported Sham v2 video durations before calling the Studio", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    const calls = studio({ type: "error", text: "must not be reached" });
    const r = await shamVariant.run("v2", () => generateShamMediaThroughRoute("video", "a test clip", { seconds: 7 }));
    expect(r).toMatchObject({ type: "error", route: "sham_v2_ready", reason: "unsupported_duration" });
    expect(calls).toHaveLength(0);
  });

  it("Sham v2 video runs as a job on its own video Studio: start, then `job` until the clip is done (a running answer is asked again)", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    delete process.env.SHAM_V2_VIDEO_URL;
    const urls: string[] = [];
    let polls = 0;
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      urls.push(url);
      if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      if (url.includes("/generate_video_start/")) return new Response(sse({ type: "job", job: "j1" }), { status: 200 });
      polls++;
      return new Response(sse(polls < 3 ? { type: "running", phase: "making video" } : { type: "error", text: "no clip in this test" }), { status: 200 });
    });
    const r = await shamVariant.run("v2", () => generateShamMediaThroughRoute("video", "a red apple rotating"));
    expect(polls).toBe(3);
    expect(r.type).toBe("error");
    expect(urls.filter((u) => u.endsWith("/v2/job"))).toHaveLength(3);
    expect(urls.some((u) => u.endsWith("/v2/generate_video"))).toBe(false);
  });
  it("an older Sham v2 video Studio without the job API still gets the single generate_video call", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    delete process.env.SHAM_V2_VIDEO_URL;
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      urls.push(url);
      if (url.endsWith("/v2/generate_video_start")) return new Response("{}", { status: 404 });
      if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      return new Response(sse({ type: "error", text: "no clip in this test" }), { status: 200 });
    });
    await shamVariant.run("v2", () => generateShamMediaThroughRoute("video", "a clip"));
    expect(urls.some((u) => u.endsWith("/v2/generate_video"))).toBe(true);
  });
  it("Sham v1 video is not rerouted (it stays on Sham v1's own Studio)", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v1");
    const c2 = studio({ type: "error", text: "x" });
    await shamVariant.run("v1", () => generateShamMediaThroughRoute("video", "a clip"));
    expect(c2[0].url).toBe("https://v1.test/gradio_api/call/v2/generate_media_from_panel");
  });
});
