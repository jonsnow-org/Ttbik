import { coderStudioUrls, allEngineBases, nova2Active, nova2Urls, tokenFor, withEngineModel } from "@/lib/openCoderStudio";

const OLD = ["https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net", "https://studio-novaai2026-coder-inference-server-2.api-inference.modelscope.net"];
const N2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";

describe("Nova 2 pool (35B on the international Studio, beside the old Nova)", () => {
  const keep = { ...process.env };
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = OLD[0];
    process.env.OPEN_CODER_STUDIO_URLS = OLD[1];
    process.env.OPEN_CODER_STUDIO_TOKEN = "cn-token";
    process.env.LFM_STUDIO_URLS = "off";
    delete process.env.NOVA2_STUDIO_URLS; delete process.env.NOVA_POOL; delete process.env.NOVA2_STUDIO_TOKEN;
  });
  afterAll(() => { process.env = keep; });

  test("without the switch the old Nova is untouched", () => {
    process.env.NOVA2_STUDIO_URLS = N2;
    expect(nova2Active()).toBe(false);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual(OLD);
  });

  test("the switch sends new completions to Nova 2 and the old pool keeps its job indexes", () => {
    process.env.NOVA2_STUDIO_URLS = N2;
    const before = allEngineBases();
    process.env.NOVA_POOL = "nova2";
    expect(nova2Active()).toBe(true);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual([N2]);
    expect(allEngineBases()).toEqual(before);                     // no index moved
    expect(allEngineBases().slice(0, 2)).toEqual(OLD);
    expect(allEngineBases()[allEngineBases().length - 1]).toBe(N2);
  });

  test("switching on without any address changes nothing", () => {
    process.env.NOVA_POOL = "nova2";
    expect(nova2Active()).toBe(false);
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual(OLD);
  });

  test("only https addresses of non-Sham, non-hub, non-LFM Studios are accepted", () => {
    process.env.NOVA2_STUDIO_URLS = `${N2},http://x.example,https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net,https://studio-x-sham-v2-server.api-inference.modelscope.ai`;
    expect(nova2Urls()).toEqual([N2]);
  });

  test("each Studio gets its own account's token", () => {
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    expect(tokenFor(N2)).toBe("ai-token");
    expect(tokenFor(OLD[0])).toBe("cn-token");
  });
});
