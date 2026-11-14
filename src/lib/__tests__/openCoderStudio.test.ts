import { coderEnabled, coderStudioUrls, parseCoderSse, parseStatusSse, readCoderSse } from "@/lib/openCoderStudio";
import { readMediaSse } from "@/lib/novaMedia";

describe("Nova Studio availability", () => {
  it("stays enabled when its primary URL is absent but a valid replica is configured", () => {
    const saved = {
      primary: process.env.OPEN_CODER_STUDIO_URL,
      replicas: process.env.OPEN_CODER_STUDIO_URLS,
      lfm: process.env.LFM_STUDIO_URLS,
    };
    process.env.OPEN_CODER_STUDIO_URL = "";
    process.env.OPEN_CODER_STUDIO_URLS = "https://studio-test-coder-inference-server-2.api-inference.modelscope.net";
    process.env.LFM_STUDIO_URLS = "off";
    try {
      expect(coderStudioUrls()).toHaveLength(1);
      expect(coderEnabled()).toBe(true);
    } finally {
      if (saved.primary === undefined) delete process.env.OPEN_CODER_STUDIO_URL;
      else process.env.OPEN_CODER_STUDIO_URL = saved.primary;
      if (saved.replicas === undefined) delete process.env.OPEN_CODER_STUDIO_URLS;
      else process.env.OPEN_CODER_STUDIO_URLS = saved.replicas;
      if (saved.lfm === undefined) delete process.env.LFM_STUDIO_URLS;
      else process.env.LFM_STUDIO_URLS = saved.lfm;
    }
  });
});

describe("Nova Studio SSE streaming", () => {
  it("returns a completion as soon as its data line arrives, without waiting for EOF", async () => {
    const encoder = new TextEncoder();
    const line = `data: ${JSON.stringify([JSON.stringify({ type: "text", text: "رد وصل عبر التدفق" })])}\n`;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: generating\n"));
        controller.enqueue(encoder.encode(line.slice(0, 17)));
        controller.enqueue(encoder.encode(line.slice(17)));
        // Deliberately leave the stream open after the answer line.
      },
      cancel() { cancelled = true; },
    });
    const response = {
      body,
      text: async () => { throw new Error("must not wait for EOF"); },
    } as unknown as Response;

    await expect(readCoderSse(response, parseCoderSse)).resolves.toEqual({ type: "text", text: "رد وصل عبر التدفق" });
    expect(cancelled).toBe(true);
  });

  it("reads the Studio queue/status data before the status stream closes", async () => {
    const encoder = new TextEncoder();
    const line = `data: ${JSON.stringify([JSON.stringify({ phase: "ready", queue: 0, model: "test" })])}\n`;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(line));
      },
      cancel() { cancelled = true; },
    });
    const response = {
      body,
      text: async () => { throw new Error("must not wait for EOF"); },
    } as unknown as Response;

    await expect(readCoderSse(response, parseStatusSse)).resolves.toMatchObject({ phase: "ready", queue: 0, model: "test" });
    expect(cancelled).toBe(true);
  });
  it("returns a Nova media payload before the still-open Studio stream reaches EOF", async () => {
    const encoder = new TextEncoder();
    const line = `data: ${JSON.stringify([JSON.stringify({ type: "audio", b64: "QUJD" })])}\n`;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(line));
      },
      cancel() { cancelled = true; },
    });
    const response = {
      body,
      text: async () => { throw new Error("must not wait for EOF"); },
    } as unknown as Response;

    await expect(readMediaSse(response)).resolves.toEqual({ type: "audio", b64: "QUJD" });
    expect(cancelled).toBe(true);
  });

});

describe("unwrapJsonAnswer", () => {
  const { unwrapJsonAnswer } = require("@/lib/openCoderStudio");
  test("unwraps a whole-message JSON object, leaves everything else", () => {
    expect(unwrapJsonAnswer('{\n "role": "system",\n "content": "I can create images."\n}')).toBe("I can create images.");
    expect(unwrapJsonAnswer('{"reflection":"ok"}')).toBe("ok");
    expect(unwrapJsonAnswer('{"reflection":["one"," two "]}')).toBe("one\ntwo");
    expect(unwrapJsonAnswer('{"reflection":[1,2]}')).toBe('{"reflection":[1,2]}');
    expect(unwrapJsonAnswer('{"name":"web_search","arguments":{}}')).toBe('{"name":"web_search","arguments":{}}');
    expect(unwrapJsonAnswer("hello {x}")).toBe("hello {x}");
    expect(unwrapJsonAnswer("{not json}")).toBe("{not json}");
  });
});
