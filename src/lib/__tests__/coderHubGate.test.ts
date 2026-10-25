// The hub refuses bursts (measured: 6 calls at once -> 1 refused, 10 -> 5, 10-20 over five Studios -> all refused): every request to a Studio goes through one gate,
// and a 429 is asked again after a short pause instead of ending the step.
import { coderCall } from "@/lib/openCoderStudio";

const ok = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

describe("hub request gate", () => {
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = "https://s1.test";
    delete process.env.OPEN_CODER_STUDIO_URLS;
    process.env.MODELSCOPE_API_TOKEN = "ms";
    process.env.CODER_HUB_CONCURRENCY = "3";
  });
  afterEach(() => { delete process.env.CODER_HUB_CONCURRENCY; });

  it("never more than 3 requests at once, however many calls are made together", async () => {
    let live = 0, peak = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 15));
      live--;
      if (url.includes("/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      return new Response(ok({ type: "done", text: "hi", job: "j" }), { status: 200 });
    });
    const outs = await Promise.all(Array.from({ length: 12 }, () => coderCall("job_result", { job_id: "j", offset: 0 }, 5000)));
    expect(outs.every((o) => o.reply?.type === "done")).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("a 429 is asked again and the call succeeds", async () => {
    let submits = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes("/call/v2/")) {
        submits++;
        return submits < 3 ? new Response('{"error":{"message":"Request limit exceeded."}}', { status: 429 }) : new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      }
      return new Response(ok({ type: "done", text: "ok", job: "j" }), { status: 200 });
    });
    const o = await coderCall("job_result", { job_id: "j", offset: 0 }, 5000);
    expect(o.reply?.type).toBe("done");
    expect(submits).toBe(3);
  });

  it("a 429 that does not go away is reported as such (the caller's own pause takes over)", async () => {
    (global as any).fetch = jest.fn(async () => new Response('{"error":{"message":"Request limit exceeded."}}', { status: 429 }));
    const o = await coderCall("job_result", { job_id: "j", offset: 0 }, 5000);
    expect(o.reply).toBeNull();
    expect(o.status).toBe(429);
  });
});
