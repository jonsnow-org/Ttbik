import { donorTestChat } from "@/lib/donorTests";

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
        return new Response(complete({ text: "تم استلام المرفق", tool_calls: [], seconds: 0.1, tokens_per_second: 8 }), { status: 200 });
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
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("studio-novaai2026-sham-donor-qwen35-9b-test.api-inference.modelscope.net");
    expect(calls[0].url).toContain("/gradio_api/call/chat_payload");
    const payload = JSON.parse(calls[0].body.data[0]);
    expect(payload.media).toEqual(media);
    expect(payload.prompt).toBe("صف هذه الصورة");
    expect(calls.every((call) => !call.url.includes("coder.test"))).toBe(true);
  });
});
