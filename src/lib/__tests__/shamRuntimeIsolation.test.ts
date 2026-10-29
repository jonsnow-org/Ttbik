import { shamContext, setShamHost, type ShamHost } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";

const fakeHost = {
  account: async () => ({
    githubToken: null,
    owner: true,
    chatKey: "account-hash",
    connectors: [],
  }),
} as unknown as ShamHost;

describe("Sham runtime namespaces are model-specific", () => {
  beforeEach(() => setShamHost(fakeHost));
  afterEach(() => setShamHost(null));

  it("uses separate VM, task-bank and tool-memory keys for v1 and v2", async () => {
    const v1 = await shamVariant.run("v1", () => shamContext(42));
    const v2 = await shamVariant.run("v2", () => shamContext(42));

    expect(v1.chatKey).toBe("sham:account-hash:v1");
    expect(v2.chatKey).toBe("sham:account-hash:v2");
    expect(v1.chatKey).not.toBe(v2.chatKey);
    expect(v1.runId).toBe("sham-42-v1");
    expect(v2.runId).toBe("sham-42-v2");
    expect(v1.runId).not.toBe(v2.runId);
  });

  it("refuses to construct runtime context when no model was selected", async () => {
    await expect(shamContext(42)).rejects.toThrow("Missing selected Sham variant");
  });
});
