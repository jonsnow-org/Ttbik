// NOVA_ENGINE=nova2: the product named Nova (model id "coder") runs on Nova 2's Studio pool; off by default.
import { coderStudioUrls, nova2Urls, novaRunsOnNova2, allEngineBases, withEngineModel } from "@/lib/openCoderStudio";

const N2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";
const N1 = "https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net";
const save = { ...process.env };
afterEach(() => { process.env = { ...save }; });

describe("Nova runs on Nova 2's engine when the owner switches it", () => {
  beforeEach(() => { process.env.OPEN_CODER_STUDIO_URL = N1; process.env.NOVA2_STUDIO_URLS = N2; delete process.env.OPEN_CODER_STUDIO_URLS; });
  it("off by default: Nova keeps its own Studio, Nova 2 its own", () => {
    delete process.env.NOVA_ENGINE;
    expect(novaRunsOnNova2()).toBe(false);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N1]);
    expect(coderStudioUrls("nova2")).toEqual([N2]);
  });
  it("NOVA_ENGINE=nova2: «coder» uses the Nova 2 Studio and never the old one", () => {
    process.env.NOVA_ENGINE = "nova2";
    expect(novaRunsOnNova2()).toBe(true);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N2]);
    expect(coderStudioUrls("nova2")).toEqual([N2]);
    expect(allEngineBases()).not.toContain(N1);
    expect(allEngineBases().filter((x) => x === N2).length).toBe(1);      // one index for the shared Studio, so job ids stay unambiguous
  });
  it("the switch does nothing while Nova 2 has no Studio (never an empty pool)", () => {
    process.env.NOVA_ENGINE = "nova2"; process.env.NOVA2_STUDIO_URLS = "off";
    expect(nova2Urls()).toEqual([]);
    expect(novaRunsOnNova2()).toBe(false);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N1]);
  });
});
