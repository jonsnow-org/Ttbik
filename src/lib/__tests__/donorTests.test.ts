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
          generated_media: [{ kind: "image", mime: "image/png", b64: "aGVsbG8=", metadata: { result: "image_generated" }, candidate: "qwen35-9b", model_repo: "novaai2026/cyberrealistic-final-test-models", checkpoint_sha256: "a".repeat(64) }],
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
    expect(result.generated_media).toHaveLength(1);
    expect(result.generated_media[0]).toMatchObject({ candidate: "qwen35-9b", model_repo: "novaai2026/cyberrealistic-final-test-models" });
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
            app_revision: "donor-bakeoff-2026-11-01-r15",
            media_capabilities: { vision: true, audio: false, video: true },
            runtime_generation_capabilities: { image: true, audio: false, video: false },
            image_generation_assignment: {
              for_candidate: "qwen35-9b",
              model_repo: "novaai2026/cyberrealistic-final-test-models",
              studio_api: "https://studio-novaai2026-cyberrealistic-final-test.api-inference.modelscope.net",
            },
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
      expect(status.image_generation).toMatchObject({ enabled: true, candidate: "qwen35-9b", model_repo: "novaai2026/cyberrealistic-final-test-models" });
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

describe("donor background jobs", () => {
  it("starts a job and reads its state with short polls", async () => {
    process.env.MODELSCOPE_API_TOKEN = "test-modelscope-token";
    const { donorJobPoll } = await import("@/lib/donorTests");
    const answers = [
      { state: "running" },
      { state: "done", result: JSON.stringify({ text: "تم", tool_calls: [] }) },
      { state: "unknown" },
    ];
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ data: [JSON.stringify(answers.shift())] }), { status: 200 })) as any;
    expect((await donorJobPoll("qwen35-9b", "j", fetchImpl)).state).toBe("running");
    const done = await donorJobPoll("qwen35-9b", "j", fetchImpl);
    expect(done.state === "done" && done.result.text).toBe("تم");
    expect((await donorJobPoll("qwen35-9b", "j", fetchImpl)).state).toBe("unknown");
  });
});
