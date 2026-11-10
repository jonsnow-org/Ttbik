const db: any = { $executeRawUnsafe: jest.fn(async () => 0), $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []) };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
import { adReportUrl, slaState, totals, verifyAdReport, recordAdEvent } from "@/lib/adStats";
import { makeCode } from "@/lib/siteAds";

describe("advertiser proof-of-promotion", () => {
  beforeEach(() => { process.env.CRON_SECRET = "test-secret"; });
  it("report links are signed per code and refuse tampering", () => {
    const url = adReportUrl("ADV-2026-ABCDEFGH");
    const u = new URL(url);
    expect(u.pathname).toBe("/advertise/report");
    const s = u.searchParams.get("s")!;
    expect(verifyAdReport("ADV-2026-ABCDEFGH", s)).toBe(true);
    expect(verifyAdReport("ADV-2026-ABCDEFGX", s)).toBe(false);
    expect(verifyAdReport("ADV-2026-ABCDEFGH", "")).toBe(false);
  });
  it("hands out no link when the signing secret is missing", () => {
    delete process.env.CRON_SECRET;
    expect(adReportUrl("ADV-1")).toBe("");
  });
  it("totals and CTR", () => {
    expect(totals([{ day: "2026-11-09", views: 150, clicks: 3 }, { day: "2026-11-10", views: 50, clicks: 2 }])).toEqual({ views: 200, clicks: 5, ctr: 2.5 });
    expect(totals([])).toEqual({ views: 0, clicks: 0, ctr: 0 });
  });
  it("moderation SLA flags paid ads waiting more than 12h", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(slaState(new Date("2026-11-10T06:00:00Z"), now)).toEqual({ hours: 6, late: false });
    expect(slaState(new Date("2026-11-09T20:00:00Z"), now)).toEqual({ hours: 16, late: true });
  });
  it("recording never throws even if the DB fails", async () => {
    db.$executeRaw.mockRejectedValueOnce(new Error("down"));
    await expect(recordAdEvent("ADV-1", "click")).resolves.toBeUndefined();
  });
  it("reservation codes are 8 CSPRNG chars and unique", () => {
    const codes = new Set(Array.from({ length: 500 }, () => makeCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^ADV-\d{4}-[A-HJ-NP-Z2-9]{8}$/);
  });
});
