// ZNBt platform index: staleness, report reasons, and that the server bundle loads with its entry point.
jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: jest.fn(async () => []) } }));
import { isReason, isStale, REPORT_REASONS, STALE_SECONDS } from "../znbtIndex";

describe("snapshot freshness", () => {
  const now = 2_000_000_000_000;
  it("is stale when missing or older than 15 minutes", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale({ coins: [], updatedAt: now / 1000 - STALE_SECONDS - 1 }, now)).toBe(true);
    expect(isStale({ coins: [], updatedAt: now / 1000 - 60 }, now)).toBe(false);
  });
});
describe("report reasons", () => {
  it("accepts only the listed reasons", () => {
    for (const r of REPORT_REASONS) expect(isReason(r)).toBe(true);
    expect(isReason("hate")).toBe(false);
    expect(isReason(undefined)).toBe(false);
  });
});
describe("indexer bundle", () => {
  it("loads and exposes refreshIndex", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("../vendor/znbtIndexer.cjs");
    expect(typeof m.refreshIndex).toBe("function");
  });
});
