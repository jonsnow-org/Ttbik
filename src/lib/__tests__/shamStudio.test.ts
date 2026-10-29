import { parseShamReply, parseShamSse, readShamSse, shamBases, shamChatAuto, shamGenerate, shamGenerateAny, shamGenerateMedia, shamJobResult, shamPendingText, shamStatusText, shamThink, shamThinkPatient, shamThinkUnavailable, shamVariant } from "@/lib/shamStudio";

describe("shamStudio", () => {
  it("reads the first data list of an SSE body", () => {
    expect(parseShamSse('event: complete\ndata: ["نص من شام"]\n')).toBe("نص من شام");
    expect(parseShamSse("event: error\ndata: null\n")).toBeNull();
    expect(parseShamSse('event: complete\ndata: [{"type":"text","text":"كائن مباشر"}]\n')).toBe('{"type":"text","text":"كائن مباشر"}');
  });
  it("skips lines that are not data and data that is not JSON", () => {
    expect(parseShamSse('event: generating\ndata: not json\ndata: ["ثانٍ"]\n')).toBe("ثانٍ");
    expect(parseShamSse("")).toBeNull();
  });
  it("returns the first complete SSE data line without waiting for the stream to close", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: generating\n"));
        controller.enqueue(encoder.encode('data: ["streamed'));
        controller.enqueue(encoder.encode(' answer"]\n'));
        // Deliberately keep the stream open, matching a long-lived Gradio SSE response.
      },
      cancel() { cancelled = true; },
    });
    const response = {
      body,
      text: async () => { throw new Error("must not wait for EOF"); },
    } as unknown as Response;

    await expect(readShamSse(response)).resolves.toBe("streamed answer");
    expect(cancelled).toBe(true);
  });

  it("sends nothing without a token", async () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await shamGenerate("مرحبا")).toBeNull();
  });
  it("reads the Studio's JSON reply (text, image, audio, notice)", () => {
    const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    expect(parseShamReply(body({ type: "text", text: "مرحبا" }))).toEqual({ type: "text", text: "مرحبا" });
    expect(parseShamReply(JSON.stringify({ type: "text", text: "محتوى SSE المفكوك" }))).toEqual({ type: "text", text: "محتوى SSE المفكوك" });
    expect(parseShamReply(body({ type: "image", mime: "image/png", b64: "AAAA" }))?.type).toBe("image");
    expect(parseShamReply(body({ type: "audio", mime: "audio/wav", b64: "BBBB" }))?.b64).toBe("BBBB");
  });
  it("is null for an older text-only Studio (plain text, no JSON) and for an empty body", () => {
    expect(parseShamReply('event: complete\ndata: ["نص عادي"]\n')).toBeNull();
    expect(parseShamReply("")).toBeNull();
  });
  it("sends nothing without a token (any / media)", async () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await shamGenerateAny("ارسم قطة")).toBeNull();
    expect(await shamGenerateMedia("image", "قطة")).toBeNull();
  });
  it("reads a video reply and the chat_auto route; chat_auto sends nothing without a token", async () => {
    const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    const v = parseShamReply(body({ type: "video", mime: "video/mp4", b64: "CCCC", text: "🎬", route: "video" }));
    expect(v?.type).toBe("video");
    expect(v?.route).toBe("video");
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await shamChatAuto("مرحبا")).toBeNull();
  });
});

