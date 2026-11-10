jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { summarizeSplits } from "@/lib/promoCommissions";

describe("promo revenue-share report", () => {
  const bots = [
    { id: "b1", ownerId: "111", isActive: true, ownerBalance: 1.2, pendingBalance: 0.4 },
    { id: "b2", ownerId: "222", isActive: false, ownerBalance: 0, pendingBalance: 0 },
  ];
  it("adds up each split and credits the supervisor of the bot where the task was done", () => {
    // two $0.10 tasks in b1: worker 0.05, creator 0.02, referral 0.005, platform 0.025
    const task = (bot: string) => [
      { type: "TASK_REWARD", amount: 0.05, botId: bot }, { type: "CREATOR_EARNING_PENDING", amount: 0.02, botId: bot },
      { type: "REFERRAL_COMMISSION", amount: 0.005, botId: bot }, { type: "PLATFORM_PROFIT", amount: 0.025, botId: bot },
    ];
    const r = summarizeSplits([{ type: "AD_PAYMENT", amount: 1, botId: null }, ...task("b1"), ...task("b1")], bots, 30);
    expect(r.tasks).toBe(2);
    expect(r.totals).toMatchObject({ AD_PAYMENT: 1, TASK_REWARD: 0.1, CREATOR_EARNING_PENDING: 0.04, REFERRAL_COMMISSION: 0.01, PLATFORM_PROFIT: 0.05 });
    expect(r.supervisors[0]).toEqual({ botId: "b1", ownerId: "111", active: true, ready: 1.2, pending: 0.4, earned30d: 0.04, tasks30d: 2 });
    expect(r.consistent).toBe(true);
  });
  it("flags payouts that exceed what advertisers spent", () => {
    const r = summarizeSplits([{ type: "AD_PAYMENT", amount: 0.1, botId: null }, { type: "TASK_REWARD", amount: 5, botId: "b1" }], bots, 30);
    expect(r.consistent).toBe(false);
  });
});
