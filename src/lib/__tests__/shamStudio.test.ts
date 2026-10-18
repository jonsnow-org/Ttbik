import { parseShamReply, parseShamSse, shamChatAuto, shamGenerate, shamGenerateAny, shamGenerateMedia, shamJobResult, shamPendingText, shamStatusText, shamThink, shamThinkUnavailable } from "@/lib/shamStudio";

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