describe("shamStudio think", () => {
  const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
  it("reads pending / later / decision", () => {
    const p = parseShamReply(body({ type: "pending", job: "abc", decision: "image", later: [{ type: "text", text: "قديم" }] }));
    expect(p?.job).toBe("abc");
    expect(p?.decision).toBe("image");
    expect(p?.later?.[0].text).toBe("قديم");
  });
  it("a network blip is tried once more; a timeout is not", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const real = global.fetch;
    let n = 0;
    global.fetch = (async () => { n++; throw Object.assign(new Error("down"), { name: "TypeError" }); }) as any;
    const o = await shamVariant.run("v1", () => shamThink("مرحبا", "1", null, 80, 30000));
    expect(o.failure).toBe("network");
    expect(n).toBe(2);                       // the submit fetch, once more after the blip
    n = 0;
    global.fetch = (async () => { n++; throw Object.assign(new Error("slow"), { name: "TimeoutError" }); }) as any;
    expect((await shamVariant.run("v1", () => shamThink("مرحبا", "1", null, 80, 30000))).failure).toBe("timeout");
    expect(n).toBe(1);
    global.fetch = real;
    delete process.env.MODELSCOPE_API_TOKEN;
  });
  it("patient think: busy is asked again, an empty text once more, a good answer is passed on untouched", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const real = global.fetch;
    const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    const run = async (replies: object[]) => {
      let n = 0, sub = 0;
      global.fetch = (async (url: string) => {
        if (/call\/v2\//.test(url)) { sub++; return { ok: true, json: async () => ({ event_id: "e" }) } as any; }
        return { ok: true, text: async () => sse(replies[Math.min(n++, replies.length - 1)]) } as any;
      }) as any;
      const o = await shamVariant.run("v1", () => shamThinkPatient("مرحبا", "1", null, 80, 28000, 100000));
      return { o, sub };
    };
    let x = await run([{ type: "busy" }, { type: "busy" }, { type: "text", text: "أهلاً" }]);
    expect(x.o.reply).toEqual({ type: "text", text: "أهلاً" }); expect(x.sub).toBe(3);
    x = await run([{ type: "busy" }, { type: "busy" }, { type: "busy" }, { type: "text", text: "late" }]);
    expect(x.o.reply?.type).toBe("busy"); expect(x.sub).toBe(3);                  // two more tries at most
    x = await run([{ type: "text", text: "  " }, { type: "text", text: "الآن" }]);
    expect(x.o.reply?.text).toBe("الآن"); expect(x.sub).toBe(2);
    x = await run([{ type: "text", text: "  " }]);
    expect(x.sub).toBe(2);                                                         // one retry only, then it is passed on
    x = await run([{ type: "text", text: "مرحبا بك" }]);
    expect(x.sub).toBe(1);
    global.fetch = real;
    delete process.env.MODELSCOPE_API_TOKEN;
  });
  it("is off without a token and says why", async () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    const o = await shamThink("مرحبا", "1");
    expect(shamThinkUnavailable({ reply: null, failure: "http" })).toBe(true);
    expect(shamThinkUnavailable({ reply: null, failure: "timeout" })).toBe(false);
    expect(o).toEqual({ reply: null, failure: "off" });
    expect((await shamJobResult("x")).failure).toBe("off");
  });
  it("says 'loading' only when the Studio says it is loading", () => {
    expect(shamStatusText({ reply: { type: "loading", text: "downloading" } })).toContain("يحمّل");
    expect(shamStatusText({ reply: null, failure: "timeout" })).not.toContain("يحمّل");
    expect(shamStatusText({ reply: { type: "busy" } })).toContain("مشغول");
    expect(shamPendingText("image")).toContain("الصورة");
  });
});

describe("Sham limits are settings, not code", () => {
  it("today's numbers by default; SHAM_LIMITS=open lifts them all at once; each can be set alone", () => {
    const { SHAM_LIM } = require("@/lib/shamPrompt");
    const { shamReplyTokens } = require("@/lib/shamStudio");
    const keys = ["SHAM_LIMITS", "SHAM_MAX_NEW_TOKENS", "SHAM_REPLY_TOKENS", "SHAM_PROMPT_CHARS"];
    const saved = keys.map((k) => process.env[k]); keys.forEach((k) => delete process.env[k]);
    expect([SHAM_LIM.maxNew, SHAM_LIM.turns, SHAM_LIM.sources, SHAM_LIM.promptChars, shamReplyTokens()]).toEqual([200, 6, 1800, 3200, 80]);
    process.env.SHAM_LIMITS = "open";
    expect(SHAM_LIM.maxNew).toBeGreaterThan(200); expect(SHAM_LIM.promptChars).toBeGreaterThan(3200); expect(shamReplyTokens()).toBeGreaterThan(80);
    process.env.SHAM_PROMPT_CHARS = "5000";
    expect(SHAM_LIM.promptChars).toBe(5000);
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  });
});

