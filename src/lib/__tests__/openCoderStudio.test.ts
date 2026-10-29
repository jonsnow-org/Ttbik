import { parseCoderSse, parseStatusSse, readCoderSse } from "@/lib/openCoderStudio";

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
});
