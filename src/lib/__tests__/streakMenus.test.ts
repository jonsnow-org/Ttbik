// The chains bot (STREAK_BOT): the user panel, the owner's admin panel and how they connect.
process.env.SUPER_ADMIN_TELEGRAM_ID = "9001";
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/platformPoints", () => ({ earnPoints: jest.fn(async () => null) }));
import { adminMenu, isUserFlowText, mainMenu, STREAK_CATEGORIES } from "@/lib/streakBotLogic";

const labels = (kb: any): string[] => kb.keyboard.flat().map((b: any) => (typeof b === "string" ? b : b.text));

describe("chains bot panels", () => {
  it("the user panel has no admin button; the owner's copy has exactly one extra way back to the admin panel", () => {
    const user = labels(mainMenu(false));
    const owner = labels(mainMenu(true));
    expect(user).not.toContain("🛠 لوحة الإدارة");
    expect(owner).toEqual([...user, "🛠 لوحة الإدارة"]);
  });
  it("lists every chain, the board, the group features, the app and the info, two buttons per row at most", () => {
    const kb: any = mainMenu(false);
    const all = labels(kb);
    for (const c of STREAK_CATEGORIES) expect(all).toContain(c.menuLabel);
    for (const t of ["🧩 لوحة سلاسلي", "📊 كل سلاسلي", "🏆 مسابقات الجروبات", "ℹ️ معلومات"]) expect(all).toContain(t);
    for (const row of kb.keyboard) expect(row.length).toBeLessThanOrEqual(2);
  });
  it("the admin panel has management first and shortcuts into the user panel and the app", () => {
    const a = labels(adminMenu());
    for (const t of ["📊 الإحصائيات", "🔎 بحث عن مستخدم", "📢 بث جماعي", "📡 قناة الاشتراك الإجباري", "👤 لوحة المستخدم"]) expect(a).toContain(t);
  });
  it("every user-panel button is handed to the regular flow by the owner's admin panel; admin buttons are not", () => {
    for (const t of labels(mainMenu(true))) {
      if (t === "🛠 لوحة الإدارة") continue; // the way back belongs to the admin panel
      expect(isUserFlowText(t, null)).toBe(true);
    }
    for (const t of ["📊 الإحصائيات", "🔎 بحث عن مستخدم", "📢 بث جماعي", "📡 قناة الاشتراك الإجباري", "👤 لوحة المستخدم", "🛠 لوحة الإدارة", "/start", "/admin"]) expect(isUserFlowText(t, null)).toBe(false);
    expect(isUserFlowText("/widget", null)).toBe(true);
    expect(isUserFlowText("ما", { mode: "khatma_name" } as any)).toBe(true);
  });
});
