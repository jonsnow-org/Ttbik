import { parseShamReply, parseShamSse, shamGenerate, shamGenerateAny, shamGenerateMedia } from "@/lib/shamStudio";

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
});
