import { summarizeSplits } from "@/lib/promoCommissions";

describe("commission reporting precision", () => {
  it("does not hide sub-cent task, supervisor, referral or platform amounts", () => {
    const report = summarizeSplits([
      { type: "AD_PAYMENT", amount: 0.003, botId: "bot-1" },
      { type: "TASK_REWARD", amount: 0.0015, botId: "bot-1" },
      { type: "CREATOR_EARNING_PENDING", amount: 0.0006, botId: "bot-1" },
      { type: "REFERRAL_COMMISSION", amount: 0.000075, botId: "bot-1" },
      { type: "PLATFORM_PROFIT", amount: 0.000825, botId: "bot-1" },
    ], [{ id: "bot-1", ownerId: "900", isActive: true, ownerBalance: 0, pendingBalance: 0.0006 }], 30);

    expect(report.totals.TASK_REWARD).toBe(0.0015);
    expect(report.totals.CREATOR_EARNING_PENDING).toBe(0.0006);
    expect(report.totals.REFERRAL_COMMISSION).toBe(0.000075);
    expect(report.totals.PLATFORM_PROFIT).toBe(0.000825);
    expect(report.supervisors[0].pending).toBe(0.0006);
    expect(report.consistent).toBe(true);
  });
});
