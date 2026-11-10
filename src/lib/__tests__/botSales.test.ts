import { BOT_PAID_USD, codeMessage, FREE_CREATOR_PCT, NORMAL_CREATOR_PCT, parseCodeCommand, splitCreatorCut } from "@/lib/botSales";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("builder bot sales", () => {
  it("keeps the existing 20% supervisor cut for paid bots and halves it for free ones", () => {
    expect(NORMAL_CREATOR_PCT).toBe(20);
    expect(FREE_CREATOR_PCT).toBe(10);
    const cpc = 0.01, creatorCut = cpc * 0.2, ownerCut = cpc * 0.3; // splitCpc in adBotLogic
    const paid = splitCreatorCut(creatorCut, NORMAL_CREATOR_PCT);
    expect(paid.creator).toBeCloseTo(0.002, 10);
    expect(paid.toPlatform).toBeCloseTo(0, 10);
    const free = splitCreatorCut(creatorCut, FREE_CREATOR_PCT);
    expect(free.creator).toBeCloseTo(0.001, 10);
    expect(ownerCut + free.toPlatform).toBeCloseTo(0.004, 10); // platform 40% on a free bot
    expect(free.creator + free.toPlatform).toBeCloseTo(creatorCut, 12); // nothing created or lost
    expect(splitCreatorCut(creatorCut, 99).creator).toBeCloseTo(creatorCut, 12); // never above the normal cut
  });
  it("parses the platform's manual /code command", () => {
    expect(parseCodeCommand("/code 123456789 free")).toEqual({ buyerId: "123456789", free: true });
    expect(parseCodeCommand("/code 123456789")).toEqual({ buyerId: "123456789", free: false });
    expect(parseCodeCommand("/code abc")).toBeNull();
  });
  it("tells the buyer exactly how to activate, without private details", () => {
    const m = codeMessage("ABCDEF123456", "123456789", "https://x.dev/", true);
    expect(m).toContain("ABCDEF123456");
    expect(m).toContain("https://x.dev/bots");
    expect(m).toContain("123456789");
    expect(m).not.toMatch(/الأدمن|المالك|admin/i);
    expect(BOT_PAID_USD).toBe(20);
  });
});
