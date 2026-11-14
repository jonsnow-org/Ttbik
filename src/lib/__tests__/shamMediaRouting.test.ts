import { shamGenerateMedia, shamVariant, SHAM_BACKEND_LABELS } from "@/lib/shamStudio";
import { generateShamMediaThroughRoute, shamVideoDeadlineMs } from "@/lib/shamMediaRoutes";
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
  it("allocates a duration-aware budget for long CPU videos", () => {
    expect(shamVideoDeadlineMs(6)).toBe(540_000);
    expect(shamVideoDeadlineMs(10)).toBe(750_000);
    expect(shamVideoDeadlineMs(30)).toBe(1_800_000);
    expect(shamVideoDeadlineMs(60)).toBe(3_270_000);
    expect(shamVideoDeadlineMs(120)).toBe(6_420_000);
  });
  it("refuses a request without a selected model instead of using a shared media route", async () => {
    const calls = studio({ type: "image", b64: "never-used" });
    const r = await generateShamMediaThroughRoute("image", "a red apple");
    expect(r).toMatchObject({ type: "error", route: "unselected", reason: "model_not_selected" });
    expect(calls).toHaveLength(0);
  });
  it("internal goes to generate_media_from_panel with the Studio's exact label; the old ready backend is refused client-side", async () => {
    const good = b64(await png("gradient"));
    for (const backend of ["internal"] as const) {
      const calls = studio({ type: "image", b64: good });
      const r = await shamVariant.run("v1", () => shamGenerateMedia("image", "a red apple", 5000, backend));
      expect(r?.type).toBe("image");
      expect(calls[0].url).toBe("https://v1.test/gradio_api/call/v2/generate_media_from_panel");
      expect(calls[0].body).toMatchObject({ kind: "image", prompt: "a red apple", backend_label: SHAM_BACKEND_LABELS[backend] });
      expect(calls.some((c) => c.url.includes("/generate_media/") || c.url.endsWith("/generate_media"))).toBe(false);
    }
  });
  it("the removed ready (donor weights) backend is refused client-side too", async () => {
    const calls = studio({ type: "image", b64: "x" });
    const r = await shamGenerateMedia("image", "x", 5000, "ready" as any);
    expect(r).toMatchObject({ type: "error", reason: "unknown_route" });
    expect(calls).toHaveLength(0);
  });
  it("the Hugging Face route and any unknown backend are refused client-side with a clear error (no request is sent)", async () => {
    const calls = studio({ type: "image", b64: "x" });
    const r = await shamGenerateMedia("image", "x", 5000, "hf" as any);
    expect(r).toMatchObject({ type: "error", reason: "unknown_route" });
    expect(calls).toHaveLength(0);
  });
  it("on Sham v1's internal route a blank result says honestly that the internal path is still training", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v1");
    studio({ type: "image", b64: b64(await png("black", 512)) });
    const r = await shamVariant.run("v1", () => generateShamMediaThroughRoute("image", "a red apple"));
    expect(r.type).toBe("error");
    expect(r.text).toMatch(/قيد التدريب/);
  });
  it("Sham v2 makes image and video with its OWN internal generator (same endpoint as v1), never a donor/photo/video Studio or Nova's", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_internal");
    process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.test";
    delete process.env.SHAM_V2_VIDEO_URL;
    for (const kind of ["image", "video"] as const) {
      const calls = studio({ type: "error", text: "no media in this test" });
      await shamVariant.run("v2", () => generateShamMediaThroughRoute(kind, "a red apple rotating", { seconds: 30 }));
      expect(calls[0].url).toBe("https://v2.test/gradio_api/call/v2/generate_media_from_panel");
      expect(calls[0].body).toMatchObject({ kind, backend_label: SHAM_BACKEND_LABELS.internal });
      expect(calls.some((c) => /realistic-vision|video-server|nova-media|generate_video/.test(c.url))).toBe(false);
    }
  });
  it("Sham v1 video is not rerouted (it stays on Sham v1's own Studio)", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v1");
    const c2 = studio({ type: "error", text: "x" });
    await shamVariant.run("v1", () => generateShamMediaThroughRoute("video", "a clip"));
    expect(c2[0].url).toBe("https://v1.test/gradio_api/call/v2/generate_media_from_panel");
  });
});
