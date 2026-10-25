import { parseShamReply, parseShamSse, shamChatAuto, shamGenerate, shamGenerateAny, shamGenerateMedia, shamJobResult, shamPendingText, shamStatusText, shamThink, shamThinkPatient, shamThinkUnavailable } from "@/lib/shamStudio";

describe("shamStudio", () => {
  it("reads the first data list of an SSE body", () => {
    expect(parseShamSse('event: complete\ndata: ["نص من شام"]\n')).toBe("نص من شام");
    expect(parseShamSse("event: error\ndata: null\n")).toBeNull();
  });
  it("skips lines that are not data and data that is not JSON", () => {
    expect(parseShamSse('event: generating\ndata: not json\ndata: ["ثانٍ"]\n')).toBe("ثانٍ");
    expect(parseShamSse("")).toBeNull();
  });
  it("sends nothing without a token", async () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await shamGenerate("مرحبا")).toBeNull();
  });
  it("reads the Studio's JSON reply (text, image, audio, notice)", () => {
    const body = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
    expect(parseShamReply(body({ type: "text", text: "مرحبا" }))).toEqual({ type: "text", text: "مرحبا" });
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
    const o = await shamThink("مرحبا", "1", null, 80, 30000);
    expect(o.failure).toBe("network");
    expect(n).toBe(2);                       // the submit fetch, once more after the blip
    n = 0;
    global.fetch = (async () => { n++; throw Object.assign(new Error("slow"), { name: "TimeoutError" }); }) as any;
    expect((await shamThink("مرحبا", "1", null, 80, 30000)).failure).toBe("timeout");
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
      const o = await shamThinkPatient("مرحبا", "1", null, 80, 28000, 100000);
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
    const { SHAM_LIM } = require("@/lib/coderProvider");
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
