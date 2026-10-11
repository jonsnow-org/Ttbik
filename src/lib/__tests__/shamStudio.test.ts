import { parseShamSse, shamGenerate } from "@/lib/shamStudio";

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
});
