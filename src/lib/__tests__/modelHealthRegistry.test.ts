jest.mock("@/lib/openCoderStudio", () => ({
  allStudioStatus: jest.fn(),
  withEngineModel: jest.fn((_model: string, run: () => unknown) => run()),
}));
jest.mock("@/lib/shamStudio", () => ({
  shamBases: jest.fn(() => ["https://sham.test"]),
  shamVariant: { run: (_variant: string, run: () => unknown) => run() },
}));

import { allStudioStatus, withEngineModel } from "@/lib/openCoderStudio";
import { modelHealth } from "@/lib/modelHealth";

describe("model health covers the supported inference pools", () => {
  it("reports LFM from its own pool and does not include retired candidates", async () => {
    const status = allStudioStatus as jest.Mock;
    status.mockResolvedValueOnce([{ phase: "ready" }]).mockResolvedValueOnce([null]);
    const oldFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response("", { status: 200 })) as typeof fetch;
    try {
      const health = await modelHealth(0);
      expect(health).toEqual({ coder: "ok", sham: "ok", sham_v2: "ok", lfm25: "down" });
      expect(withEngineModel).toHaveBeenCalledWith("lfm25", expect.any(Function));
      expect(Object.keys(health)).not.toEqual(expect.arrayContaining(["qwen35-9b", "gemma4-e4b", "minicpmo45"]));
    } finally {
      global.fetch = oldFetch;
    }
  });
});
