// Nova 1 was removed (2026-11-22): the one Nova (model id «coder») runs on the 35B Studio pool.
import { coderStudioUrls, nova2Urls, novaRunsOnNova2, allEngineBases, withEngineModel, runsOnBigModel } from "@/lib/openCoderStudio";

const N2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";
const N1 = "https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net";
const save = { ...process.env };
afterEach(() => { process.env = { ...save }; });

describe("the one Nova runs on the 35B engine", () => {
  beforeEach(() => { process.env.OPEN_CODER_STUDIO_URL = N1; process.env.NOVA2_STUDIO_URLS = N2; delete process.env.OPEN_CODER_STUDIO_URLS; });
  it("«coder» uses the 35B Studio and never the old cn one; no switch needed", () => {
    delete process.env.NOVA_ENGINE;
    expect(novaRunsOnNova2()).toBe(true);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N2]);
    expect(coderStudioUrls("nova2")).toEqual([N2]);
    expect(allEngineBases()).not.toContain(N1);
    expect(allEngineBases().filter((x) => x === N2).length).toBe(1);      // one index for the shared Studio, so job ids stay unambiguous
  });
  it("the big-model tuning (small tool list, serial child, long stall) applies to the one Nova", () => {
    expect(runsOnBigModel("coder")).toBe(true);
    expect(runsOnBigModel("nova2")).toBe(true);
    expect(runsOnBigModel("lfm25")).toBe(false);
  });
  it("only when the 35B pool is switched off (tests) does the OPEN_CODER_STUDIO_URL fallback apply", () => {
    process.env.NOVA2_STUDIO_URLS = "off";
    expect(nova2Urls()).toEqual([]);
    expect(novaRunsOnNova2()).toBe(false);
    expect(runsOnBigModel("coder")).toBe(false);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N1]);
  });
});
