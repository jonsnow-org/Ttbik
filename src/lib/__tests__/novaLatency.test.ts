// Executable proof of the Nova first-byte change (src/lib/coderSections.ts + src/lib/openCoderStudio.ts).
//
// It calls the REAL functions, not a copy: novaFirstByteWaitS / novaFirstByteCap / novaSubmitTimeoutMs (the policy the
// Telegram loop uses) and coderChat / coderJobResult (the real request builder + poller) against a fake fetch standing in
// for the Studio. No network, no token. Run:
//   cd athar && npx jest --config ../jest.media.config.js --rootDir .. --runInBand src/lib/__tests__/novaLatency.test.ts
import { novaFirstByteCap, novaFirstByteWaitS, novaSubmitTimeoutMs } from "@/lib/coderSections";
import { coderChat, coderJobResult, fitWait } from "@/lib/openCoderStudio";

const realFetch = global.fetch;
const sse = (o: unknown) => new Response(`data: ${JSON.stringify([JSON.stringify(o)])}\n`);

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.OPEN_CODER_STUDIO_URL;
  delete process.env.OPEN_CODER_STUDIO_URLS;
  delete process.env.NOVA2_STUDIO_URLS;
  delete process.env.NOVA2_STUDIO_TOKEN;
  delete process.env.CODER_FIRST_BYTE_WAIT_S;
});

describe("Nova first-byte policy (the real functions in coderSections)", () => {
  it("is on by default: a step asks for wait_s 4, never the old 20", () => {
    // A run with plenty of budget: the cap alone decides.
    expect(novaFirstByteCap()).toBe(4);
    expect(novaFirstByteWaitS(600000)).toBe(4);
    expect(novaFirstByteWaitS(600000)).toBeLessThan(20);
    // Little time left shrinks it, never below 1 s.
    expect(novaFirstByteWaitS(15000)).toBe(3);
    expect(novaFirstByteWaitS(13000)).toBe(1);
    expect(novaFirstByteWaitS(0)).toBe(1);
    // The cap is a setting with a working default, not a disabled option.
    process.env.CODER_FIRST_BYTE_WAIT_S = "2";
    expect(novaFirstByteWaitS(600000)).toBe(2);
    process.env.CODER_FIRST_BYTE_WAIT_S = "30";
    expect(novaFirstByteCap()).toBe(20);
  });

  it("keeps a 30 s floor on the submit and on the T-LDM head, so a cold Studio is never cut off", () => {
    expect(novaSubmitTimeoutMs(4)).toBe(30000);
    expect(novaSubmitTimeoutMs(1)).toBe(30000);
    expect(novaSubmitTimeoutMs(30)).toBe(39000);
    // The wait the Studio is given stays inside the attempt's own time (a job nobody can poll is never created).
    expect(fitWait({ wait_s: 4 }, novaSubmitTimeoutMs(4)).wait_s).toBe(4);
    expect(fitWait({ wait_s: 4 }, 10000).wait_s).toBe(2);
  });
});

describe("Nova: the request body carries the new wait_s", () => {
  it("coderChat sends wait_s = novaFirstByteWaitS(...) and one chat submission", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://nova.example";
    const bodies: { wait_s?: number }[] = [];
    let chatPosts = 0;
    global.fetch = (async (u: unknown, init?: { body?: string }) => {
      const url = String(u);
      if (url.includes("/call/v2/chat")) {
        chatPosts++;
        bodies.push(JSON.parse(String(init?.body || "{}")));
        return Response.json({ event_id: "e1" });
      }
      if (url.includes("/call/chat/e1")) return sse({ type: "pending", job: "j1", text: "Hello", total: 5, status: "running" });
      if (url.includes("/status")) return Response.json({});
      throw new Error("unexpected URL " + url);
    }) as typeof fetch;

    const o = await coderChat([{ role: "user", content: "hi" }], { waitS: novaFirstByteWaitS(600000), timeoutMs: novaSubmitTimeoutMs(4) });
    expect(bodies.length).toBe(1);
    expect(bodies[0].wait_s).toBe(4);
    expect(chatPosts).toBe(1);
    expect(o.reply?.job).toBe("j1");
    // The first bytes arrive while the job is still running.
    expect(o.reply?.text).toBe("Hello");
  });
});

describe("Nova: pending → polling streams growing text, no duplicate job", () => {
  it("a poll returns the text grown so far; the chat is submitted once", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://nova.example";
    let chatPosts = 0;
    let polls = 0;
    global.fetch = (async (u: unknown) => {
      const url = String(u);
      if (url.includes("/call/v2/chat")) { chatPosts++; return Response.json({ event_id: "e1" }); }
      if (url.includes("/call/v2/job_result")) return Response.json({ event_id: "e2" });
      if (url.includes("/call/job_result/e2")) {
        polls++;
        return sse({ type: "pending", job: "j1", text: polls === 1 ? "Hello" : "Hello world", total: polls === 1 ? 5 : 11, status: "running" });
      }
      if (url.includes("/call/chat/e1")) return sse({ type: "pending", job: "j1", text: "Hello", total: 5, status: "running" });
      if (url.includes("/status")) return Response.json({});
      throw new Error("unexpected URL " + url);
    }) as typeof fetch;

    const first = await coderChat([{ role: "user", content: "hi" }], { waitS: novaFirstByteWaitS(600000), timeoutMs: novaSubmitTimeoutMs(4) });
    const p1 = await coderJobResult("j1", 0, 8000);
    const p2 = await coderJobResult("j1", 0, 8000);
    expect(first.reply?.text).toBe("Hello");                    // shown before the generation ends
    expect(p1.reply?.text).toBe("Hello");
    expect(p2.reply?.text).toBe("Hello world");
    expect(String(p2.reply?.text).length).toBeGreaterThan(String(p1.reply?.text).length);
    expect(chatPosts).toBe(1);                                   // lowering waitS creates no second job
  });
});

describe("Nova: errors stay explicit", () => {
  it("an aborted submit is a clear timeout, not a hang", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://nova.example";
    global.fetch = (async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as typeof fetch;
    const o = await coderChat([{ role: "user", content: "x" }], { waitS: 4, timeoutMs: novaSubmitTimeoutMs(4) });
    expect(o.reply).toBeNull();
    expect(o.failure).toBe("timeout");
  });
});
