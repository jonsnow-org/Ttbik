import { shamGenerateMedia, SHAM_BACKEND_LABELS } from "@/lib/shamStudio";
import { generateShamMediaThroughRoute } from "@/lib/shamMediaRoutes";
import { b64, png } from "./mediaFixtures";

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
  it("internal and ready both go to generate_media_from_panel with the Studio's exact label", async () => {
    const good = b64(await png("gradient"));
    for (const backend of ["internal", "ready"] as const) {
      const calls = studio({ type: "image", b64: good });
      const r = await shamGenerateMedia("image", "a red apple", 5000, backend);
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
  it("sham_v2_ready runs on the v2 Studio, SDXS path; the typed reason of a refused (black) picture is kept and nothing is switched silently", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    const calls = studio({ type: "image", b64: b64(await png("black", 512)), backend: "ready" });
    const r = await generateShamMediaThroughRoute("image", "a red apple");
    expect(calls[0].url).toBe("https://v2.test/gradio_api/call/v2/generate_media_from_panel");
    expect(calls[0].body.backend_label).toBe(SHAM_BACKEND_LABELS.ready);
    expect(r).toMatchObject({ type: "error", route: "sham_v2_ready", reason: "blank_image" });
    expect(r.b64).toBeUndefined();
    expect(calls).toHaveLength(2);                       // one submit + one result: no retry on another route
  });
  it("on the internal route a blank result says honestly that the internal path is still training and points to the ready route", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_internal");
    studio({ type: "image", b64: b64(await png("black", 512)) });
    const r = await generateShamMediaThroughRoute("image", "a red apple");
    expect(r.type).toBe("error");
    expect(r.text).toMatch(/قيد التدريب/);
    expect(r.text).toMatch(/المسار الجاهز/);
  });
  it("Sham v2 video goes to Sham v2's own video Studio (generate_video), never to the chat Studio or Nova's media Studio", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.test";
    delete process.env.SHAM_V2_VIDEO_URL;
    const calls = studio({ type: "error", text: "no clip in this test" });
    await generateShamMediaThroughRoute("video", "a red apple rotating");
    expect(calls[0].url).toBe("https://studio-novaai2026-sham-v2-video-server.api-inference.modelscope.net/gradio_api/call/v2/generate_video");
    expect(JSON.parse(calls[0].body.body)).toMatchObject({ prompt: "a red apple rotating" });
    expect(calls.some((c) => c.url.includes("v2.test") || c.url.includes("nova-media") || c.url.includes("generate_media_from_panel"))).toBe(false);
  });
  it("Sham v2 image and speech stay on the chat Studio; Sham v1 video is not rerouted", async () => {
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v2_ready");
    const good = b64(await png("gradient"));
    const calls = studio({ type: "image", b64: good });
    await generateShamMediaThroughRoute("image", "a red apple");
    expect(calls[0].url).toBe("https://v2.test/gradio_api/call/v2/generate_media_from_panel");
    (shamMediaRoute as jest.Mock).mockResolvedValue("sham_v1");
    const c2 = studio({ type: "error", text: "x" });
    await generateShamMediaThroughRoute("video", "a clip");
    expect(c2[0].url).toBe("https://v1.test/gradio_api/call/v2/generate_media_from_panel");
  });
});
