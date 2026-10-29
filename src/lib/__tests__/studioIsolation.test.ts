// Each model uses only its own Studios: Nova (coder-inference-*), Sham v1 (sham-v1-*), Sham v2 (sham-v2-* + the nova-inference-server overflow, added on purpose by shamPool).
// Even with a polluted environment (every URL in every variable) no call may cross to another model's Studio. See docs/STUDIOS.md.
import { coderStudioUrls } from "@/lib/openCoderStudio";
import { shamBases, shamLastFailure, shamNoteFailure, shamVariant } from "@/lib/shamStudio";
import { _resetPoolForTests } from "@/lib/shamPool";

const NOVA = ["https://studio-x-coder-inference-server.api-inference.modelscope.net", "https://studio-x-coder-inference-server-2.api-inference.modelscope.net"];
const V1 = ["https://studio-x-sham-v1-server.api-inference.modelscope.net"];
const V2 = ["https://studio-x-sham-v2-server.api-inference.modelscope.net", "https://studio-x-sham-v2-server-2.api-inference.modelscope.net"];
const OVER = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
const ALL = [...NOVA, ...V1, ...V2, OVER];
const saved = { ...process.env };
beforeEach(() => { _resetPoolForTests(); process.env.OPEN_CODER_STUDIO_URL = ALL[3]; process.env.OPEN_CODER_STUDIO_URLS = ALL.join(","); process.env.SHAM_MODELSCOPE_URL = ALL.join(","); process.env.SHAM_V2_URL = ALL.join(","); process.env.SHAM_V2_OVERFLOW_URL = ""; });
afterAll(() => { process.env = saved; });

describe("Studio pools never mix models", () => {
  it("Nova: only coder-inference Studios, whatever the environment lists", () => {
    process.env.OPEN_CODER_STUDIO_URL = NOVA[0];
    const urls = coderStudioUrls();
    expect(urls.sort()).toEqual([...NOVA].sort());
    for (const u of urls) expect(u).not.toMatch(/sham|nova-inference-server/);
  });
  it("Nova: a Sham URL as the primary is dropped, not used", () => {
    process.env.OPEN_CODER_STUDIO_URL = V2[0];
    expect(coderStudioUrls().some((u) => /sham/.test(u))).toBe(false);
  });
  it("Sham v1: only sham-v1 Studios", async () => {
    const b = await shamVariant.run("v1", async () => shamBases());
    expect(b).toEqual(V1);
  });
  it("Sham v2: only sham-v2 Studios (the overflow joins only through shamPool, and is off here)", async () => {
    const b = await shamVariant.run("v2", async () => shamBases());
    expect(b.sort()).toEqual([...V2].sort());
    for (const u of b) expect(u).not.toMatch(/sham-v1|coder-inference/);
  });
  it("Sham v2 rotates over its own Studios: every Studio gets calls first in turn", async () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 4; i++) firsts.add((await shamVariant.run("v2", async () => shamBases()))[0]);
    expect([...firsts].sort()).toEqual([...V2].sort());
  });
  it("Sham v2 overflow (nova-inference-server) is v2-only and never offered to Nova or v1", async () => {
    process.env.SHAM_V2_OVERFLOW_URL = OVER;
    expect(coderStudioUrls()).not.toContain(OVER);
    expect(await shamVariant.run("v1", async () => shamBases())).not.toContain(OVER);
  });
  it("keeps v1 and v2 failure diagnostics isolated when calls overlap", async () => {
    shamVariant.run("v1", () => shamNoteFailure(""));
    shamVariant.run("v2", () => shamNoteFailure(""));
    await Promise.all([
      shamVariant.run("v1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        shamNoteFailure("v1 timeout");
      }),
      shamVariant.run("v2", async () => {
        await Promise.resolve();
        shamNoteFailure("v2 HTTP 503");
      }),
    ]);
    expect(shamVariant.run("v1", () => shamLastFailure())).toBe("v1 timeout");
    expect(shamVariant.run("v2", () => shamLastFailure())).toBe("v2 HTTP 503");
  });

});
