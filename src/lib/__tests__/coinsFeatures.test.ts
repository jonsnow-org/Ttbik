import fs from "fs";
import path from "path";
import { coinsPool } from "../coinsChannel";

jest.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({}) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/znbtIndex", () => ({ readSnapshot: async () => null }));
jest.mock("@/lib/znbtHideDb", () => ({ ensureHiddenTable: async () => undefined }));
jest.mock("@/lib/znbtConfig", () => ({ getConfig: async () => null }));
jest.mock("@/lib/hostingOps", () => ({ HOSTING: { gateUrl: "https://gate.example" } }));
jest.mock("@/lib/channelPublisher", () => ({ isSafeForChannel: () => true }));

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../promo/platform-features.json"), "utf8"));

describe("coins channel feature announcements", () => {
  const items = coinsPool({ znbt: true, platform: false }).filter((i) => i.id.startsWith("feature:"));
  it("every manifest feature becomes a post once the platform is live, and none before", () => {
    expect(items.map((i) => i.id)).toEqual(manifest.features.map((f: { id: string }) => f.id));
    expect(coinsPool({ znbt: false, platform: false }).some((i) => i.id.startsWith("feature:"))).toBe(false);
  });
  it("is English only, with working links and no promise of any return", () => {
    for (const i of items) {
      expect(`${i.title} ${i.text} ${i.cta} ${i.tags}`).not.toMatch(/[؀-ۿ]/);
      expect(i.url).toMatch(/^https:\/\/gate\.example\/zenobia\/[a-z]+\.html\?lang=en$/);
      expect(i.text).not.toMatch(/profit|get rich|100x|to the moon|passive income|guaranteed (returns?|gains?)/i);
    }
  });
  it("every public platform page is covered by the manifest or explicitly exempt", () => {
    const covered = new Set<string>(manifest.features.flatMap((f: { pages: string[] }) => f.pages));
    const exempt = new Set<string>(manifest.exempt);
    const pages = fs.readdirSync(path.join(__dirname, "../../../public/zenobia")).filter((f) => f.endsWith(".html"));
    expect(pages.filter((p) => !covered.has(p) && !exempt.has(p))).toEqual([]);
  });
});
