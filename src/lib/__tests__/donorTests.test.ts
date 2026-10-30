import { donorTestChat, probeDonorTestStudio } from "@/lib/donorTests";

describe("donor candidate Telegram transport", () => {
  const complete = (payload: object) =>
    "event: complete\ndata: [" + JSON.stringify(JSON.stringify(payload)) + "]\n\n";

  it("sends image/audio/video payloads only to the selected private Studio chat_payload endpoint", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-modelscope-token";
    const calls: { url: string; method: string; body?: any }[] = [];
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/gradio_api/call/chat_payload") && method === "POST") {
        return new Response(JSON.stringify({ event_id: "payload-event" }), { status: 200 });
      }
      if (url.endsWith("/gradio_api/call/chat_payload/payload-event")) {
        return new Response(complete({
          text: "تم استلام المرفق",
          tool_calls: [],
          executed_tools: [{ name: "github_repo_scan", arguments: { repo: "public/example" }, result: { ok: true, count: 1, files: [{ name: "README.md" }] } }],
          seconds: 0.1,
          tokens_per_second: 8,
        }), { status: 200 });
      }
      return new Response("unexpected request", { status: 500 });
    }) as any;

    const media = {
      kind: "image" as const,
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
      format: "jpeg",
    };
    const result = await donorTestChat(
      "qwen35-9b",
      "صف هذه الصورة",
      [],
      media,
      fetchImpl,
    );

    expect(result.text).toBe("تم استلام المرفق");
    expect(result.executed_tools).toEqual([
      { name: "github_repo_scan", arguments: { repo: "public/example" }, result: { ok: true, count: 1, files: [{ name: "README.md" }] } },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("studio-novaai2026-sham-donor-qwen35-9b-test.api-inference.modelscope.net");
    expect(calls[0].url).toContain("/gradio_api/call/chat_payload");
    const payload = JSON.parse(calls[0].body.data[0]);
    expect(payload.media).toEqual(media);
    expect(payload.prompt).toBe("صف هذه الصورة");
    expect(calls.every((call) => !call.url.includes("coder.test"))).toBe(true);
  });
});


describe("donor Studio readiness probe", () => {
  it("uses Gradio's direct run endpoint for queue-disabled status and exposes runtime media flags", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    process.env.MODELSCOPE_API_TOKEN = "test-modelscope-token";
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/openapi/v1/studios/novaai2026/sham-donor-qwen35-9b-test")) {
        return new Response(JSON.stringify({
          data: { runtime: { status: "Running" } },
        }), { status: 200 });
      }
      if (url.endsWith("/gradio_api/run/status") && init?.method === "POST") {
        return new Response(JSON.stringify({
          data: [JSON.stringify({
            phase: "ready",
            app_revision: "donor-bakeoff-2026-10-30-r8",
            media_capabilities: { vision: true, audio: false, video: true },
            error: null,
          })],
        }), { status: 200 });
      }
      return new Response("unexpected readiness request", { status: 500 });
    }) as any;
    try {
      const status = await probeDonorTestStudio("qwen35-9b", fetchImpl);
      expect(status.phase).toBe("ready");
      expect(status.studio).toBe("running");
      expect(status.media_capabilities).toEqual({ vision: true, audio: false, video: true });
      expect(calls.some((url) => url.endsWith("/gradio_api/run/status"))).toBe(true);
      expect(calls.some((url) => url.includes("/gradio_api/call/status"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });
  it("does not report an old isolated runner revision as ready for bot testing", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-modelscope-token";
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith("/openapi/v1/studios/novaai2026/sham-donor-qwen35-9b-test")) {
        return new Response(JSON.stringify({ data: { runtime: { status: "Running" } } }), { status: 200 });
      }
      if (url.endsWith("/gradio_api/run/status") && init?.method === "POST") {
        return new Response(JSON.stringify({
          data: [JSON.stringify({
            phase: "ready",
            app_revision: "donor-bakeoff-2026-10-30-r6",
            media_capabilities: { vision: true, audio: false, video: true },
          })],
        }), { status: 200 });
      }
      return new Response("unexpected readiness request", { status: 500 });
    }) as any;
    const status = await probeDonorTestStudio("qwen35-9b", fetchImpl);
    expect(status.phase).toBe("deploying");
    expect(status.studio).toBe("deploying");
    expect(status.detail).toContain("تحديث مشغّل");
  });

});
