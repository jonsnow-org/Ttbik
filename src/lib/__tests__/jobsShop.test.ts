const db: any = { $executeRawUnsafe: jest.fn(async () => 0), $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []), storeListing: { findUnique: jest.fn() }, bot: { findFirst: jest.fn(async () => null) } };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
import { FEATURE_DAYS, FEATURE_PRICE_USD, FEATURED_PER_PAGE, isShopSlug, itemStart, makeShopSlug, nextFeatureUntil, parseShopStart, shopStart, withFeaturedFirst } from "@/lib/jobs/shopRules";
import { featureListing } from "@/lib/jobs/shop";

describe("seller shop rules", () => {
  it("round-trips shop and item deep links within Telegram's 64 chars", () => {
    const slug = makeShopSlug(new Uint8Array([1, 2, 3, 4, 5, 6, 250]));
    expect(isShopSlug(slug)).toBe(true);
    expect(parseShopStart(shopStart(slug))).toEqual({ kind: "shop", slug });
    const id = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    const start = itemStart(id);
    expect(start.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]+$/.test(start)).toBe(true);
    expect(parseShopStart(start)).toEqual({ kind: "item", id });
    expect(parseShopStart("item_xyz")).toBeNull();
    expect(parseShopStart("shop_BAD")).toBeNull();
    expect(parseShopStart("ref_123")).toBeNull();
  });
  it("puts at most a few featured items first without duplicates", () => {
    const reg = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const feat = [{ id: "c" }, { id: "x" }, { id: "y" }, { id: "z" }];
    const out = withFeaturedFirst(reg, feat);
    expect(out.slice(0, FEATURED_PER_PAGE).every((o) => o.featured)).toBe(true);
    expect(out.map((o) => o.item.id)).toEqual(["c", "x", "y", "a", "b"]);
  });
  it("extends a running feature instead of resetting it", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(nextFeatureUntil(null, now).getTime() - now.getTime()).toBe(FEATURE_DAYS * 86400_000);
    const running = new Date("2026-11-12T00:00:00Z");
    expect(nextFeatureUntil(running, now).getTime() - running.getTime()).toBe(FEATURE_DAYS * 86400_000);
    expect(nextFeatureUntil(new Date("2026-11-01T00:00:00Z"), now).getTime() - now.getTime()).toBe(FEATURE_DAYS * 86400_000);
  });
});

describe("featureListing", () => {
  const id = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  beforeEach(() => jest.clearAllMocks());
  it("refuses someone else's listing without charging", async () => {
    db.storeListing.findUnique.mockResolvedValueOnce({ id, sellerId: "owner", status: "ACTIVE" });
    const charge = jest.fn();
    expect(await featureListing("other", id, charge)).toEqual({ ok: false, reason: "not_owner" });
    expect(charge).not.toHaveBeenCalled();
  });
  it("reports a short balance and writes nothing", async () => {
    db.storeListing.findUnique.mockResolvedValueOnce({ id, sellerId: "u", status: "ACTIVE" });
    const charge = jest.fn(async () => ({ ok: false, balance: 0.4 }));
    expect(await featureListing("u", id, charge)).toEqual({ ok: false, reason: "balance", balance: 0.4 });
    expect(charge).toHaveBeenCalledWith("u", FEATURE_PRICE_USD, "STORE_FEATURE");
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it("charges once and records the feature window", async () => {
    db.storeListing.findUnique.mockResolvedValueOnce({ id, sellerId: "u", status: "ACTIVE" });
    const charge = jest.fn(async () => ({ ok: true, balance: 4 }));
    const r = await featureListing("u", id, charge);
    expect(r.ok).toBe(true);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
