import { buildPool, ROTATION, formatPost } from "../channelPool";
import { isSafeForChannel } from "../channelPublisher";

jest.mock("@/lib/groq", () => ({ callGroq: async () => "" }));
jest.mock("@/lib/supabase", () => ({ supabasePublic: () => ({}) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const BANNED = /(ربح|أرباح|اربح|استثمار|عائد|ضمانة|فرصة ذهبية|إثراء|اثراء|مضاعفة|سعر يرتفع|profit|invest|guaranteed|will (rise|go up)|سيرتفع)/i;

describe("the owner's projects in the channel rotation", () => {
  const projects = [...buildPool().project, ...buildPool().coin];
  it("includes Zenobia (coin, passport, channel) and Athar", () => {
    const ids = projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["coin:intro", "coin:how-to-buy", "coin:palmyra", "coin:zenobia", "coin:quote", "coin:board", "project:zenobia-passport", "project:zenobia-channel", "project:athar-days", "project:athar-today"]));
    // the coin comes first: it takes the most places in the rotation
    expect(ROTATION.filter((k) => k === "coin").length).toBeGreaterThan(ROTATION.filter((k) => k === "project").length);
    expect(ROTATION.filter((k) => k === "coin").length).toBeGreaterThanOrEqual(4);
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
    const coin = projects.find((p) => p.id === "coin:intro")!;
    expect(coin.target?.url).toContain("memepadjetton_ZNB");
    expect(coin.blurb).toMatch(/Not financial advice/);
  });
});

import { isSafeForChannel } from "../channelPublisher";
describe("channel posts pass the safety filter", () => {
  test("the #شام_AI tag is the site brand, not a blocked word", () => {
    expect(isSafeForChannel("🛠 أداة\n\n#أدوات_مجانية #شام_AI")).toBe(true);
    expect(isSafeForChannel("شام وحدها ممنوعة")).toBe(false);
  });
  test("every pool post, including ZNBt and Palmyra Launch, is safe in all three layouts", () => {
    const pool = buildPool({ znbt: true, platform: true });
    for (const kind of ["project", "coin", "tool", "bot"] as const) {  // news/articles may legitimately be skipped by the filter at run time
      for (const it of pool[kind]) for (let v = 0; v < 3; v++) {
        if (!isSafeForChannel(formatPost(it, v))) throw new Error(`blocked: ${it.id} variant ${v}`);
      }
    }
  });
  test("ZNBt and the platform are absent until the owner launched / opened", () => {
    const ids = buildPool().project.map((p) => p.id);
    expect(ids).not.toContain("project:znbt");
    expect(ids).not.toContain("project:palmyra-launch");
  });
});