describe("shamStudio: more than one Studio, and the new body's own Studio", () => {
  const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
  const mock = (answers: Record<string, object>, seen: string[]) => (async (url: string) => {
    const host = String(url).replace(/^(https:\/\/[^/]+).*$/, "$1");
    if (/call\/v2\//.test(url)) { seen.push(host); return { ok: true, json: async () => ({ event_id: host.replace("https://", "") }) } as any; }
    const ev = String(url).split("/").pop() as string;
    return { ok: true, text: async () => body(answers[ev] || { type: "text", text: "?" }) } as any;
  }) as any;
  it("never routes Sham v1 to Nova's inference Studio even if a stale env value remains", () => {
    process.env.SHAM_MODELSCOPE_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
    expect(shamVariant.run("v1", () => shamBases())).toEqual(["https://studio-novaai2026-sham-v1-server.api-inference.modelscope.net"]);
    delete process.env.SHAM_MODELSCOPE_URL;
  });
  it("the new body uses SHAM_V2_URL (default: its own Studio), the old one SHAM_MODELSCOPE_URL", () => {
    process.env.SHAM_MODELSCOPE_URL = "https://old.example"; delete process.env.SHAM_V2_URL;
    expect(shamVariant.run("v1", () => shamBases())).toEqual(["https://old.example"]);
    expect(shamVariant.run("v2", () => shamBases())[0]).toMatch(/sham-v2-server/);
    process.env.SHAM_V2_URL = "https://v2a.example, https://v2b.example/";
    process.env.SHAM_V2_OVERFLOW_URL = "off";                       // (the overflow Studio of Sham v2 has its own tests: shamPool.test.ts)
    expect(shamVariant.run("v2", () => shamBases()).sort()).toEqual(["https://v2a.example", "https://v2b.example"]);
    delete process.env.SHAM_MODELSCOPE_URL; delete process.env.SHAM_V2_URL; delete process.env.SHAM_V2_OVERFLOW_URL;
  });
  it("a busy Studio hands the call to the next one at once", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_MODELSCOPE_URL = "https://a.example,https://b.example";
    const real = global.fetch; const seen: string[] = [];
    global.fetch = mock({ "a.example": { type: "busy" }, "b.example": { type: "text", text: "من الثاني" } }, seen);
    for (let i = 0; i < 2; i++) {                                  // the start rotates, so one of the two calls starts at the busy Studio and must hop
      const o = await shamVariant.run("v1", () => shamThink("سؤال", "u1", null, 40, 20000));
      expect(o.reply).toEqual({ type: "text", text: "من الثاني" });
    }
    expect(new Set(seen)).toEqual(new Set(["https://a.example", "https://b.example"]));
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN; delete process.env.SHAM_MODELSCOPE_URL;
  });
  it("a job is looked up on every Studio until the one that has it answers", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_MODELSCOPE_URL = "https://a.example,https://b.example";
    const real = global.fetch; const seen: string[] = [];
    global.fetch = mock({ "a.example": { type: "gone" }, "b.example": { type: "text", text: "جاهز" } }, seen);
    const o = await shamVariant.run("v1", () => shamJobResult("j1"));
    expect(o.reply?.text).toBe("جاهز");
    global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN; delete process.env.SHAM_MODELSCOPE_URL;
  });
});

describe("one end-to-end time limit per call", () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  afterEach(() => { global.fetch = realFetch; process.env = { ...env }; });
  const hang = (calls: string[]) => (async (u: any, init?: any) => {
    calls.push(String(u));
    return new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
  }) as typeof fetch;
  it("a slow submit leaves only the remaining time for the result (not a second full limit)", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    let n = 0;
    global.fetch = (async (u: any, init?: any) => {
      n++;
      if (n === 1) { await new Promise((r) => setTimeout(r, 700)); return Response.json({ event_id: "e" }); }
      return new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
    }) as typeof fetch;
    const t0 = Date.now();
    expect(await shamVariant.run("v1", () => shamGenerate("hi", 10, 1200))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1700);                 // 1200 limit in total, not 700 + 1200
  });
  it("several Studios in the pool share one limit: the second is not started with a fresh full limit", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    process.env.SHAM_MODELSCOPE_URL = "https://a.test,https://b.test";
    const calls: string[] = [];
    global.fetch = hang(calls);
    const t0 = Date.now();
    expect(await shamVariant.run("v1", () => shamGenerateAny("hi", 10, 1600))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2300);                 // one 1600 ms limit, not two
    expect(calls.length).toBe(1);                               // the first one used all of it: no second attempt
  });
  it("a Studio that refuses at once still hands the call to the next one with the time that is left", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    process.env.SHAM_MODELSCOPE_URL = "https://a.test,https://b.test";
    const hits: string[] = [];
    global.fetch = (async (u: any) => {
      const url = String(u); hits.push(url);
      if (url.startsWith("https://a.test") || (hits.length > 0 && hits[0].startsWith("https://a.test") && false)) return new Response("no", { status: 500 });
      if (url.includes("/call/v2/")) return Response.json({ event_id: "e" });
      return new Response('event: complete\ndata: [' + JSON.stringify(JSON.stringify({ type: "text", text: "from b" })) + ']\n');
    }) as typeof fetch;
    const seen = new Set<string>();
    for (let i = 0; i < 2; i++) { const r = await shamVariant.run("v1", () => shamGenerateAny("hi", 10, 5000)); if (r?.type === "text") seen.add(r.text || ""); }
    expect([...seen]).toEqual(["from b"]);
  });
});
