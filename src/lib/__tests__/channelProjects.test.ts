import { buildPool, ROTATION, formatPost } from "../channelPool";
import { isSafeForChannel } from "../channelPublisher";

jest.mock("@/lib/groq", () => ({ callGroq: async () => "" }));
jest.mock("@/lib/supabase", () => ({ supabasePublic: () => ({}) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const BANNED = /(ربح|أرباح|اربح|استثمار|عائد|ضمانة|فرصة ذهبية|إثراء|اثراء|مضاعفة|سعر يرتفع|profit|invest|guaranteed|will (rise|go up)|سيرتفع)/i;

describe("the owner's projects in the channel rotation", () => {
  const projects = buildPool().project;
  it("includes Zenobia (coin, passport, channel) and Athar", () => {
    const ids = projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["project:zenobia-coin", "project:zenobia-passport", "project:zenobia-channel", "project:athar-days", "project:athar-today"]));
    expect(ROTATION.filter((k) => k === "project").length).toBeGreaterThanOrEqual(3);
  });
  it("every project post passes the safety filter and promises nothing", () => {
    for (const p of projects) {
      expect(isSafeForChannel(`${p.title}\n${p.blurb}`)).toBe(true);
      expect(`${p.title} ${p.blurb}`).not.toMatch(BANNED);
      expect(formatPost(p, 0)).toContain(p.title);
      expect(p.url.startsWith("https://")).toBe(true);
    }
  });
  it("the coin post carries the buy button and the risk warning", () => {
    const coin = projects.find((p) => p.id === "project:zenobia-coin")!;
    expect(coin.target?.url).toContain("memepadjetton_ZNB");
    expect(coin.blurb).toMatch(/Not financial advice/);
  });
});
