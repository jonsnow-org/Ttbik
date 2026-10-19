import { announceLaunch } from "../coinsChannel";

const now = Math.floor(Date.now() / 1000);
const mk = (curve: string, name: string, symbol: string, ageH = 1) => ({ curve, name, symbol, creatorFeeBps: 100, createdAt: now - ageH * 3600 });
let coins: ReturnType<typeof mk>[] = [];
let hidden: { curve: string }[] = [];

jest.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), upsert: async () => ({}) }) }) }));
jest.mock("@/lib/prisma", () => ({ prisma: { $queryRawUnsafe: async () => hidden, bot: { findFirst: async () => null } } }));
jest.mock("@/lib/znbtIndex", () => ({ readSnapshot: async () => ({ coins }) }));
jest.mock("@/lib/znbtHideDb", () => ({ ensureHiddenTable: async () => undefined }));
jest.mock("@/lib/znbtConfig", () => ({ getConfig: async () => null }));
jest.mock("@/lib/hostingOps", () => ({ HOSTING: { gateUrl: "https://gate.example" } }));
jest.mock("@/lib/channelPublisher", () => ({ isSafeForChannel: (t: string) => !/scam/i.test(t) }));

describe("launch feed", () => {
  beforeEach(() => { hidden = []; delete process.env.COINS_LAUNCH_FEED; });
  it("is off unless COINS_LAUNCH_FEED=1", async () => {
    coins = [mk("A".repeat(48), "Good Coin", "GOOD")];
    expect(await announceLaunch()).toEqual({ ok: false, reason: "feed-off" });
  });
  it("dry run picks a fresh plain-ASCII coin and the post has no price promise", async () => {
    coins = [mk("A".repeat(48), "Good Coin", "GOOD")];
    const r = await announceLaunch({ dry: true });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Good Coin");
    expect(r.text).toMatch(/not financial advice/i);
    expect(r.text).not.toMatch(/profit|moon|guarantee/i);
  });
  it("skips non-ASCII names, old coins, hidden coins and filtered words", async () => {
    coins = [mk("B".repeat(48), "عملة", "AR"), mk("C".repeat(48), "Old", "OLD", 48), mk("D".repeat(48), "Hidden", "HID"), mk("E".repeat(48), "scam coin", "SC")];
    hidden = [{ curve: "D".repeat(48) }];
    expect(await announceLaunch({ dry: true })).toEqual({ ok: false, reason: "nothing-new" });
  });
  it("escapes HTML in names", async () => {
    coins = [mk("F".repeat(48), "A<b>B", "AB")];
    const r = await announceLaunch({ dry: true });
    expect(r.text).toContain("A&lt;b&gt;B");
  });
});
