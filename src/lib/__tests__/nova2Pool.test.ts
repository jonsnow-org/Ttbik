import { agentsAllowedFor, coderStudioUrls, allEngineBases, nova2Urls, nova2TokenSet, tokenFor, withEngineModel, isEngineModel, currentEngineModel } from "@/lib/openCoderStudio";
import { DEFAULT_MODELS, modelReady } from "@/lib/coderModels";
import { computerModelOf, COMPUTER_MODEL_IDS } from "@/lib/computerModels";
import { browserStudioFor } from "@/lib/browserComputer";

const OLD = ["https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net", "https://studio-novaai2026-coder-inference-server-2.api-inference.modelscope.net"];
const N2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";

describe("Nova 2: its own model (35B on the international Studio) beside Nova", () => {
  const keep = { ...process.env };
  beforeEach(() => {
    process.env.OPEN_CODER_STUDIO_URL = OLD[0];
    process.env.OPEN_CODER_STUDIO_URLS = OLD[1];
    process.env.OPEN_CODER_STUDIO_TOKEN = "cn-token";
    process.env.LFM_STUDIO_URLS = "off";
    process.env.NOVA2_STUDIO_URLS = N2;
    delete process.env.NOVA2_STUDIO_TOKEN;
  });
  afterAll(() => { process.env = keep; });

  test("Nova 2 works alone: no agents, and never the cn token on its international Studio", () => {
    expect(withEngineModel("nova2", () => agentsAllowedFor())).toBe(false);
    expect(withEngineModel("coder", () => agentsAllowedFor())).toBe(true);
    delete process.env.NOVA2_STUDIO_TOKEN;
    expect(tokenFor(N2)).not.toContain("cn-token");
  });

  test("Nova keeps its Studios and Nova 2 has its own", () => {
    expect(withEngineModel("coder", () => coderStudioUrls())).toEqual(OLD);
    expect(withEngineModel("nova2", () => coderStudioUrls())).toEqual([N2]);
    expect(withEngineModel("nova2", () => currentEngineModel())).toBe("nova2");
    expect(isEngineModel("nova2")).toBe(true);
  });

  test("the job-index space only grows at the end: no job of Nova or LFM2.5 changes its number", () => {
    const all = allEngineBases();
    expect(all.slice(0, 2)).toEqual(OLD);
    expect(all[all.length - 1]).toBe(N2);
    process.env.NOVA2_STUDIO_URLS = "off";
    expect(allEngineBases()).toEqual(OLD);
  });

  test("only https addresses of non-Sham, non-hub, non-LFM Studios are accepted", () => {
    process.env.NOVA2_STUDIO_URLS = `${N2},http://x.example,https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net,https://studio-x-sham-v2-server.api-inference.modelscope.ai`;
    expect(nova2Urls()).toEqual([N2]);
  });

  test("each Studio gets its own account's token", () => {
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    expect(tokenFor(N2)).toBe("ai-token");
    expect(tokenFor(OLD[0])).toBe("cn-token");
    expect(nova2TokenSet()).toBe(true);
  });

  test("the model is in the list, owner-only, ready only with its token", () => {
    const m = DEFAULT_MODELS.find((x) => x.id === "nova2")!;
    expect(m).toBeTruthy();
    expect(m.ownerOnly).toBe(true);
    expect(modelReady(m)).toBe(false);
    process.env.NOVA2_STUDIO_TOKEN = "ai-token";
    expect(modelReady(m)).toBe(true);
    expect(DEFAULT_MODELS.find((x) => x.id === "coder")).toBeTruthy();   // Nova is still there
  });

  test("Nova 2 works in Nova's computer: same session identity, same hub, no second workspace", () => {
    expect(computerModelOf("nova2")).toBe("coder");
    expect(computerModelOf("coder")).toBe("coder");
    expect(computerModelOf("lfm25")).toBe("lfm25");
    expect(computerModelOf(undefined)).toBe("coder");
    expect(COMPUTER_MODEL_IDS).not.toContain("nova2");
    expect(browserStudioFor(computerModelOf("nova2"))).toBe(browserStudioFor("coder"));
  });
});
