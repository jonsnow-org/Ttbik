import { parseStudioStatusSse, probeStudio } from "@/lib/mediaEngines";

const sse = (value: object) => "event: complete\ndata: [" + JSON.stringify(JSON.stringify(value)) + "]\n\n";

describe("media Studio modality readiness", () => {
  const fakeFetch = (status: object) => jest.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/gradio_api/call/v2/status") && init?.method === "POST") {
      return new Response(JSON.stringify({ event_id: "status-1" }), { status: 200 });
    }
    if (url.endsWith("/gradio_api/call/status/status-1")) {
      return new Response(sse(status), { status: 200 });
    }
    return new Response("unexpected request", { status: 500 });
  }) as any;


  it("ignores progress and heartbeat data and parses only the completed status event", async () => {
    const body = [
      "event: heartbeat\ndata: null\n\n",
      "event: generating\ndata: " + JSON.stringify({ phase: "loading" }) + "\n\n",
      "event: complete\ndata: " + JSON.stringify([JSON.stringify({ phase: "ready", model: "novaai2026/test" })]) + "\n\n",
    ].join("");
    expect(parseStudioStatusSse(body)).toMatchObject({ phase: "ready", model: "novaai2026/test" });
  });

  it("refuses an incomplete or malformed Gradio status stream", () => {
    expect(() => parseStudioStatusSse("event: heartbeat\ndata: null\n\n")).toThrow("no completed");
    expect(() => parseStudioStatusSse("event: complete\ndata: not-json\n\n")).toThrow("invalid JSON");
    expect(() => parseStudioStatusSse("event: error\ndata: failed\n\n")).toThrow("error event");
  });

  it("does not mark video ready while its local weights are absent", async () => {
    const result = await probeStudio("https://media.test", "token", fakeFetch({ phase: "ready", video: { ready: false } }), 7000, true);
    expect(result).toMatchObject({ ok: false, phase: "video_weights_missing", media: { image: true, audio: true, video: false } });
  });

  it("marks video ready only when the Studio reports its video weights loaded", async () => {
    const result = await probeStudio("https://media.test", "token", fakeFetch({ phase: "ready", video: { ready: true } }), 7000, true);
    expect(result).toMatchObject({ ok: true, phase: "ready", media: { image: true, audio: true, video: true } });
  });

  it("keeps image and speech readiness distinct from video readiness when video is not required", async () => {
    const result = await probeStudio("https://media.test", "token", fakeFetch({ phase: "ready", video: { ready: false } }));
    expect(result).toMatchObject({ ok: true, phase: "ready", media: { image: true, audio: true, video: false } });
  });
});