import { round6, splitCpc } from "@/lib/adBotLogic";

describe("AD_BOT micro-CPC accounting", () => {
  it("subtracts a $0.003 task from the budget without cent-rounding it away", () => {
    expect(round6(10 - 0.003)).toBe(9.997);
    expect(round6(9.997 - 0.003)).toBe(9.994);
  });

  it("preserves all three revenue-share components below one cent", () => {
    const split = splitCpc(0.003);
    expect(split.workerCut).toBeCloseTo(0.0015, 8);
    expect(split.creatorCut).toBeCloseTo(0.0006, 8);
    expect(split.ownerCut).toBeCloseTo(0.0009, 8);
    expect(round6(split.workerCut + split.creatorCut + split.ownerCut)).toBe(0.003);
  });
});
