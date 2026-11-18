import { setTldmEnabled, tldmEnabled } from "@/lib/coderModels";
import { shamGenerateChat, shamGenerateTldm, shamModeCtx, shamTldmCtx, shamTldmOn, shamVariant } from "@/lib/shamStudio";

describe("Sham 2 T-LDM owner path", () => {
  it("is off by default and only stored on Sham 2", () => {
    const st: any = {};
    expect(tldmEnabled(st, "sham_v2")).toBe(false);
    expect(tldmEnabled(st, "sham")).toBe(false);
    setTldmEnabled(st, true);
    expect(tldmEnabled(st, "sham_v2")).toBe(true);
    expect(tldmEnabled(st, "sham")).toBe(false);
    setTldmEnabled(st, false);
    expect(tldmEnabled(st, "sham_v2")).toBe(false);
  });

  it("is active only on the Sham 2 variant", () => {
    expect(shamTldmOn()).toBe(false);
    expect(shamVariant.run("v1", () => shamTldmCtx.run(true, () => shamTldmOn()))).toBe(false);
    expect(shamVariant.run("v2", () => shamTldmCtx.run(true, () => shamTldmOn()))).toBe(true);
    expect(shamVariant.run("v2", () => shamModeCtx.run({ tldm: true } as never, () => shamTldmOn()))).toBe(true);
    expect(shamVariant.run("v2", () => shamModeCtx.run({} as never, () => shamTldmOn()))).toBe(false);
  });

  it("calls generate_tldm for Sham 2 and never Sham 1 when the switch is on", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const urls: string[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      urls.push(String(input));
      if (String(input).includes("/call/v2/")) {
        return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      }
      return {
        ok: true,
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel: async () => undefined, releaseLock() {} }) },
        text: async () => 'data: [{"type":"error","text":"مسار T-LDM لشام 2 غير جاهز: لم يُعثر على رأس التدريب. لم يُستخدم شام 1.","fallback":"none"}]\n',
      } as any;
    }) as any;
    try {
      const reply = await shamVariant.run("v2", () => shamTldmCtx.run(true, () => shamGenerateChat([{ role: "user", content: "مرحبا" }])));
      expect(reply).toMatchObject({ type: "error", fallback: undefined });
      expect(String(reply?.text || "")).toContain("شام 1");
      expect(urls.some((u) => u.includes("generate_tldm"))).toBe(true);
      expect(urls.some((u) => u.includes("sham-v1") || u.includes("generate_chat"))).toBe(false);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("returns a clear no-fallback error if the T-LDM endpoint does not answer", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const real = global.fetch;
    global.fetch = (async () => ({ ok: false, status: 404 })) as any;
    try {
      const reply = await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "مرحبا" }]));
      expect(reply).toMatchObject({ type: "error", reason: "no-fallback" });
      expect(String(reply?.text || "")).toContain("شام 1");
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("refuses to run T-LDM on Sham 1", async () => {
    const reply = await shamVariant.run("v1", () => shamGenerateTldm([{ role: "user", content: "مرحبا" }]));
    expect(reply).toMatchObject({ type: "error", reason: "no-fallback" });
    expect(String(reply?.text || "")).toContain("شام 2");
  });
});
